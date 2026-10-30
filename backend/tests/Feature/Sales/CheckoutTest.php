<?php

namespace Tests\Feature\Sales;

use App\Models\Device;
use App\Models\Discount;
use App\Models\Payment;
use App\Models\Sale;
use App\Models\SaleDiscount;
use App\Models\SaleItem;
use App\Models\StockBatch;
use App\Models\StockMovement;
use App\Models\Unit;
use App\Support\Database\ImmutableRecordException;
use Illuminate\Support\Str;

/** Checkout: server-side pricing, payments, duplicate protection, snapshots and stock deduction. */
class CheckoutTest extends PosTestCase
{
    public function test_checkout_records_the_sale_with_snapshots_payments_and_stock_movements(): void
    {
        $this->openShift();

        // 2 pieces at ₱50 + 1 box of 12 at ₱550 = ₱650, paid with ₱1,000 cash.
        $response = $this->checkout([$this->line('2', extra: ['barcode' => '4800000000017']), $this->line('1', $this->box)], [$this->cash('1000')], ['expected_total' => '650.00'])
            ->assertCreated()
            ->assertJsonPath('meta.replayed', false)
            ->assertJsonPath('data.receipt_number', 'T01-000001')
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.terminal.code', 'T01')
            ->assertJsonPath('data.cashier.name', 'Juan Cashier')
            ->assertJsonPath('data.gross_amount', '650.0000')
            ->assertJsonPath('data.vatable_sales', '580.3600')   // 89.29 + 491.07
            ->assertJsonPath('data.vat_amount', '69.6400')       // 10.71 + 58.93
            ->assertJsonPath('data.grand_total', '650.0000')
            ->assertJsonPath('data.amount_paid', '1000.0000')
            ->assertJsonPath('data.change_due', '350.0000')
            ->assertJsonPath('data.items.1.unit_name', 'Box')
            ->assertJsonPath('data.items.1.quantity', '1.0000')
            ->assertJsonPath('data.payments.0.change_amount', '350.0000')
            ->assertJsonPath('data.store.name', $this->store->name);

        $sale = Sale::findOrFail($response->json('data.id'));
        $box = SaleItem::where('sale_id', $sale->id)->where('line_number', 2)->sole();
        $this->assertSame('Corned Beef 150g', $box->product_name);
        $this->assertSame('12.000000', $box->conversion_factor);
        $this->assertSame('12.0000', $box->base_quantity);
        $this->assertSame('VAT12', $box->tax_code);
        $this->assertSame('12.0000', $box->tax_rate);
        $this->assertSame('420.0000', $box->unit_cost); // 12 × ₱35 average cost
        $this->assertSame('4800000000017', SaleItem::where('sale_id', $sale->id)->where('line_number', 1)->value('barcode'));

        // 100 − 2 − 12 = 86, one movement per line, pointing at the line.
        $this->assertSame('86.0000', $this->onHand());
        $movements = StockMovement::where('type', 'sale')->get();
        $this->assertCount(2, $movements);
        $this->assertEqualsCanonicalizing(SaleItem::where('sale_id', $sale->id)->pluck('id')->all(), $movements->pluck('reference_id')->all());
        $this->assertSame($this->terminal->id, $movements->first()->device_id);
        $this->assertLedgerMatchesLevels();

        $this->assertSame(1, Device::find($this->terminal->id)->last_receipt_sequence);
    }

    public function test_completed_sales_are_preserved(): void
    {
        $this->openShift();
        $sale = Sale::findOrFail($this->checkout([$this->line('1')], [$this->cash('50')])->assertCreated()->json('data.id'));

        $this->expectException(ImmutableRecordException::class);
        $sale->update(['grand_total' => '1.00']);
    }

    public function test_sending_the_same_sale_twice_records_it_once(): void
    {
        $this->openShift();
        $payload = ['id' => (string) Str::uuid7(), 'lines' => [$this->line('3')], 'payments' => [$this->cash('200')]];

        $first = $this->at($this->cashier)->postJson('/api/v1/pos/checkout', $payload)->assertCreated();
        $this->at($this->cashier)->postJson('/api/v1/pos/checkout', $payload)
            ->assertOk()
            ->assertJsonPath('meta.replayed', true)
            ->assertJsonPath('data.receipt_number', $first->json('data.receipt_number'));

        $this->assertSame(1, Sale::count());
        $this->assertSame(1, Payment::count());
        $this->assertSame('97.0000', $this->onHand()); // deducted once
    }

    public function test_a_changed_total_saves_nothing(): void
    {
        $this->openShift();

        $this->assertErrorCode($this->checkout([$this->line('2')], [$this->cash('100')], ['expected_total' => '90.00']), 409, 'TOTAL_MISMATCH')
            ->assertJsonPath('error.details.actual', '100.00');

        $this->assertSame(0, Sale::count());
        $this->assertSame('100.0000', $this->onHand());
    }

    public function test_not_enough_stock_rolls_back_the_whole_sale(): void
    {
        $this->openShift();

        // 1 piece is fine, 9 boxes (108) is not: nothing is saved, not even the first line.
        $this->assertErrorCode($this->checkout([$this->line('1'), $this->line('9', $this->box)], [$this->cash('6000')]), 422, 'INSUFFICIENT_STOCK');

        $this->assertSame(0, Sale::count());
        $this->assertSame(0, SaleItem::count());
        $this->assertSame('100.0000', $this->onHand());
        $this->assertSame(0, Device::find($this->terminal->id)->last_receipt_sequence);
    }

    public function test_split_payment_with_gcash_reference_and_cash_change(): void
    {
        $this->openShift();

        // ₱100: ₱60 by GCash (exact), ₱50 cash → ₱10 change from the cash.
        $this->checkout([$this->line('2')], [
            ['method' => 'gcash', 'amount' => '60', 'reference' => '1009 876 5432'],
            $this->cash('50'),
        ])->assertCreated()
            ->assertJsonPath('data.amount_paid', '110.0000')
            ->assertJsonPath('data.change_due', '10.0000')
            ->assertJsonPath('data.payments.0.method', 'gcash')
            ->assertJsonPath('data.payments.0.amount', '60.0000')
            ->assertJsonPath('data.payments.0.reference_number', '1009 876 5432')
            ->assertJsonPath('data.payments.1.amount', '40.0000')
            ->assertJsonPath('data.payments.1.change_amount', '10.0000');
    }

    public function test_payment_rules(): void
    {
        $this->openShift();
        $lines = [$this->line('2')]; // ₱100

        $this->assertErrorCode($this->checkout($lines, [['method' => 'maya', 'amount' => '100']]), 422, 'VALIDATION_FAILED')
            ->assertJsonPath('error.details.fields', fn ($f) => isset($f['payments.0.reference']));
        $this->assertErrorCode($this->checkout($lines, [['method' => 'gcash', 'amount' => '120', 'reference' => 'X1']]), 422, 'VALIDATION_FAILED')
            ->assertJsonPath('error.message', 'GCash and Maya payments cannot be more than the amount due; only cash gives change.');
        $this->assertErrorCode($this->checkout($lines, [$this->cash('99.99')]), 422, 'VALIDATION_FAILED')
            ->assertJsonPath('error.message', '₱0.01 is still due.');
        $this->assertErrorCode($this->checkout($lines, [['method' => 'card', 'amount' => '100']]), 422, 'VALIDATION_FAILED')
            ->assertJsonPath('error.message', 'This payment method is not accepted.');
        $this->assertErrorCode($this->checkout($lines, [['method' => 'gcash', 'amount' => '100', 'reference' => 'A'], $this->cash('20')]), 422, 'VALIDATION_FAILED')
            ->assertJsonPath('error.message', 'This payment is not needed: the others already cover the total.');

        $this->assertSame(0, Sale::count());
    }

    public function test_selling_needs_a_registered_terminal_and_your_own_open_shift(): void
    {
        $this->assertErrorCode(
            $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/checkout', ['id' => (string) Str::uuid7(), 'lines' => [$this->line('1')], 'payments' => [$this->cash('50')]]),
            409, 'TERMINAL_REQUIRED',
        );
        $this->assertErrorCode($this->checkout([$this->line('1')], [$this->cash('50')]), 409, 'SHIFT_REQUIRED');

        $this->openShift($this->manager);
        $this->assertErrorCode($this->checkout([$this->line('1')], [$this->cash('50')]), 409, 'SHIFT_REQUIRED');
    }

    public function test_discounts_and_price_overrides_need_a_manager(): void
    {
        $this->openShift();
        $discounted = [$this->line('2', extra: ['discount' => ['type' => 'percentage', 'value' => '10']])];

        $this->assertErrorCode($this->checkout($discounted, [$this->cash('90')]), 403, 'APPROVAL_REQUIRED')
            ->assertJsonPath('error.details.permission', 'pos.apply_discount');
        $this->assertErrorCode($this->checkout($discounted, [$this->cash('90')], ['approval' => ['login' => 'maria', 'secret' => '000000']]), 403, 'APPROVAL_REQUIRED')
            ->assertJsonPath('error.details.reason', 'invalid_approver');

        $sale = $this->checkout($discounted, [$this->cash('90')], ['approval' => $this->managerApproval()])
            ->assertCreated()
            ->assertJsonPath('data.discount_total', '10.0000')
            ->assertJsonPath('data.grand_total', '90.0000')
            ->json('data');
        $this->assertSame($this->manager->id, SaleDiscount::where('sale_id', $sale['id'])->value('approved_by'));

        // Price override: regular price kept in the snapshot, approver recorded.
        $item = $this->checkout([$this->line('1', extra: ['unit_price' => '45.00'])], [$this->cash('45')], ['approval' => $this->managerApproval()])
            ->assertCreated()
            ->assertJsonPath('data.items.0.regular_unit_price', '50.0000')
            ->assertJsonPath('data.items.0.unit_price', '45.0000')
            ->assertJsonPath('data.items.0.price_overridden', true)
            ->json('data.items.0');
        $this->assertSame($this->manager->id, SaleItem::find($item['id'])->price_override_by);
    }

    public function test_senior_citizen_discount_needs_an_id_and_makes_the_sale_vat_exempt(): void
    {
        $this->openShift();
        $sc = Discount::where('code', 'SC20')->value('id');

        $this->assertErrorCode($this->checkout([$this->line('2')], [$this->cash('100')], ['discount' => ['discount_id' => $sc]]), 422, 'VALIDATION_FAILED');

        // ₱100 → ₱89.29 without VAT → 20% off (₱17.86) → ₱71.43, no VAT. Cashiers may apply it.
        $this->checkout([$this->line('2')], [$this->cash('100')], ['discount' => ['discount_id' => $sc, 'customer_id_number' => 'SC-12345'], 'expected_total' => '71.43'])
            ->assertCreated()
            ->assertJsonPath('data.discount_total', '17.8600')
            ->assertJsonPath('data.vat_exemption', '10.71')
            ->assertJsonPath('data.vat_amount', '0.0000')
            ->assertJsonPath('data.vat_exempt_sales', '71.4300')
            ->assertJsonPath('data.grand_total', '71.4300')
            ->assertJsonPath('data.customer_id_number', 'SC-12345')
            ->assertJsonPath('data.items.0.tax_type', 'vat_exempt')
            ->assertJsonPath('data.discounts.0.name', 'Senior Citizen 20%');
    }

    public function test_batch_tracked_items_leave_the_earliest_expiring_batch_first(): void
    {
        $milk = $this->product('Fresh Milk 1L', '95.00', product: ['track_batches' => true, 'track_expiry' => true]);
        $this->stockIn($milk, '5', '70.00', ['batch_number' => 'LATE', 'expiry_date' => now()->addDays(20)->toDateString()]);
        $this->stockIn($milk, '3', '72.00', ['batch_number' => 'SOON', 'expiry_date' => now()->addDays(5)->toDateString()]);
        $this->openShift();

        $item = $this->checkout([$this->line('4', sku: $milk)], [$this->cash('380')])->assertCreated()->json('data.items.0');

        $this->assertSame('0.0000', StockBatch::where('batch_number', 'SOON')->value('remaining_quantity'));
        $this->assertSame('4.0000', StockBatch::where('batch_number', 'LATE')->value('remaining_quantity'));
        $saleItem = SaleItem::find($item['id']);
        $this->assertSame(StockBatch::where('batch_number', 'SOON')->value('id'), $saleItem->stock_batch_id);
        $this->assertSame('286.0000', bcmul($saleItem->unit_cost, '4', 4)); // 3 × 72 + 1 × 70 at cost
        $this->assertLedgerMatchesLevels();
    }

    public function test_quote_prices_the_cart_like_checkout(): void
    {
        $this->at($this->cashier)->postJson('/api/v1/pos/quote', [
            'lines' => [$this->line('2', extra: ['discount' => ['type' => 'fixed_amount', 'value' => '5']]), $this->line('1', $this->box)],
        ])->assertOk()
            ->assertJsonPath('data.totals.gross_amount', '650.00')
            ->assertJsonPath('data.totals.discount_total', '5.00')
            ->assertJsonPath('data.totals.grand_total', '645.00')
            ->assertJsonPath('data.lines.1.unit_price', '550.0000')
            ->assertJsonPath('data.approval_needed', ['pos.apply_discount']);
    }

    public function test_units_and_quantities_are_checked_against_the_catalog(): void
    {
        $this->openShift();
        $kg = Unit::where('code', 'kg')->firstOrFail();

        $this->assertErrorCode($this->checkout([$this->line('1.5')], [$this->cash('100')]), 422, 'VALIDATION_FAILED')
            ->assertJsonPath('error.message', 'Piece must be a whole number.');
        $this->assertErrorCode($this->checkout([$this->line('1', $kg)], [$this->cash('100')]), 422, 'VALIDATION_FAILED')
            ->assertJsonPath('error.message', 'Corned Beef 150g is not sold in this unit.');

        // Weighed goods accept decimals: 1.25 kg of rice at ₱52/kg = ₱65.
        $rice = $this->product('Dinorado Rice', '52.00', tax: 'VAT_EXEMPT', baseUnit: 'kg');
        $this->stockIn($rice, '50', '40.00');
        $this->checkout([$this->line('1.25', $kg, $rice)], [$this->cash('65')])->assertCreated()
            ->assertJsonPath('data.grand_total', '65.0000')
            ->assertJsonPath('data.vat_exempt_sales', '65.0000');
        $this->assertSame('48.7500', $this->onHand($rice));
    }

    public function test_pos_catalog_finds_items_by_barcode_with_the_pack_unit(): void
    {
        $this->actingAsUser($this->manager)->postJson("/api/v1/skus/{$this->sku->id}/barcodes", ['barcode' => 'BOX-CB-12', 'type' => 'internal', 'unit_id' => $this->box->id])->assertCreated();

        $this->at($this->cashier)->getJson('/api/v1/pos/catalog?barcode=BOX-CB-12')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.matched_unit_id', $this->box->id)
            ->assertJsonPath('data.0.units.1.price', '550.0000')
            ->assertJsonPath('data.0.tax.code', 'VAT12')
            ->assertJsonPath('data.0.stock.on_hand', '100.0000');

        $this->at($this->cashier)->getJson('/api/v1/pos/catalog?q=corned')->assertOk()->assertJsonCount(1, 'data');
        $this->at($this->cashier)->getJson('/api/v1/pos/catalog?barcode=0000')->assertOk()->assertJsonCount(0, 'data');
    }
}
