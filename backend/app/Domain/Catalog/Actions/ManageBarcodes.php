<?php

namespace App\Domain\Catalog\Actions;

use App\Models\ProductBarcode;
use App\Models\ProductSku;
use App\Support\Audit\AuditLogger;
use App\Support\Validation\BarcodeRule;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Barcodes of a SKU. Each barcode scans as one unit of the SKU (NULL = base
 * unit; a case barcode scans as one case). Barcodes are unique across the
 * whole catalog and validated for their symbology's check digit.
 */
class ManageBarcodes
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** @param  array{barcode: string, type?: string, unit_id?: ?string, is_primary?: bool}  $data */
    public function add(ProductSku $sku, array $data): ProductBarcode
    {
        $type = $data['type'] ?? 'ean13';
        $unitId = $data['unit_id'] ?? null;

        Validator::make(['barcode' => $data['barcode']], [
            'barcode' => ['required', new BarcodeRule($type), 'unique:product_barcodes,barcode'],
        ], ['barcode.unique' => 'This barcode is already assigned to another product.'])->validate();

        if ($unitId !== null && $unitId !== $sku->base_unit_id && ! $sku->unitConversions()->where('unit_id', $unitId)->exists()) {
            throw ValidationException::withMessages(['unit_id' => 'Add this unit to the SKU before giving it a barcode.']);
        }

        return DB::transaction(function () use ($sku, $data, $type, $unitId) {
            $primary = ($data['is_primary'] ?? false) || ! $sku->barcodes()->exists();
            if ($primary) {
                $sku->barcodes()->update(['is_primary' => false]);
            }

            $barcode = $sku->barcodes()->create([
                'barcode' => $data['barcode'],
                'type' => $type,
                'unit_id' => $unitId === $sku->base_unit_id ? null : $unitId,
                'is_primary' => $primary,
            ]);
            $this->audit->record('product_barcode.added', $sku, new: ['barcode' => $barcode->barcode, 'type' => $type]);

            return $barcode;
        });
    }

    public function remove(ProductBarcode $barcode): void
    {
        DB::transaction(function () use ($barcode) {
            $sku = $barcode->sku;
            $barcode->delete();
            if ($barcode->is_primary) {
                $sku->barcodes()->oldest()->first()?->update(['is_primary' => true]);
            }
            $this->audit->record('product_barcode.removed', $sku, ['barcode' => $barcode->barcode]);
        });
    }
}
