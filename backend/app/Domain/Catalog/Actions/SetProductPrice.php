<?php

namespace App\Domain\Catalog\Actions;

use App\Models\ProductPrice;
use App\Models\ProductSku;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Sets a price from a moment on (now by default, or scheduled for later).
 *
 * Prices are effective-dated history: the open price for the same SKU, unit
 * and tier is closed at the new price's start and a new row is added. Nothing
 * is overwritten, so past receipts and reports keep their prices.
 */
class SetProductPrice
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** @param  array{unit_id: string, tier?: string, price: string, effective_from?: ?string}  $data */
    public function set(User $actor, ProductSku $sku, array $data): ProductPrice
    {
        $unitId = $data['unit_id'];
        $tier = $data['tier'] ?? 'retail';
        $scheduled = isset($data['effective_from']);
        // Whole seconds: the column stores seconds, so comparisons must too.
        $from = ($scheduled ? Carbon::parse($data['effective_from']) : now())->startOfSecond();

        if ($unitId !== $sku->base_unit_id && ! $sku->unitConversions()->where('unit_id', $unitId)->exists()) {
            throw ValidationException::withMessages(['unit_id' => 'Add this unit to the SKU before pricing it.']);
        }

        return DB::transaction(function () use ($actor, $sku, $unitId, $tier, $from, $scheduled, $data) {
            $series = ProductPrice::where('product_sku_id', $sku->id)->where('unit_id', $unitId)->where('tier', $tier)->lockForUpdate();

            // Immediate change within the same second as the latest price (timestamps have
            // 1-second precision): start one second later so history stays strictly ordered.
            $latest = (clone $series)->max('effective_from');
            if (! $scheduled && $latest !== null && Carbon::parse($latest)->eq($from)) {
                $from = Carbon::parse($latest)->addSecond();
            }

            if ((clone $series)->where('effective_from', '>=', $from)->exists()) {
                throw new BusinessException('A price starting at or after this time already exists.', ErrorCode::Conflict, 409, ['reason' => 'later_price_exists']);
            }

            $current = (clone $series)->whereNull('effective_to')->first();
            $current?->update(['effective_to' => $from]);

            $price = ProductPrice::create([
                'product_sku_id' => $sku->id,
                'unit_id' => $unitId,
                'tier' => $tier,
                'price' => $data['price'],
                'effective_from' => $from,
                'created_by' => $actor->id,
            ]);

            $this->audit->record('product_price.set', $sku, ['price' => $current?->price], [
                'price' => $price->price, 'unit_id' => $unitId, 'tier' => $tier, 'effective_from' => $from->toIso8601ZuluString(),
            ], user: $actor);

            return $price;
        });
    }
}
