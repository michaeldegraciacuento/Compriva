<?php

namespace Tests\Feature\Sync;

use App\Models\InventoryLevel;
use App\Models\ProductPrice;
use App\Models\Role;
use App\Models\Setting;
use App\Models\SyncChange;
use App\Models\SyncConflict;
use App\Models\TerminalStockAllocation;
use App\Models\User;
use Illuminate\Support\Str;

/** Pulling the catalog incrementally, and stock allocations across terminals. */
class SyncPullAndAllocationTest extends SyncTestCase
{
    public function test_a_new_terminal_downloads_a_snapshot_with_everything_it_needs_offline(): void
    {
        $this->actingAsUser($this->manager)->postJson("/api/v1/skus/{$this->sku->id}/barcodes", ['barcode' => 'CB-150', 'type' => 'internal'])->assertCreated();

        $snapshot = $this->pull()->assertOk()->assertJsonPath('data.mode', 'snapshot')->json('data');
        $this->assertSame((int) SyncChange::max('id'), $snapshot['cursor']);

        $item = collect($snapshot['snapshot']['items'])->firstWhere('id', $this->sku->id);
        $this->assertSame('50.0000', $item['units'][0]['price']);
        $this->assertSame('CB-150', $item['barcodes'][0]['barcode']);
        $this->assertSame('VAT12', $item['tax']['code']);
        $this->assertSame(['cash', 'gcash', 'maya'], array_column($snapshot['snapshot']['payment_methods'], 'code'));
        // The manager has a PIN, so can sign in and approve offline; the PIN hash is there, no password.
        $manager = collect($snapshot['snapshot']['cashiers']['cashiers'])->firstWhere('username', 'maria');
        $this->assertNotEmpty($manager['pin_hash']);
        $this->assertArrayNotHasKey('password', $manager);
        $this->assertSame('T01', $snapshot['snapshot']['terminal']['code']);
    }

    public function test_changes_arrive_incrementally_by_cursor(): void
    {
        $cursor = $this->pull()->json('data.cursor');
        $this->pull($cursor)->assertOk()->assertJsonPath('data.mode', 'changes')->assertJsonCount(0, 'data.changes');

        // A price change and a deactivated product.
        $this->actingAsUser($this->manager)->postJson("/api/v1/skus/{$this->sku->id}/prices", ['unit_id' => $this->piece->id, 'tier' => 'retail', 'price' => '52.00'])->assertCreated();
        $gone = $this->product('Old Biscuits', '10.00');
        $this->actingAsUser($this->manager)->postJson("/api/v1/products/{$gone->product_id}/deactivate")->assertOk();

        $page = $this->pull($cursor)->assertOk()->json('data');
        $this->assertGreaterThan($cursor, $page['cursor']);
        $byId = collect($page['changes'])->where('entity', 'item')->keyBy('id');
        $this->assertSame('upsert', $byId[$this->sku->id]['op']);
        $this->assertSame('52.0000', $byId[$this->sku->id]['data']['units'][0]['price']);
        $this->assertSame('delete', $byId[$gone->id]['op']);

        // Nothing new after the returned cursor; a cursor ahead of the server means "start over".
        $this->pull($page['cursor'])->assertJsonCount(0, 'data.changes');
        $this->assertErrorCode($this->pull($page['cursor'] + 1000), 410, 'SYNC_CURSOR_INVALID');
    }

    public function test_pages_are_limited_and_cashier_changes_resend_the_cashier_list(): void
    {
        $cursor = $this->pull()->json('data.cursor');
        foreach (['60.00', '61.00', '62.00'] as $price) {
            ProductPrice::factory()->create(['product_sku_id' => $this->sku->id, 'unit_id' => $this->piece->id, 'price' => $price, 'effective_from' => now()->addDay()]);
        }
        $first = $this->pull($cursor, limit: 2)->assertJsonPath('data.has_more', true)->json('data');
        $this->pull($first['cursor'], limit: 2)->assertJsonPath('data.has_more', false);

        $this->actingAsUser($this->userWithRole('owner'))->putJson("/api/v1/users/{$this->cashier->id}/roles", ['roles' => [Role::where('name', 'manager')->value('id')]])->assertOk();
        $changes = $this->pull($cursor)->json('data.changes');
        $this->assertContains('cashiers', array_column($changes, 'entity'));
    }

    public function test_allocations_share_stock_fairly_and_reach_only_their_terminal(): void
    {
        $second = $this->terminal('T02');
        $this->pull(); // both terminals sync
        $this->pull(device: $second);

        // 100 in stock, two syncing terminals, 90% for terminals: 45 each, 10 stay central; asking again gives nothing more.
        $this->topUp()->assertOk()->assertJsonPath('data.allocations.0.remaining', '45.0000');
        $this->topUp($second)->assertOk()->assertJsonPath('data.allocations.0.remaining', '45.0000');
        $this->topUp()->assertOk()->assertJsonCount(0, 'data.allocations');
        $this->assertSame('90.0000', InventoryLevel::where('product_sku_id', $this->sku->id)->value('quantity_allocated'));

        // A third terminal joins: the first two now hold more than their share and are told to release it.
        $third = $this->terminal('T03');
        $this->pull(device: $third);
        $this->topUp()->assertOk()->assertJsonPath('data.excess.0.quantity', '15.0000'); // share is 90 ÷ 3 = 30
        $this->push([$this->op('allocation.release', ['sku_id' => $this->sku->id, 'quantity' => '15'])])->assertJsonPath('data.results.0.status', 'applied');
        $this->topUp($third)->assertOk()->assertJsonPath('data.allocations.0.remaining', '25.0000'); // the 10 central + 15 released, up to its share of 30

        // Each terminal pulls only its own allocation.
        $cursor = 0;
        $mine = collect($this->pull($cursor)->json('data.changes'))->where('entity', 'allocation');
        $this->assertCount(1, $mine);
        $this->assertSame('30.0000', $mine->first()['data']['remaining']);
    }

    public function test_allocated_stock_cannot_be_sold_online_or_by_another_terminal(): void
    {
        Setting::whereNull('store_id')->where('group', 'pos')->where('key', 'allocation_share_percent')->update(['value' => json_encode(100)]);
        $second = $this->terminal('T02');
        $this->pull();
        $this->pull(device: $second);
        $this->topUp();
        $this->topUp($second);

        // The web POS (central stock, its own browser terminal) has nothing left: the desktop terminals hold it all.
        $web = $this->terminal('T09');
        $this->at($this->cashier, $web)->postJson('/api/v1/pos/shift', ['opening_float' => '0'])->assertCreated();
        $this->assertErrorCode($this->at($this->cashier, $web)->postJson('/api/v1/pos/checkout', [
            'id' => (string) Str::uuid7(), 'lines' => [$this->line('1')], 'payments' => [$this->cash('50')],
        ]), 422, 'INSUFFICIENT_STOCK');

        // Both terminals sell their own 50 offline; nothing conflicts.
        foreach ([[$this->terminal, 'A'], [$second, 'B']] as [$device, $label]) {
            $shift = (string) Str::uuid7();
            $open = $this->op('shift.opened', ['shift_id' => $shift, 'cashier_id' => $this->userWithRole('cashier')->id, 'opening_float' => '0', 'opened_at' => now()->toIso8601ZuluString()]);
            $this->cashier = User::find($open['payload']['cashier_id']);
            $sale = $this->sale($shift, 1, [[$this->sku, '50']], [['method' => 'cash', 'amount' => '2500']], device: $device);
            $this->push([$open, $sale], $device)->assertJsonPath('data.results.1.status', 'applied')->assertJsonCount(0, 'data.results.1.result.conflicts');
        }

        $this->assertSame('0.0000', $this->onHand());
        $this->assertSame('0.0000', InventoryLevel::where('product_sku_id', $this->sku->id)->value('quantity_allocated'));
        $this->assertSame([], SyncConflict::pluck('message')->all());
        $this->assertLedgerMatchesLevels();
    }

    public function test_a_terminal_releases_stock_and_managers_allocate_only_free_stock(): void
    {
        $this->pull();
        $this->topUp(); // 90 to T01
        $this->push([$this->op('allocation.release', ['sku_id' => $this->sku->id, 'quantity' => '30'])])
            ->assertJsonPath('data.results.0.result.remaining', '60.0000');
        $this->assertSame('60.0000', InventoryLevel::where('product_sku_id', $this->sku->id)->value('quantity_allocated'));

        $second = $this->terminal('T02');
        $this->assertErrorCode($this->actingAsUser($this->manager)->postJson("/api/v1/terminals/{$second->id}/allocations", ['sku_id' => $this->sku->id, 'quantity' => '41']), 422, 'INSUFFICIENT_STOCK');
        $this->actingAsUser($this->manager)->postJson("/api/v1/terminals/{$second->id}/allocations", ['sku_id' => $this->sku->id, 'quantity' => '40'])->assertCreated();
        $this->assertSame('40.0000', TerminalStockAllocation::where('device_id', $second->id)->sole()->availableQuantity());

        $this->actingAsUser($this->manager)->getJson('/api/v1/terminals')->assertOk()->assertJsonPath('data.0.allocated_units', '60.0000');
        $this->actingAsUser($this->manager)->getJson("/api/v1/terminals/{$this->terminal->id}")->assertOk()->assertJsonPath('data.allocations.0.released', '30.0000');
        $this->assertErrorCode($this->actingAsUser($this->cashier)->getJson('/api/v1/terminals'), 403, 'FORBIDDEN');
    }
}
