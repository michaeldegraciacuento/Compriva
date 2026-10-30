<?php

namespace Tests\Feature\Reports;

use App\Models\Permission;
use App\Models\Role;
use App\Models\Sale;
use App\Models\User;
use Tests\Feature\Sales\PosTestCase;

/**
 * Cash in/out and the reports, against one worked day (all at ₱35 average cost):
 *   A  2 pc × ₱50, cash                → ₱100.00, VAT 10.71, cost 70
 *   B  1 box (12 pc) × ₱550, GCash     → ₱550.00, VAT 58.93, cost 420
 *   C  1 pc, cash, voided              → excluded
 *   return 1 pc of A, cash refund      → ₱50.00, VAT 5.36, cost 35 back to stock
 */
class ReportsAndCashTest extends PosTestCase
{
    private function sellTheDay(): void
    {
        $this->openShift();
        $a = $this->checkout([$this->line('2')], [$this->cash('100')])->assertCreated()->json('data');
        $this->checkout([$this->line('1', $this->box)], [['method' => 'gcash', 'amount' => '550', 'reference' => 'GC-1']])->assertCreated();
        $c = $this->checkout([$this->line('1')], [$this->cash('50')])->assertCreated()->json('data');
        $this->at($this->manager)->postJson("/api/v1/sales/{$c['id']}/void", ['reason' => 'Mistake'])->assertOk();
        $this->at($this->cashier)->postJson("/api/v1/sales/{$a['id']}/returns", [
            'reason' => 'Dented', 'items' => [['sale_item_id' => $a['items'][0]['id'], 'quantity' => '1']],
            'refund_method' => 'cash', 'approval' => $this->managerApproval(),
        ])->assertCreated();
    }

    private function report(string $key, array $query = [], ?User $as = null)
    {
        return $this->actingAsUser($as ?? $this->manager)->getJson("/api/v1/reports/{$key}?".http_build_query($query));
    }

    public function test_cash_in_and_out_need_approval_and_change_the_expected_cash(): void
    {
        $this->openShift();
        $this->checkout([$this->line('2')], [$this->cash('100')])->assertCreated();

        $this->assertErrorCode($this->at($this->cashier)->postJson('/api/v1/pos/cash-movements', ['type' => 'cash_in', 'amount' => '500', 'reason' => 'Coins from office']), 403, 'APPROVAL_REQUIRED');
        $this->at($this->cashier)->postJson('/api/v1/pos/cash-movements', ['type' => 'cash_in', 'amount' => '500', 'reason' => 'Coins from office', 'approval' => $this->managerApproval()])
            ->assertCreated()
            ->assertJsonPath('data.summary.cash_in', '500.0000')
            ->assertJsonPath('data.cash_movements.0.type', 'cash_in');

        // Drawer: 1000 + 100 + 500 = 1600. Taking out more than that is refused.
        $this->assertErrorCode($this->at($this->manager)->postJson('/api/v1/pos/cash-movements', ['type' => 'cash_drop', 'amount' => '2000', 'reason' => 'To safe']), 422, 'VALIDATION_FAILED');
        // Another cashier may not touch this shift's drawer.
        $this->assertErrorCode($this->at($this->userWithRole('cashier'))->postJson('/api/v1/pos/cash-movements', ['type' => 'cash_out', 'amount' => '120', 'reason' => 'Ice for fish', 'approval' => $this->managerApproval()]), 403, 'FORBIDDEN');
    }

    public function test_cash_out_and_drop_reduce_expected_cash_and_closing_shows_the_variance(): void
    {
        $this->openShift();
        $this->checkout([$this->line('2')], [$this->cash('100')])->assertCreated();
        $approval = ['approval' => $this->managerApproval()];
        $this->at($this->cashier)->postJson('/api/v1/pos/cash-movements', ['type' => 'cash_out', 'amount' => '120', 'reason' => 'Ice for fish'] + $approval)->assertCreated();
        $this->at($this->cashier)->postJson('/api/v1/pos/cash-movements', ['type' => 'cash_drop', 'amount' => '500', 'reason' => 'To safe'] + $approval)
            ->assertJsonPath('data.summary.expected_cash', '480.0000'); // 1000 + 100 − 120 − 500

        $this->at($this->cashier)->postJson('/api/v1/pos/shift/close', ['counted_cash' => '475'])
            ->assertOk()->assertJsonPath('data.cash_variance', '-5.0000');

        // Managers see shift history; cashiers do not.
        $this->actingAsUser($this->manager)->getJson('/api/v1/shifts')
            ->assertOk()->assertJsonPath('data.0.cash_variance', '-5.0000')->assertJsonPath('data.0.sales_total', '100.0000')
            ->assertJsonCount(2, 'data.0.cash_movements');
        $this->assertErrorCode($this->actingAsUser($this->cashier)->getJson('/api/v1/shifts'), 403, 'FORBIDDEN');
    }

    public function test_sales_report_totals_cost_and_profit(): void
    {
        $this->sellTheDay();

        $report = $this->report('sales', ['group' => 'month'])->assertOk()->json('data');
        $this->assertSame('Monthly sales', $report['title']);
        $this->assertSame([
            'period' => 'Total', 'transactions' => 2, 'gross_sales' => '650.00', 'discounts' => '0.00', 'net_sales' => '650.00',
            'refunds' => '50.00', 'net_after_refunds' => '600.00', 'vat' => '64.28', 'average_sale' => '325.00',
            // revenue (650 − 69.64) − (50 − 5.36) = 535.72; cost 70 + 420 − 35 = 455
            'cogs' => '455.00', 'gross_profit' => '80.72', 'margin' => '15.1',
        ], $report['totals']);

        $this->report('gross-profit')->assertOk()->assertJsonPath('data.totals.revenue', '535.72')->assertJsonPath('data.totals.gross_profit', '80.72');
        // Daily: one row per day of the month so far.
        $this->assertCount(now('Asia/Manila')->day, $this->report('sales', ['group' => 'day'])->json('data.rows'));
    }

    public function test_product_category_payment_cashier_and_stock_reports(): void
    {
        $this->sellTheDay();

        $this->report('product-sales')->assertOk()
            ->assertJsonPath('data.rows.0.product', 'Corned Beef 150g')
            ->assertJsonPath('data.rows.0.quantity', '14')
            ->assertJsonPath('data.rows.0.returned', '1')
            ->assertJsonPath('data.rows.0.net_sales', '600.00')
            ->assertJsonPath('data.rows.0.gross_profit', '80.72');
        $this->report('category-sales')->assertOk()->assertJsonPath('data.totals.net_sales', '600.00')->assertJsonPath('data.rows.0.share', '100.0');
        $this->report('cogs')->assertOk()->assertJsonPath('data.rows.0.quantity', '13')->assertJsonPath('data.rows.0.average_cost', '35.0000');

        $payments = $this->report('payment-summary')->assertOk()->json('data');
        $this->assertSame(['Cash', 1, '100.00', '50.00', '50.00', '8.3'], [$payments['rows'][0]['method'], $payments['rows'][0]['payments'], $payments['rows'][0]['amount'], $payments['rows'][0]['refunds'], $payments['rows'][0]['net'], $payments['rows'][0]['share']]);
        $this->assertSame('550.00', $payments['rows'][1]['net']);
        $this->assertSame('600.00', $payments['totals']['net']);

        $this->report('cashier-performance')->assertOk()
            ->assertJsonPath('data.rows.0.cashier', 'Juan Cashier')
            ->assertJsonPath('data.rows.0.transactions', 2)
            ->assertJsonPath('data.rows.0.voids', 1)
            ->assertJsonPath('data.rows.0.refunds', '50.00');

        // Ledger: 100 in, 14 sold (the void put its piece back), 1 returned → 87.
        $this->report('stock-movement')->assertOk()
            ->assertJsonPath('data.rows.0.received', '100')
            ->assertJsonPath('data.rows.0.sold', '14')
            ->assertJsonPath('data.rows.0.returned', '1')
            ->assertJsonPath('data.rows.0.closing', '87');
        $this->report('inventory-valuation')->assertOk()
            ->assertJsonPath('data.rows.0.on_hand', '87')
            ->assertJsonPath('data.totals.cost_value', '3045.00')
            ->assertJsonPath('data.totals.retail_value', '4350.00');
        $this->assertSame(3, Sale::count());
    }

    public function test_expiring_products_lists_batches_inside_the_window(): void
    {
        $milk = $this->product('Fresh Milk 1L', '95.00', product: ['track_batches' => true, 'track_expiry' => true]);
        $this->stockIn($milk, '6', '70', ['batch_number' => 'SOON', 'expiry_date' => now('Asia/Manila')->addDays(5)->toDateString()]);
        $this->stockIn($milk, '6', '70', ['batch_number' => 'LATER', 'expiry_date' => now('Asia/Manila')->addDays(60)->toDateString()]);

        $this->report('expiring-products', ['days' => 30])->assertOk()
            ->assertJsonCount(1, 'data.rows')
            ->assertJsonPath('data.rows.0.batch', 'SOON')
            ->assertJsonPath('data.rows.0.days_left', 5)
            ->assertJsonPath('data.rows.0.cost_value', '420.00');
    }

    public function test_cost_and_profit_need_their_own_permission(): void
    {
        $this->sellTheDay();
        $role = Role::create(['name' => 'supervisor', 'display_name' => 'Supervisor', 'is_system' => false]);
        $role->permissions()->attach(Permission::whereIn('name', ['reports.view'])->pluck('id'));
        $viewer = User::factory()->create();
        $viewer->roles()->attach($role->id);

        $keys = array_column($this->actingAsUser($viewer)->getJson('/api/v1/reports')->assertOk()->json('data'), 'key');
        $this->assertContains('sales', $keys);
        $this->assertNotContains('gross-profit', $keys);
        $this->assertNotContains('cogs', $keys);

        $columns = array_column($this->report('sales', as: $viewer)->assertOk()->json('data.columns'), 'key');
        $this->assertNotContains('cogs', $columns);
        $this->assertNotContains('gross_profit', $columns);
        $this->assertArrayNotHasKey('margin', $this->report('sales', as: $viewer)->json('data.totals'));
        $this->assertErrorCode($this->report('gross-profit', as: $viewer), 403, 'FORBIDDEN');
        $this->assertErrorCode($this->report('sales', as: $this->cashier), 403, 'FORBIDDEN');
    }

    public function test_exports_as_csv_excel_and_pdf(): void
    {
        $this->sellTheDay();

        $csv = $this->report('payment-summary', ['format' => 'csv'])->assertOk()->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $this->assertStringContainsString('attachment; filename="compriva-payment-summary-', $csv->headers->get('Content-Disposition'));
        $lines = explode("\n", trim(substr($csv->getContent(), 3)));
        $this->assertSame('Method,Payments,Collected,"Change given",Refunded,Net,Share', $lines[1]);
        $this->assertSame('Cash,1,100.00,0.00,50.00,50.00,8.3', $lines[2]);

        $xlsx = $this->report('product-sales', ['format' => 'xlsx'])->assertOk()->getContent();
        $files = self::unzip($xlsx);
        $this->assertSame(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml'], array_keys($files));
        foreach ($files as $name => $content) {
            $this->assertNotFalse(simplexml_load_string($content), "{$name} is well-formed XML");
        }
        $this->assertStringContainsString('<c r="G5" s="3"><v>650.00</v></c>', $files['xl/worksheets/sheet1.xml']); // sales as a number
        $this->assertStringContainsString('Corned Beef 150g', $files['xl/worksheets/sheet1.xml']);

        $pdf = $this->report('sales', ['format' => 'pdf'])->assertOk()->assertHeader('Content-Type', 'application/pdf')->getContent();
        $this->assertStringStartsWith('%PDF-', $pdf);
    }

    /** Reads our ZIP back through its central directory: proves the archive is well-formed. @return array<string, string> */
    private static function unzip(string $zip): array
    {
        $end = strrpos($zip, "PK\x05\x06");
        $eocd = unpack('Vsig/vdisk/vcd_disk/ventries/vtotal/Vsize/Voffset', substr($zip, $end, 22));
        $files = [];
        $pos = $eocd['offset'];
        for ($i = 0; $i < $eocd['total']; $i++) {
            $cd = unpack('Vsig/vmade/vneeded/vflags/vmethod/vtime/vdate/Vcrc/Vcsize/Vusize/vnamelen/vextra/vcomment/vdisk/vinternal/Vexternal/Voffset', substr($zip, $pos, 46));
            $name = substr($zip, $pos + 46, $cd['namelen']);
            $local = unpack('Vsig/vneeded/vflags/vmethod/vtime/vdate/Vcrc/Vcsize/Vusize/vnamelen/vextra', substr($zip, $cd['offset'], 30));
            $data = gzinflate(substr($zip, $cd['offset'] + 30 + $local['namelen'] + $local['extra'], $cd['csize']));
            self::assertSame($cd['crc'], crc32($data), "{$name} CRC");
            $files[$name] = $data;
            $pos += 46 + $cd['namelen'] + $cd['extra'] + $cd['comment'];
        }

        return $files;
    }
}
