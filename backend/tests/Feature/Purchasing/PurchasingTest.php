<?php

namespace Tests\Feature\Purchasing;

use App\Models\InventoryLevel;
use App\Models\ProductSku;
use App\Models\PurchaseOrder;
use App\Models\StockBatch;
use App\Models\StockMovement;
use App\Models\Supplier;
use App\Models\User;
use Tests\Feature\Sales\PosTestCase;

/** Suppliers, purchase orders, partial receiving into stock, purchase history and cost tracking. */
class PurchasingTest extends PosTestCase
{
    private User $clerk;

    private Supplier $supplier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->clerk = $this->userWithRole('inventory_clerk');
        $this->supplier = Supplier::factory()->create(['code' => 'SMD', 'name' => 'San Miguel Distributors', 'is_active' => true]);
    }

    /** 2 boxes at ₱450 + 10 pieces at ₱36.50 = ₱1,265.00 */
    private function createOrder(?User $as = null, array $items = []): array
    {
        return $this->actingAsUser($as ?? $this->manager)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $this->supplier->id,
            'expected_date' => now()->addDays(3)->toDateString(),
            'items' => $items ?: [
                ['sku_id' => $this->sku->id, 'unit_id' => $this->box->id, 'quantity' => '2', 'unit_cost' => '450'],
                ['sku_id' => $this->product('Sardines 155g', '25.00')->id, 'unit_id' => $this->piece->id, 'quantity' => '10', 'unit_cost' => '36.50'],
            ],
        ])->assertCreated()->json('data');
    }

    public function test_suppliers_get_codes_and_only_purchasing_managers_edit_them(): void
    {
        $this->actingAsUser($this->manager)->postJson('/api/v1/suppliers', ['name' => 'Nestlé Philippines', 'payment_terms_days' => 30])
            ->assertCreated()->assertJsonPath('data.code', 'SUP-0001');
        $this->actingAsUser($this->manager)->postJson('/api/v1/suppliers', ['name' => 'Universal Robina'])
            ->assertCreated()->assertJsonPath('data.code', 'SUP-0002');

        $this->assertErrorCode($this->actingAsUser($this->clerk)->postJson('/api/v1/suppliers', ['name' => 'X']), 403, 'FORBIDDEN');
        $this->actingAsUser($this->clerk)->getJson('/api/v1/suppliers?q=nestl')->assertOk()->assertJsonCount(1, 'data');
        $this->assertErrorCode($this->actingAsUser($this->cashier)->getJson('/api/v1/suppliers'), 403, 'FORBIDDEN');
    }

    public function test_purchase_order_is_priced_on_the_server_and_frozen_once_ordered(): void
    {
        $order = $this->createOrder();
        $this->assertSame('PO-000001', $order['number']);
        $this->assertSame('draft', $order['status']);
        $this->assertSame('1265.0000', $order['total']);
        $this->assertSame('900.0000', $order['items'][0]['line_total']);
        $this->assertSame('12.000000', $order['items'][0]['conversion_factor']);

        // Drafts can be edited; ordering needs purchasing.approve.
        $this->actingAsUser($this->manager)->putJson("/api/v1/purchase-orders/{$order['id']}", [
            'supplier_id' => $this->supplier->id,
            'items' => [['sku_id' => $this->sku->id, 'unit_id' => $this->box->id, 'quantity' => '3', 'unit_cost' => '450']],
        ])->assertOk()->assertJsonPath('data.total', '1350.0000')->assertJsonCount(1, 'data.items');

        $this->assertErrorCode($this->actingAsUser($this->clerk)->postJson("/api/v1/purchase-orders/{$order['id']}/approve"), 403, 'FORBIDDEN');
        $this->assertErrorCode($this->actingAsUser($this->clerk)->postJson("/api/v1/purchase-orders/{$order['id']}/receive", [
            'lines' => [['purchase_order_item_id' => PurchaseOrder::find($order['id'])->items()->value('id'), 'quantity' => '1']],
        ]), 409, 'CONFLICT'); // not ordered yet

        $this->actingAsUser($this->manager)->postJson("/api/v1/purchase-orders/{$order['id']}/approve")
            ->assertOk()->assertJsonPath('data.status', 'ordered')->assertJsonPath('data.approved_by', $this->manager->name);
        $this->assertErrorCode($this->actingAsUser($this->manager)->putJson("/api/v1/purchase-orders/{$order['id']}", [
            'supplier_id' => $this->supplier->id, 'items' => [['sku_id' => $this->sku->id, 'unit_id' => $this->box->id, 'quantity' => '1', 'unit_cost' => '1']],
        ]), 409, 'CONFLICT');
    }

    public function test_partial_deliveries_post_stock_cost_and_complete_the_order(): void
    {
        $order = $this->createOrder();
        $this->actingAsUser($this->manager)->postJson("/api/v1/purchase-orders/{$order['id']}/approve")->assertOk();
        [$boxLine, $sardineLine] = $order['items'];

        // First delivery: 1 of 2 boxes, at ₱460 instead of ₱450. Stock: 100 + 12.
        $receipt = $this->actingAsUser($this->clerk)->postJson("/api/v1/purchase-orders/{$order['id']}/receive", [
            'supplier_reference' => 'DR-5521',
            'lines' => [['purchase_order_item_id' => $boxLine['id'], 'quantity' => '1', 'unit_cost' => '460']],
        ])->assertCreated()
            ->assertJsonPath('data.number', 'GR-000001')
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.total_cost', '460.0000')
            ->assertJsonPath('data.items.0.base_quantity', '12.0000')
            ->json('data');

        $this->assertSame('112.0000', $this->onHand());
        // Weighted average: (100 × 35 + 12 × 38.3333) ÷ 112; latest cost 460 ÷ 12.
        $this->assertSame('35.3571', InventoryLevel::where('product_sku_id', $this->sku->id)->value('average_cost'));
        $this->assertSame('38.3333', ProductSku::find($this->sku->id)->cost_price);
        $movement = StockMovement::where('type', 'purchase_receipt')->sole();
        $this->assertSame($receipt['id'], $movement->reference_id);
        $this->assertLedgerMatchesLevels();

        $this->actingAsUser($this->manager)->getJson("/api/v1/purchase-orders/{$order['id']}")
            ->assertJsonPath('data.status', 'partially_received')
            ->assertJsonPath('data.items.0.quantity_remaining', '1.0000')
            ->assertJsonCount(1, 'data.receipts');

        // More than is still expected is refused; the rest completes the order.
        $this->assertErrorCode($this->actingAsUser($this->clerk)->postJson("/api/v1/purchase-orders/{$order['id']}/receive", [
            'lines' => [['purchase_order_item_id' => $boxLine['id'], 'quantity' => '2']],
        ]), 422, 'VALIDATION_FAILED');
        $this->actingAsUser($this->clerk)->postJson("/api/v1/purchase-orders/{$order['id']}/receive", [
            'lines' => [['purchase_order_item_id' => $boxLine['id'], 'quantity' => '1'], ['purchase_order_item_id' => $sardineLine['id'], 'quantity' => '10']],
        ])->assertCreated()->assertJsonPath('data.number', 'GR-000002')->assertJsonPath('data.total_cost', '815.0000');

        $this->assertSame('received', PurchaseOrder::find($order['id'])->status->value);
        $this->assertSame('124.0000', $this->onHand());
        $this->assertErrorCode($this->actingAsUser($this->manager)->postJson("/api/v1/purchase-orders/{$order['id']}/cancel"), 409, 'CONFLICT');

        // Purchase history and cost tracking.
        $this->actingAsUser($this->clerk)->getJson('/api/v1/goods-receipts')->assertOk()->assertJsonCount(2, 'data');
        $this->actingAsUser($this->clerk)->getJson("/api/v1/skus/{$this->sku->id}/cost-history")
            ->assertOk()
            ->assertJsonCount(2, 'data.history')
            ->assertJsonPath('data.history.1.unit_cost', '460.0000')
            ->assertJsonPath('data.history.1.ordered_unit_cost', '450.0000')
            ->assertJsonPath('data.history.1.cost_per_base_unit', '38.3333')
            ->assertJsonPath('data.history.1.supplier', 'San Miguel Distributors');
        $this->actingAsUser($this->manager)->getJson('/api/v1/suppliers')->assertJsonPath('data.0.purchased_total', '1275.0000');
    }

    public function test_batch_tracked_goods_need_batch_and_expiry_when_received(): void
    {
        $milk = $this->product('Fresh Milk 1L', '95.00', product: ['track_batches' => true, 'track_expiry' => true]);
        $order = $this->createOrder(items: [['sku_id' => $milk->id, 'unit_id' => $this->piece->id, 'quantity' => '24', 'unit_cost' => '70']]);
        $this->actingAsUser($this->manager)->postJson("/api/v1/purchase-orders/{$order['id']}/approve")->assertOk();
        $line = $order['items'][0]['id'];

        $this->assertErrorCode($this->actingAsUser($this->clerk)->postJson("/api/v1/purchase-orders/{$order['id']}/receive", [
            'lines' => [['purchase_order_item_id' => $line, 'quantity' => '24']],
        ]), 422, 'VALIDATION_FAILED');

        $this->actingAsUser($this->clerk)->postJson("/api/v1/purchase-orders/{$order['id']}/receive", [
            'lines' => [['purchase_order_item_id' => $line, 'quantity' => '24', 'batch_number' => 'MLK-0901', 'expiry_date' => now()->addDays(10)->toDateString()]],
        ])->assertCreated();

        $batch = StockBatch::where('batch_number', 'MLK-0901')->sole();
        $this->assertSame('24.0000', $batch->remaining_quantity);
        $this->assertNotNull($batch->goods_receipt_item_id);
    }

    public function test_orders_can_be_cancelled_before_anything_arrives(): void
    {
        $order = $this->createOrder();
        $this->actingAsUser($this->manager)->postJson("/api/v1/purchase-orders/{$order['id']}/cancel", ['reason' => 'Supplier out of stock'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertErrorCode($this->actingAsUser($this->manager)->postJson("/api/v1/purchase-orders/{$order['id']}/approve"), 409, 'CONFLICT');
    }
}
