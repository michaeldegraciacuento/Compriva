<?php

namespace App\Domain\Catalog\Actions;

use App\Models\ProductSku;
use App\Models\UnitConversion;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Validation\ValidationException;

/**
 * Units a SKU is bought or sold in besides its base unit: 1 case = 12 pcs.
 * The base unit's own conversion (factor 1) is managed by SaveProduct.
 * Historical lines keep their own factor snapshot, so changing a factor only
 * affects future documents and sales.
 */
class ManageUnitConversions
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** @param  array{unit_id: string, factor: string, is_purchase_unit?: bool, is_sales_unit?: bool}  $data */
    public function add(ProductSku $sku, array $data): UnitConversion
    {
        if ($data['unit_id'] === $sku->base_unit_id) {
            throw ValidationException::withMessages(['unit_id' => 'This is already the base unit.']);
        }
        if ($sku->unitConversions()->where('unit_id', $data['unit_id'])->exists()) {
            throw ValidationException::withMessages(['unit_id' => 'This unit is already set up for the SKU.']);
        }

        $conversion = $sku->unitConversions()->create($data + ['is_purchase_unit' => true, 'is_sales_unit' => true]);
        $this->audit->record('unit_conversion.added', $sku, new: ['unit_id' => $data['unit_id'], 'factor' => $conversion->factor]);

        return $conversion;
    }

    /** @param  array{factor?: string, is_purchase_unit?: bool, is_sales_unit?: bool}  $data */
    public function update(UnitConversion $conversion, array $data): UnitConversion
    {
        $this->assertNotBase($conversion);
        $before = $conversion->only(array_keys($data));
        $conversion->update($data);
        $this->audit->record('unit_conversion.updated', $conversion->sku, $before, $data);

        return $conversion;
    }

    public function remove(UnitConversion $conversion): void
    {
        $this->assertNotBase($conversion);
        $sku = $conversion->sku;

        if ($sku->barcodes()->where('unit_id', $conversion->unit_id)->exists() || $sku->prices()->where('unit_id', $conversion->unit_id)->exists()) {
            throw new BusinessException(
                'This unit has barcodes or prices. Remove them first, or stop selling in this unit instead.',
                ErrorCode::Conflict, 409, ['reason' => 'unit_in_use'],
            );
        }

        $conversion->delete();
        $this->audit->record('unit_conversion.removed', $sku, ['unit_id' => $conversion->unit_id]);
    }

    private function assertNotBase(UnitConversion $conversion): void
    {
        if ($conversion->unit_id === $conversion->sku->base_unit_id) {
            throw new BusinessException('The base unit conversion is fixed at 1.', ErrorCode::BusinessRuleViolation, 409, ['reason' => 'base_unit']);
        }
    }
}
