<?php

namespace Tests\Feature\Sales;

use App\Models\CashierShift;
use App\Models\Device;
use App\Models\PaymentMethod;
use App\Models\Sale;
use App\Models\SaleReturn;
use App\Models\StockMovement;
use App\Support\Database\ImmutableRecordException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** Authorized voids and returns, cashier shifts, terminal registration and payment method QR codes. */
class VoidReturnShiftTest extends PosTestCase
{
    /** @return array<string, mixed> sale JSON */
    private function sellTwoPieces(): array
    {
        $this->openShift();

        return $this->checkout([$this->line('2')], [$this->cash('100')])->assertCreated()->json('data');
    }

    public function test_void_needs_approval_restores_stock_and_keeps_the_sale(): void
    {
        $sale = $this->sellTwoPieces();
        $this->assertSame('98.0000', $this->onHand());

        $this->assertErrorCode($this->at($this->cashier)->postJson("/api/v1/sales/{$sale['id']}/void", ['reason' => 'Customer changed mind']), 403, 'APPROVAL_REQUIRED');

        $this->at($this->cashier)->postJson("/api/v1/sales/{$sale['id']}/void", ['reason' => 'Customer changed mind', 'approval' => $this->managerApproval()])
            ->assertOk()
            ->assertJsonPath('data.status', 'voided')
            ->assertJsonPath('data.grand_total', '100.0000') // amounts untouched
            ->assertJsonPath('data.void.voided_by', $this->manager->name)
            ->assertJsonPath('data.void.reason', 'Customer changed mind');

        $this->assertSame('100.0000', $this->onHand());
        $this->assertSame(1, StockMovement::where('type', 'sale_void')->count());
        $this->assertLedgerMatchesLevels();

        $this->assertErrorCode($this->at($this->manager)->postJson("/api/v1/sales/{$sale['id']}/void", ['reason' => 'again']), 409, 'CONFLICT');

        $this->expectException(ImmutableRecordException::class);
        Sale::find($sale['id'])->update(['void_reason' => 'edited later']);
    }

    public function test_sales_of_a_closed_shift_cannot_be_voided(): void
    {
        $sale = $this->sellTwoPieces();
        $this->at($this->cashier)->postJson('/api/v1/pos/shift/close', ['counted_cash' => '1100'])->assertOk();

        $this->assertErrorCode($this->at($this->manager)->postJson("/api/v1/sales/{$sale['id']}/void", ['reason' => 'Late void']), 409, 'CONFLICT')
            ->assertJsonPath('error.details.reason', 'shift_closed');
    }

    public function test_partial_returns_refund_pro_rata_and_never_more_than_was_paid(): void
    {
        $this->openShift();
        // 3 pieces with ₱10 off the line: ₱140 paid, so ₱46.67 + ₱46.67 + ₱46.66.
        $sale = $this->checkout([$this->line('3', extra: ['discount' => ['type' => 'fixed_amount', 'value' => '10']])], [$this->cash('140')], ['approval' => $this->managerApproval()])
            ->assertCreated()->json('data');
        $itemId = $sale['items'][0]['id'];
        $return = fn (string $qty, string $condition = 'resellable', array $extra = []) => $this->at($this->cashier)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'reason' => 'Dented can', 'items' => [['sale_item_id' => $itemId, 'quantity' => $qty, 'condition' => $condition]],
            'refund_method' => 'cash', 'approval' => $this->managerApproval(), ...$extra,
        ]);

        $return('1')->assertCreated()
            ->assertJsonPath('data.return_number', 'RET-000001')
            ->assertJsonPath('data.total_refund', '46.6700')
            ->assertJsonPath('data.refunds.0.method', 'cash');
        $this->assertSame('98.0000', $this->onHand()); // 100 − 3 + 1

        $this->assertErrorCode($return('3'), 422, 'VALIDATION_FAILED')
            ->assertJsonPath('error.message', 'Only 2 Piece of Corned Beef 150g can still be returned.');

        // Damaged: refunded, not restocked. The last return takes exactly what is left.
        $return('2', 'damaged')->assertCreated()->assertJsonPath('data.total_refund', '93.3300')->assertJsonPath('data.items.0.restock', false);
        $this->assertSame('98.0000', $this->onHand());
        $this->assertSame('140.0000', bcadd(SaleReturn::sum('total_refund'), '0', 4));
        $this->assertLedgerMatchesLevels();

        // A sale with returns can no longer be voided.
        $this->assertErrorCode($this->at($this->manager)->postJson("/api/v1/sales/{$sale['id']}/void", ['reason' => 'x x x']), 409, 'CONFLICT');
    }

    public function test_e_wallet_refunds_need_a_reference(): void
    {
        $sale = $this->sellTwoPieces();

        $this->assertErrorCode($this->at($this->manager)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'reason' => 'Wrong item', 'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => '1']], 'refund_method' => 'gcash',
        ]), 422, 'VALIDATION_FAILED')->assertJsonPath('error.details.fields', fn ($f) => isset($f['refund_reference']));
    }

    public function test_closing_a_shift_counts_the_drawer_against_expected_cash(): void
    {
        $sale = $this->sellTwoPieces();                                                                  // +₱100 cash
        $this->checkout([$this->line('1')], [['method' => 'maya', 'amount' => '50', 'reference' => 'MAYA-77']])->assertCreated(); // not cash
        $this->at($this->cashier)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'reason' => 'Expired', 'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => '1', 'condition' => 'expired']],
            'refund_method' => 'cash', 'approval' => $this->managerApproval(),
        ])->assertCreated();                                                                             // −₱50 cash

        $this->at($this->cashier)->getJson('/api/v1/pos/shift')
            ->assertOk()
            ->assertJsonPath('data.summary.sales_count', 2)
            ->assertJsonPath('data.summary.sales_total', '150.0000')
            ->assertJsonPath('data.summary.payments.maya.total', '50.0000')
            ->assertJsonPath('data.summary.expected_cash', '1050.0000');

        // Another cashier cannot close it; the owner of the shift can.
        $this->assertErrorCode($this->at($this->userWithRole('cashier'))->postJson('/api/v1/pos/shift/close', ['counted_cash' => '1050']), 403, 'FORBIDDEN');
        $this->at($this->cashier)->postJson('/api/v1/pos/shift/close', ['counted_cash' => '1040.00'])
            ->assertOk()
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.expected_cash', '1050.0000')
            ->assertJsonPath('data.cash_variance', '-10.0000');

        $this->assertErrorCode($this->checkout([$this->line('1')], [$this->cash('50')]), 409, 'SHIFT_REQUIRED');
        $this->expectException(ImmutableRecordException::class);
        CashierShift::firstOrFail()->update(['counted_cash' => '1050']);
    }

    public function test_one_open_shift_per_terminal_and_per_cashier(): void
    {
        $this->openShift();
        $this->assertErrorCode($this->at($this->manager)->postJson('/api/v1/pos/shift', ['opening_float' => '0']), 409, 'CONFLICT')
            ->assertJsonPath('error.details.reason', 'terminal_shift_open');

        $other = Device::factory()->create(['store_id' => $this->store->id, 'code' => 'T02', 'install_id' => (string) Str::uuid(), 'status' => 'active']);
        $this->assertErrorCode($this->at($this->cashier, $other)->postJson('/api/v1/pos/shift', ['opening_float' => '0']), 409, 'CONFLICT')
            ->assertJsonPath('error.details.reason', 'cashier_shift_open');
    }

    public function test_a_manager_registers_this_computer_as_the_next_terminal(): void
    {
        $installId = (string) Str::uuid();
        $owner = $this->userWithRole('owner');

        $this->actingAsUser($owner)->withHeader('X-Compriva-Device', $installId)->getJson('/api/v1/pos/terminal')
            ->assertOk()
            ->assertJsonPath('data.terminal', null)
            ->assertJsonPath('data.can_register', true)
            ->assertJsonPath('data.payment_methods.*.code', ['cash', 'gcash', 'maya']);

        $this->assertErrorCode($this->actingAsUser($this->cashier)->withHeader('X-Compriva-Device', $installId)->postJson('/api/v1/pos/terminal', ['name' => 'Lane 2']), 403, 'FORBIDDEN');

        $this->actingAsUser($owner)->withHeader('X-Compriva-Device', $installId)->postJson('/api/v1/pos/terminal', ['name' => 'Lane 2'])
            ->assertCreated()
            ->assertJsonPath('data.code', 'T02')
            ->assertJsonPath('data.status', 'active');
        $this->assertErrorCode($this->actingAsUser($owner)->withHeader('X-Compriva-Device', $installId)->postJson('/api/v1/pos/terminal', ['name' => 'Again']), 409, 'CONFLICT');

        // Cashiers cannot use the POS anywhere else.
        $this->assertErrorCode($this->actingAsUser($this->userWithRole('inventory_clerk'))->getJson('/api/v1/pos/terminal'), 403, 'FORBIDDEN');
    }

    public function test_gcash_and_maya_qr_codes_are_uploaded_by_a_manager_of_payment_methods(): void
    {
        Storage::fake('local');
        $owner = $this->userWithRole('owner');
        $gcash = PaymentMethod::where('code', 'gcash')->firstOrFail();
        $chunk = fn (string $type, string $data) => pack('N', strlen($data)).$type.$data.pack('N', crc32($type.$data));
        $png = chr(0x89).'PNG'.chr(13).chr(10).chr(26).chr(10).$chunk('IHDR', pack('NNCCCCC', 200, 200, 8, 0, 0, 0, 0))
            .$chunk('IDAT', gzcompress(str_repeat(chr(0).str_repeat(chr(0), 200), 200))).$chunk('IEND', '');

        $this->assertErrorCode($this->actingAsUser($this->manager)->postJson("/api/v1/payment-methods/{$gcash->id}/qr", ['image' => UploadedFile::fake()->createWithContent('qr.png', $png)]), 403, 'FORBIDDEN');

        $url = $this->actingAsUser($owner)->postJson("/api/v1/payment-methods/{$gcash->id}/qr", ['image' => UploadedFile::fake()->createWithContent('qr.png', $png)])
            ->assertOk()->json('data.qr_url');
        $this->actingAsUser($owner)->patchJson("/api/v1/payment-methods/{$gcash->id}", ['account_name' => 'Aling Nena Store', 'account_number' => '0917 123 4567'])
            ->assertOk()->assertJsonPath('data.account_name', 'Aling Nena Store');
        $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/png');

        $this->assertErrorCode($this->actingAsUser($owner)->patchJson('/api/v1/payment-methods/'.PaymentMethod::where('code', 'cash')->value('id'), ['is_active' => false]), 422, 'BUSINESS_RULE_VIOLATION');
        $this->assertSame(['cash', 'gcash', 'maya'], PaymentMethod::where('is_active', true)->orderBy('sort_order')->pluck('code')->all());
    }
}
