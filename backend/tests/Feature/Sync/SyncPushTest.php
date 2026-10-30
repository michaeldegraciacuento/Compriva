<?php

namespace Tests\Feature\Sync;

use App\Models\CashierShift;
use App\Models\Device;
use App\Models\InventoryLevel;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SyncConflict;
use App\Models\SyncOperation;
use App\Models\TerminalStockAllocation;
use Illuminate\Support\Str;

/** Pushing offline operations: ordering, idempotency, validation, conflicts. */
class SyncPushTest extends SyncTestCase
{
    public function test_an_offline_shift_with_a_sale_and_cash_in_is_applied_in_order(): void
    {
        $this->topUp()->assertOk();
        $shift = (string) Str::uuid7();
        $open = $this->shiftOpened($shift);
        $sale = $this->sale($shift, 1, [[$this->sku, '2']], [['method' => 'cash', 'amount' => '100']]);

        $this->push([
            $open,
            $sale,
            $this->op('cash.movement', ['id' => (string) Str::uuid7(), 'shift_id' => $shift, 'type' => 'cash_in', 'amount' => '200', 'reason' => 'Coins',
                'performed_by' => $this->cashier->id, 'approved_by' => $this->manager->id, 'occurred_at' => now()->toIso8601ZuluString()]),
            $this->op('shift.closed', ['shift_id' => $shift, 'closed_by' => $this->cashier->id, 'counted_cash' => '1300', 'expected_cash' => '1300.00', 'closed_at' => now()->toIso8601ZuluString()]),
        ])->assertOk()
            ->assertJsonPath('data.results.*.status', ['applied', 'applied', 'applied', 'applied'])
            ->assertJsonPath('data.results.1.result.receipt_number', 'T01-000001')
            ->assertJsonPath('data.results.3.result.cash_variance', '0.0000');

        $record = Sale::findOrFail($sale['payload']['id']);
        $this->assertSame('100.0000', $record->grand_total);
        $this->assertSame('98.0000', $this->onHand());
        $this->assertSame('2.0000', TerminalStockAllocation::where('device_id', $this->terminal->id)->value('consumed_quantity'));
        // 100 on hand; the terminals may hold 90% (10 stay central); 2 sold from it → 88 still reserved.
        $this->assertSame('88.0000', InventoryLevel::where('product_sku_id', $this->sku->id)->value('quantity_allocated'));
        $this->assertSame('closed', CashierShift::findOrFail($shift)->status->value);
        $this->assertSame(1, Device::find($this->terminal->id)->last_receipt_sequence);
        $this->assertLedgerMatchesLevels();
    }

    public function test_sending_a_batch_again_or_after_an_interruption_applies_each_operation_once(): void
    {
        $this->topUp();
        $shift = (string) Str::uuid7();
        $open = $this->shiftOpened($shift);
        $sale = $this->sale($shift, 1, [[$this->sku, '3']], [['method' => 'cash', 'amount' => '150']]);

        // Interrupted: only the first operation reached the server.
        $this->push([$open])->assertJsonPath('data.results.0.status', 'applied');
        $this->push([$open, $sale])->assertJsonPath('data.results.*.status', ['duplicate', 'applied']);
        $this->push([$open, $sale])->assertJsonPath('data.results.*.status', ['duplicate', 'duplicate'])
            ->assertJsonPath('data.results.1.result.receipt_number', 'T01-000001');

        $this->assertSame(1, Sale::count());
        $this->assertSame('97.0000', $this->onHand());
        $this->assertSame(2, SyncOperation::count());
    }

    public function test_invalid_operations_are_rejected_recorded_and_change_nothing(): void
    {
        $this->topUp();
        $shift = (string) Str::uuid7();
        $this->push([$this->shiftOpened($shift)])->assertOk();

        $tampered = $this->sale($shift, 1, [[$this->sku, '2']], [['method' => 'cash', 'amount' => '100']]);
        $tampered['payload']['totals']['grand_total'] = '10.00';
        $underpaid = $this->sale($shift, 2, [[$this->sku, '2']], [['method' => 'cash', 'amount' => '50']]);
        $unapproved = $this->sale($shift, 3, [[$this->sku, '2', null, ['type' => 'percentage', 'value' => '50']]], [['method' => 'cash', 'amount' => '50']]);
        $unknownShift = $this->sale((string) Str::uuid7(), 4, [[$this->sku, '1']], [['method' => 'cash', 'amount' => '50']]);
        $badNumber = $this->sale($shift, 5, [[$this->sku, '1']], [['method' => 'cash', 'amount' => '50']]);
        $badNumber['payload']['lines'][0]['quantity'] = '1e3';

        $results = $this->push([$tampered, $underpaid, $unapproved, $unknownShift, $badNumber])->assertOk()->json('data.results');
        $this->assertSame(['rejected', 'rejected', 'rejected', 'rejected', 'rejected'], array_column($results, 'status'));
        $this->assertSame(['INVALID_PAYLOAD', 'INVALID_PAYLOAD', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED'], array_column(array_column($results, 'error'), 'code'));

        $this->assertSame(0, Sale::count());
        $this->assertSame('100.0000', $this->onHand());
        $this->assertSame(5, SyncOperation::where('status', 'rejected')->count());
        // A rejected operation stays rejected when sent again (the terminal keeps it for review).
        $this->push([$tampered])->assertJsonPath('data.results.0.status', 'rejected');
    }

    public function test_a_manager_approved_offline_discount_is_accepted(): void
    {
        $this->topUp();
        $shift = (string) Str::uuid7();
        $open = $this->shiftOpened($shift);
        $sale = $this->sale($shift, 1, [[$this->sku, '2', null, ['type' => 'percentage', 'value' => '10']]], [['method' => 'cash', 'amount' => '90']], ['approved_by' => $this->manager->id]);

        $this->push([$open, $sale])->assertJsonPath('data.results.1.status', 'applied');
        $this->assertSame('90.0000', Sale::findOrFail($sale['payload']['id'])->grand_total);
    }

    public function test_offline_sales_beyond_allocation_and_stock_are_kept_and_flagged(): void
    {
        $sardines = $this->product('Sardines 155g', '25.00');
        $this->stockIn($sardines, '5', '18');
        $this->topUp()->assertOk(); // the terminal holds 4 of the 5 (90%, whole pieces)
        $shift = (string) Str::uuid7();
        $open = $this->shiftOpened($shift);
        $sale = $this->sale($shift, 1, [[$sardines, '8']], [['method' => 'cash', 'amount' => '200']]);

        $this->push([$open, $sale])->assertJsonPath('data.results.1.status', 'applied')
            ->assertJsonCount(2, 'data.results.1.result.conflicts');

        $item = SaleItem::where('sale_id', $sale['payload']['id'])->sole();
        $this->assertTrue($item->over_allocation);
        $this->assertSame('-3.0000', $this->onHand($sardines)); // the goods are gone; the books show it
        $this->assertEqualsCanonicalizing(['over_allocation', 'stock_shortage'], SyncConflict::pluck('type')->all());
        $this->assertLedgerMatchesLevels();

        $this->actingAsUser($this->manager)->getJson('/api/v1/sync/conflicts')->assertOk()->assertJsonCount(2, 'data');
        $id = SyncConflict::where('type', 'stock_shortage')->value('id');
        $this->actingAsUser($this->manager)->postJson("/api/v1/sync/conflicts/{$id}/resolve", ['note' => 'Counted, 3 found in back room'])->assertOk();
        $this->actingAsUser($this->manager)->getJson('/api/v1/sync/conflicts')->assertJsonCount(1, 'data');
    }

    public function test_a_price_changed_on_the_server_while_offline_is_kept_and_flagged(): void
    {
        $this->topUp();
        $shift = (string) Str::uuid7();
        $open = $this->shiftOpened($shift);
        // The terminal still had ₱45 when it sold; the server price is ₱50.
        $sale = $this->sale($shift, 1, [[$this->sku, '1', null, null, '45.0000']], [['method' => 'cash', 'amount' => '45']]);

        $this->push([$open, $sale])->assertJsonPath('data.results.1.status', 'applied');
        $this->assertSame('45.0000', Sale::findOrFail($sale['payload']['id'])->grand_total);
        $this->assertSame('price_changed', SyncConflict::sole()->type);
    }

    public function test_an_offline_void_puts_stock_and_allocation_back(): void
    {
        $this->topUp();
        $shift = (string) Str::uuid7();
        $open = $this->shiftOpened($shift);
        $sale = $this->sale($shift, 1, [[$this->sku, '4']], [['method' => 'cash', 'amount' => '200']]);
        $void = $this->op('sale.voided', ['sale_id' => $sale['payload']['id'], 'requested_by' => $this->cashier->id, 'approved_by' => $this->manager->id,
            'reason' => 'Customer left', 'voided_at' => now()->toIso8601ZuluString()]);

        $this->push([$open, $sale, $void])->assertJsonPath('data.results.*.status', ['applied', 'applied', 'applied']);

        $this->assertSame('voided', Sale::findOrFail($sale['payload']['id'])->status->value);
        $this->assertSame('100.0000', $this->onHand());
        $this->assertSame('90.0000', TerminalStockAllocation::where('device_id', $this->terminal->id)->sole()->availableQuantity());
        $this->assertLedgerMatchesLevels();
    }

    public function test_only_an_active_terminal_with_its_device_token_can_sync(): void
    {
        $this->assertErrorCode($this->actingAsUser($this->manager)->withHeader('X-Compriva-Device', (string) $this->terminal->install_id)
            ->postJson('/api/v1/sync/operations', ['operations' => [$this->shiftOpened((string) Str::uuid7())]]), 401, 'DEVICE_NOT_REGISTERED');

        $this->asTerminal();
        $this->terminal->forceFill(['status' => 'revoked', 'revoked_at' => now()])->save();
        $this->assertErrorCode($this->push([$this->shiftOpened((string) Str::uuid7())]), 403, 'DEVICE_REVOKED');
    }

    public function test_a_cashier_on_a_registered_terminal_gets_the_sync_token(): void
    {
        $token = $this->at($this->cashier)->postJson('/api/v1/pos/terminal/sync-token')->assertCreated()->assertJsonPath('data.terminal.code', 'T01')->json('data.token');

        $this->resetAuth();
        $this->withToken($token)->withHeader('X-Compriva-Device', (string) $this->terminal->install_id)->getJson('/api/v1/sync/changes')
            ->assertOk()->assertJsonPath('data.mode', 'snapshot');
    }
}
