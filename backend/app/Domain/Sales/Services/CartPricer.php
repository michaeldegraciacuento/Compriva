<?php

namespace App\Domain\Sales\Services;

use App\Domain\Catalog\Enums\PriceTier;
use App\Domain\Sales\Enums\DiscountKind;
use App\Domain\Sales\Enums\DiscountScope;
use App\Domain\Sales\Enums\DiscountType;
use App\Domain\Sales\Pricing\CartCalculator;
use App\Domain\Sales\Pricing\FixedPoint;
use App\Models\Discount;
use App\Models\ProductPrice;
use App\Models\ProductSku;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Collection;

/**
 * Turns a cart from the POS (SKU, unit, quantity, optional price override and
 * discounts) into priced lines with product and tax snapshots.
 *
 * Prices, units, conversion factors and tax rates are always read from the
 * database; the client only says what is in the cart. Used for quotes and for
 * completing a sale, so both give the same answer.
 */
class CartPricer
{
    private const SCALE = 4;

    public function __construct(private readonly CartCalculator $calculator) {}

    /**
     * @param  list<array<string, mixed>>  $lines  validated cart lines
     * @param  ?array<string, mixed>  $saleDiscount  validated sale discount
     * @return array{lines: list<array<string, mixed>>, discount: ?array<string, mixed>, totals: array<string, string>, permissions: list<string>}
     */
    public function price(array $lines, ?array $saleDiscount = null): array
    {
        $skus = ProductSku::query()
            ->with(['product.taxRate', 'baseUnit', 'unitConversions.unit', 'barcodes'])
            ->whereIn('id', array_column($lines, 'sku_id'))
            ->get()
            ->keyBy('id');
        $prices = $this->currentPrices($skus->keys());

        $priced = [];
        $permissions = [];
        foreach ($lines as $i => $line) {
            $priced[] = $this->line($i, $line, $skus->get($line['sku_id']), $prices);
            if (isset($line['unit_price'])) {
                $permissions[] = 'pos.price_override';
            }
            if (isset($line['discount'])) {
                $permissions[] = 'pos.apply_discount';
            }
        }

        $discount = $saleDiscount === null ? null : $this->saleDiscount($saleDiscount, $priced);
        if ($discount !== null && $discount['needs_permission']) {
            $permissions[] = 'pos.apply_discount';
        }

        $result = $this->calculator->calculate(
            array_map(fn (array $p) => [
                'quantity' => $p['quantity'],
                'unit_price' => $p['unit_price'],
                'tax_type' => $p['tax']['type'],
                'tax_rate' => $p['tax']['rate'],
                'tax_inclusive' => $p['tax']['inclusive'],
                'discount' => $p['discount'],
            ], $priced),
            $discount === null ? null : [
                'type' => $discount['type'],
                'value' => $discount['value'],
                'vat_exempt' => $discount['is_vat_exempt'],
                'max_amount' => $discount['max_amount'],
            ],
        );

        if ($discount !== null && $discount['min_purchase'] !== null
            && FixedPoint::cents($result['totals']['gross_amount']) < FixedPoint::cents($discount['min_purchase'])) {
            throw new BusinessException(
                "{$discount['name']} needs a purchase of at least ₱".FixedPoint::format(FixedPoint::cents($discount['min_purchase'])).'.',
                ErrorCode::BusinessRuleViolation, 422, ['reason' => 'min_purchase'],
            );
        }

        foreach ($priced as $i => &$p) {
            $p['amounts'] = $result['lines'][$i];
        }

        return ['lines' => $priced, 'discount' => $discount, 'totals' => $result['totals'], 'permissions' => array_values(array_unique($permissions))];
    }

    /** @param Collection<string, Collection<int, ProductPrice>> $prices */
    private function line(int $i, array $line, ?ProductSku $sku, Collection $prices): array
    {
        if ($sku === null || ! $sku->is_active || ! $sku->product->is_active) {
            $this->invalid("lines.{$i}.sku_id", 'This item is not for sale.');
        }

        $conversion = $sku->unitConversions->firstWhere('unit_id', $line['unit_id']);
        $isBase = $line['unit_id'] === $sku->base_unit_id;
        if ($conversion === null && ! $isBase) {
            $this->invalid("lines.{$i}.unit_id", "{$sku->name} is not sold in this unit.");
        }
        $unit = $conversion?->unit ?? $sku->baseUnit;
        $factor = $isBase ? '1.000000' : $conversion->factor;

        $quantity = (string) $line['quantity'];
        if (! $unit->allows_decimal && bccomp($quantity, (string) (int) $quantity, self::SCALE) !== 0) {
            $this->invalid("lines.{$i}.quantity", "{$unit->name} must be a whole number.");
        }

        $regular = $this->regularPrice($sku, $line['unit_id'], $factor, $prices->get($sku->id, collect()))
            ?? $this->invalid("lines.{$i}.sku_id", "{$sku->name} has no price for {$unit->name}.");
        $charged = isset($line['unit_price']) ? bcadd((string) $line['unit_price'], '0', self::SCALE) : $regular;

        $tax = $sku->product->taxRate;

        return [
            'sku' => $sku,
            'unit' => $unit,
            'factor' => $factor,
            'quantity' => bcadd($quantity, '0', self::SCALE),
            'base_quantity' => bcmul($quantity, $factor, self::SCALE),
            'regular_unit_price' => $regular,
            'unit_price' => $charged,
            'price_overridden' => bccomp($charged, $regular, self::SCALE) !== 0,
            'barcode' => $line['barcode'] ?? null,
            'discount' => isset($line['discount']) ? ['type' => $line['discount']['type'], 'value' => (string) $line['discount']['value']] : null,
            'tax' => [
                'id' => $tax->id,
                'code' => $tax->code,
                'type' => $tax->type instanceof \BackedEnum ? $tax->type->value : $tax->type,
                'rate' => $tax->rate,
                'inclusive' => (bool) $tax->is_inclusive,
            ],
        ];
    }

    /** Retail price for the unit; a pack unit without its own price costs factor × the base unit price. */
    private function regularPrice(ProductSku $sku, string $unitId, string $factor, Collection $prices): ?string
    {
        $own = $prices->firstWhere('unit_id', $unitId);
        if ($own !== null) {
            return $own->price;
        }
        $base = $prices->firstWhere('unit_id', $sku->base_unit_id);

        return $base === null ? null : self::packPrice($base->price, $factor);
    }

    /** Price of a pack unit without its own price: base price × factor, rounded to centavos. */
    public static function packPrice(string $basePrice, string $factor): string
    {
        return bcadd(FixedPoint::format(FixedPoint::roundCents(bcmul($basePrice, $factor, 10))), '0', self::SCALE);
    }

    /** @return Collection<string, Collection<int, ProductPrice>> */
    private function currentPrices(Collection $skuIds): Collection
    {
        return ProductPrice::query()
            ->whereIn('product_sku_id', $skuIds)
            ->where('tier', PriceTier::Retail)
            ->effectiveAt()
            ->orderByDesc('effective_from')
            ->get()
            ->groupBy('product_sku_id');
    }

    /** @param list<array<string, mixed>> $priced */
    private function saleDiscount(array $input, array $priced): array
    {
        if (! empty($input['discount_id'])) {
            $discount = Discount::whereKey($input['discount_id'])->where('is_active', true)->first();
            if ($discount === null || $discount->scope !== DiscountScope::Sale
                || ($discount->starts_at !== null && $discount->starts_at->isFuture())
                || ($discount->ends_at !== null && $discount->ends_at->isPast())) {
                $this->invalid('discount.discount_id', 'This discount is not available.');
            }
            if ($discount->requires_customer_id && empty($input['customer_id_number'])) {
                $this->invalid('discount.customer_id_number', "Enter the customer's ID number for {$discount->name}.");
            }
            if ($discount->is_vat_exempt && collect($priced)->contains(fn (array $p) => $p['discount'] !== null)) {
                $this->invalid('discount.discount_id', "{$discount->name} cannot be combined with item discounts.");
            }

            return [
                'discount_id' => $discount->id,
                'name' => $discount->name,
                'kind' => $discount->kind->value,
                'type' => $discount->type->value,
                'value' => $discount->value,
                'is_vat_exempt' => $discount->is_vat_exempt,
                'max_amount' => $discount->max_discount_amount,
                'min_purchase' => $discount->min_purchase_amount,
                'customer_id_number' => $input['customer_id_number'] ?? null,
                'needs_permission' => $discount->requires_approval,
            ];
        }

        return [
            'discount_id' => null,
            'name' => $input['name'] ?? 'Manual discount',
            'kind' => DiscountKind::Manual->value,
            'type' => DiscountType::from($input['type'])->value,
            'value' => bcadd((string) $input['value'], '0', self::SCALE),
            'is_vat_exempt' => false,
            'max_amount' => null,
            'min_purchase' => null,
            'customer_id_number' => null,
            'needs_permission' => true,
        ];
    }

    private function invalid(string $field, string $message): never
    {
        throw new BusinessException($message, ErrorCode::ValidationFailed, 422, ['fields' => [$field => [$message]]]);
    }
}
