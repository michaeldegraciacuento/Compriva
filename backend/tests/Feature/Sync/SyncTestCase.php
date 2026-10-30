<?php

namespace Tests\Feature\Sync;

use App\Domain\Devices\Enums\DeviceStatus;
use App\Domain\Sales\Pricing\CartCalculator;
use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Models\ProductSku;
use App\Models\TaxRate;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Sales\PosTestCase;

/**
 * Builds operations the way the desktop terminal does (frontend/src/modules/offline)
 * and sends them with the terminal's device token.
 */
abstract class SyncTestCase extends PosTestCase
{
    private int $seq = 0;

    /** @var array<string, string> device id => token */
    private array $tokens = [];

    protected function terminal(string $code): Device
    {
        return Device::factory()->create(['store_id' => $this->store->id, 'code' => $code, 'install_id' => (string) Str::uuid(), 'status' => DeviceStatus::Active]);
    }

    /** Next requests as the terminal itself (device token + X-Compriva-Device). */
    protected function asTerminal(?Device $device = null): static
    {
        $device ??= $this->terminal;
        $this->resetAuth();
        $this->tokens[$device->id] ??= $device->createToken('sync', [PersonalAccessToken::ABILITY_DEVICE])->plainTextToken;

        return $this->withToken($this->tokens[$device->id])->withHeader('X-Compriva-Device', (string) $device->install_id);
    }

    /** @param list<array<string, mixed>> $operations */
    protected function push(array $operations, ?Device $device = null): TestResponse
    {
        return $this->asTerminal($device)->postJson('/api/v1/sync/operations', ['operations' => $operations]);
    }

    protected function pull(?int $cursor = null, ?Device $device = null, ?int $limit = null): TestResponse
    {
        $query = http_build_query(array_filter(['cursor' => $cursor, 'limit' => $limit], fn ($v) => $v !== null));

        return $this->asTerminal($device)->getJson('/api/v1/sync/changes'.($query ? "?{$query}" : ''));
    }

    protected function topUp(?Device $device = null): TestResponse
    {
        return $this->asTerminal($device)->postJson('/api/v1/sync/allocations/top-up');
    }

    /** @param array<string, mixed> $payload */
    protected function op(string $type, array $payload, ?string $id = null): array
    {
        return [
            'operation_id' => $id ?? (string) Str::uuid7(),
            'local_seq' => ++$this->seq,
            'type' => $type,
            'schema_version' => 1,
            'created_at' => now()->toIso8601ZuluString(),
            'payload' => $payload,
        ];
    }

    protected function shiftOpened(string $shiftId, string $float = '1000.00'): array
    {
        return $this->op('shift.opened', ['shift_id' => $shiftId, 'cashier_id' => $this->cashier->id, 'opening_float' => $float, 'opened_at' => now()->toIso8601ZuluString()]);
    }

    /**
     * A sale as the terminal records it. Lines: [sku, quantity, unit price?, discount?].
     *
     * @param  list<array{0: ProductSku, 1: string, 2?: ?string, 3?: ?array}>  $lines
     * @param  list<array{method: string, amount: string, reference?: string}>  $payments
     * @param  array<string, mixed>  $extra
     */
    protected function sale(string $shiftId, int $number, array $lines, array $payments, array $extra = [], ?Device $device = null): array
    {
        $device ??= $this->terminal;
        $vat = TaxRate::where('code', 'VAT12')->firstOrFail();
        $built = array_map(function (array $line) use ($vat) {
            [$sku, $quantity] = $line;
            $regular = $sku->prices()->where('unit_id', $this->piece->id)->value('price');

            return [
                'id' => (string) Str::uuid7(),
                'sku_id' => $sku->id,
                'unit_id' => $this->piece->id,
                'quantity' => $quantity,
                'factor' => '1.000000',
                'regular_unit_price' => $line[4] ?? $regular,
                'unit_price' => $line[2] ?? ($line[4] ?? $regular),
                'product_name' => $sku->name,
                'sku_code' => $sku->code,
                'unit_name' => 'Piece',
                'barcode' => null,
                'tax' => ['id' => $vat->id, 'code' => 'VAT12', 'type' => 'vat', 'rate' => '12.0000', 'inclusive' => true],
                'discount' => $line[3] ?? null,
            ];
        }, $lines);

        $calc = (new CartCalculator)->calculate(array_map(fn ($l) => [
            'quantity' => $l['quantity'], 'unit_price' => $l['unit_price'], 'tax_type' => 'vat', 'tax_rate' => '12', 'tax_inclusive' => true, 'discount' => $l['discount'],
        ], $built));

        return $this->op('sale.completed', [
            'id' => (string) Str::uuid7(),
            'receipt_number' => sprintf('%s-%06d', $device->code, $number),
            'receipt_sequence' => $number,
            'shift_id' => $shiftId,
            'cashier_id' => $this->cashier->id,
            'occurred_at' => now()->toIso8601ZuluString(),
            'lines' => $built,
            'discount' => null,
            'payments' => $payments,
            'totals' => $calc['totals'],
            ...$extra,
        ]);
    }
}
