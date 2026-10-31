<?php

namespace Tests\Feature\Customers;

use App\Models\AuditLog;
use App\Models\Customer;
use App\Models\Discount;
use App\Models\Sale;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Sync\SyncTestCase;

/** Customer records, attaching customers to sales (online and offline), and the terminal cache. */
class CustomerTest extends SyncTestCase
{
    public function test_cashiers_create_and_edit_customers_and_clerks_cannot(): void
    {
        $this->at($this->cashier)->postJson('/api/v1/customers', ['name' => 'Lola Nena', 'type' => 'senior_citizen'])
            ->assertStatus(422)->assertJsonPath('error.details.fields.id_number.0', 'Enter the senior citizen ID number.');

        $created = $this->at($this->cashier)->postJson('/api/v1/customers', [
            'name' => 'Lola Nena', 'type' => 'senior_citizen', 'id_number' => 'SC-QC-001', 'phone' => '0917 000 1111', 'birth_date' => '1950-03-02',
        ])->assertCreated()
            ->assertJsonPath('data.code', 'C-0001')
            ->assertJsonPath('data.type', 'senior_citizen')
            ->assertJsonPath('data.birth_date', '1950-03-02')
            ->assertJsonPath('data.purchases_count', 0)
            ->json('data');
        $this->at($this->cashier)->postJson('/api/v1/customers', ['name' => 'Second'])->assertCreated()->assertJsonPath('data.code', 'C-0002')->assertJsonPath('data.type', 'regular');

        // Changing the type to PWD keeps the stored ID number; clearing it is refused.
        $this->at($this->cashier)->patchJson("/api/v1/customers/{$created['id']}", ['type' => 'pwd'])->assertOk()->assertJsonPath('data.type', 'pwd');
        $this->at($this->cashier)->patchJson("/api/v1/customers/{$created['id']}", ['id_number' => null])->assertStatus(422);
        $this->at($this->cashier)->patchJson("/api/v1/customers/{$created['id']}", ['is_active' => false])->assertOk()->assertJsonPath('data.is_active', false);

        $audit = AuditLog::where('auditable_id', $created['id'])->orderBy('id')->pluck('event')->all();
        $this->assertSame(['customer.created', 'customer.updated', 'customer.updated'], $audit);

        $clerk = $this->userWithRole('inventory_clerk');
        $this->assertErrorCode($this->at($clerk)->getJson('/api/v1/customers'), 403, 'FORBIDDEN');
        $this->assertErrorCode($this->at($clerk)->postJson('/api/v1/customers', ['name' => 'X']), 403, 'FORBIDDEN');
    }

    public function test_search_filters_and_purchase_history(): void
    {
        $lola = Customer::factory()->seniorCitizen()->create(['name' => 'Lola Carmen', 'id_number' => 'SC-777', 'phone' => '0920 555 0404']);
        $store = Customer::factory()->create(['name' => 'Aling Rosa Store', 'type' => 'business', 'tin' => '123-456-789-000']);
        Customer::factory()->create(['name' => 'Old Customer', 'is_active' => false]);

        $this->openShift();
        $this->checkout([$this->line('2')], [$this->cash('100')], ['customer_id' => $lola->id])->assertCreated();
        $this->checkout([$this->line('1')], [$this->cash('50')], ['customer_id' => $lola->id])->assertCreated();
        $this->checkout([$this->line('1')], [$this->cash('50')], ['customer_id' => $store->id])->assertCreated();

        $search = fn (array $params) => collect($this->at($this->cashier)->getJson('/api/v1/customers?'.http_build_query($params))->assertOk()->json('data'))->pluck('name')->all();
        $this->assertSame(['Lola Carmen'], $search(['q' => '0404']));
        $this->assertSame(['Lola Carmen'], $search(['q' => 'SC-777']));
        $this->assertSame(['Aling Rosa Store'], $search(['q' => '456-789']));
        $this->assertSame(['Aling Rosa Store'], $search(['type' => 'business']));
        $this->assertSame(['Old Customer'], $search(['status' => 'inactive']));
        $this->assertSame(['Lola Carmen', 'Aling Rosa Store'], array_slice($search(['sort' => 'top']), 0, 2));

        $this->at($this->cashier)->getJson("/api/v1/customers/{$lola->id}")->assertOk()
            ->assertJsonPath('data.purchases_count', 2)
            ->assertJsonPath('data.purchases_total', '150.00');

        $history = $this->at($this->cashier)->getJson("/api/v1/customers/{$lola->id}/sales")->assertOk();
        $history->assertJsonCount(2, 'data')->assertJsonPath('data.0.terminal', 'T01')->assertJsonPath('data.0.items_count', 1)->assertJsonPath('meta.total', 2);

        // A voided sale stays in the history but no longer counts.
        $saleId = $history->json('data.1.id');
        $this->at($this->manager)->postJson("/api/v1/sales/{$saleId}/void", ['reason' => 'Wrong customer'])->assertOk();
        $this->at($this->cashier)->getJson("/api/v1/customers/{$lola->id}")->assertJsonPath('data.purchases_count', 1)->assertJsonPath('data.purchases_total', '50.00');
        $this->at($this->cashier)->getJson("/api/v1/customers/{$lola->id}/sales")->assertJsonPath('data.1.status', 'voided');
    }

    public function test_checkout_stores_a_snapshot_of_the_customer_and_uses_their_sc_id(): void
    {
        $lola = Customer::factory()->seniorCitizen()->create(['name' => 'Lola Carmen', 'id_number' => 'SC-QC-2019']);
        $store = Customer::factory()->create(['name' => 'Aling Rosa Store', 'type' => 'business', 'tin' => '123-456-789-000', 'address' => 'Brgy. Pinyahan, QC']);
        $gone = Customer::factory()->create(['is_active' => false]);
        $sc = Discount::where('code', 'SC20')->value('id');
        $this->openShift();

        // The SC discount takes the ID number from the customer record.
        $this->checkout([$this->line('2')], [$this->cash('100')], ['customer_id' => $lola->id, 'discount' => ['discount_id' => $sc], 'expected_total' => '71.43'])
            ->assertCreated()
            ->assertJsonPath('data.customer_id', $lola->id)
            ->assertJsonPath('data.customer_name', 'Lola Carmen')
            ->assertJsonPath('data.customer_id_number', 'SC-QC-2019')
            ->assertJsonPath('data.discounts.0.customer_id_number', 'SC-QC-2019');

        // A business customer's TIN and address go on the sale; later edits do not change it.
        $sale = $this->checkout([$this->line('1')], [$this->cash('50')], ['customer_id' => $store->id])->assertCreated()
            ->assertJsonPath('data.customer_tin', '123-456-789-000')
            ->assertJsonPath('data.customer_address', 'Brgy. Pinyahan, QC')
            ->json('data');
        $store->update(['name' => 'Rosa Trading', 'tin' => '999-999-999-000']);
        $this->assertSame('Aling Rosa Store', Sale::find($sale['id'])->customer_name);
        $this->assertSame('123-456-789-000', Sale::find($sale['id'])->customer_tin);

        $this->assertErrorCode($this->checkout([$this->line('1')], [$this->cash('50')], ['customer_id' => $gone->id]), 422, 'VALIDATION_FAILED')
            ->assertJsonPath('error.details.fields.customer_id.0', 'This customer is not active. Choose another customer or remove them from the sale.');
        $this->assertErrorCode($this->checkout([$this->line('1')], [$this->cash('50')], ['customer_id' => (string) Str::uuid()]), 422, 'VALIDATION_FAILED');

        // A typed name without a customer still works.
        $this->checkout([$this->line('1')], [$this->cash('50')], ['customer_name' => 'Walk-in Ana'])->assertCreated()
            ->assertJsonPath('data.customer_id', null)->assertJsonPath('data.customer_name', 'Walk-in Ana');
    }

    public function test_terminals_cache_active_customers_and_keep_offline_sales_for_deactivated_ones(): void
    {
        $lola = Customer::factory()->seniorCitizen()->create(['name' => 'Lola Carmen']);
        Customer::factory()->create(['name' => 'Inactive', 'is_active' => false]);

        $snapshot = $this->asTerminal()->pull()->assertOk()->json('data');
        $this->assertSame(['Lola Carmen'], collect($snapshot['snapshot']['customers'])->pluck('name')->all());
        $this->assertSame(['id', 'code', 'name', 'type', 'phone', 'tin', 'address', 'id_number'], array_keys($snapshot['snapshot']['customers'][0]));

        $added = Customer::factory()->create(['name' => 'New Buyer']);
        $lola->update(['is_active' => false]);
        $changes = collect($this->asTerminal()->pull($snapshot['cursor'])->json('data.changes'))->where('entity', 'customer')->values();
        $this->assertEqualsCanonicalizing(
            [['upsert', $added->id], ['delete', $lola->id]],
            $changes->map(fn ($c) => [$c['op'], $c['id']])->all(),
        );

        // Sold offline to Lola before the terminal heard she was deactivated: kept, linked.
        $shift = (string) Str::uuid7();
        $open = $this->shiftOpened($shift);
        $sale = $this->sale($shift, 1, [[$this->sku, '1']], [['method' => 'cash', 'amount' => '50']], ['customer_id' => $lola->id, 'customer_name' => null]);
        $this->push([$open, $sale])->assertJsonPath('data.results.*.status', ['applied', 'applied']);
        $stored = Sale::find($sale['payload']['id']);
        $this->assertSame($lola->id, $stored->customer_id);
        $this->assertSame('Lola Carmen', $stored->customer_name);

        // An unknown customer ID does not reject the sale either.
        $other = $this->sale($shift, 2, [[$this->sku, '1']], [['method' => 'cash', 'amount' => '50']], ['customer_id' => (string) Str::uuid(), 'customer_name' => 'Typed name']);
        $this->push([$other])->assertJsonPath('data.results.0.status', 'applied');
        $this->assertNull(Sale::find($other['payload']['id'])->customer_id);
        $this->assertSame('Typed name', Sale::find($other['payload']['id'])->customer_name);
    }

    public function test_a_forgotten_customer_is_added_to_a_completed_sale_without_changing_it(): void
    {
        $lola = Customer::factory()->seniorCitizen()->create(['name' => 'Lola Carmen']);
        $other = Customer::factory()->create();
        $this->openShift();
        $sale = $this->checkout([$this->line('2')], [$this->cash('100')])->assertCreated()->json('data');

        $this->at($this->cashier)->postJson("/api/v1/sales/{$sale['id']}/customer", ['customer_id' => $lola->id, 'reason' => 'Forgot to choose her'])
            ->assertOk()
            ->assertJsonPath('data.customer_id', null) // the sale and its receipt are unchanged
            ->assertJsonPath('data.customer_name', null)
            ->assertJsonPath('data.grand_total', '100.0000')
            ->assertJsonPath('data.customer_added.customer_name', 'Lola Carmen')
            ->assertJsonPath('data.customer_added.added_by', 'Juan Cashier')
            ->assertJsonPath('data.customer_added.reason', 'Forgot to choose her');

        // It counts in her history, marked as added later.
        $this->at($this->cashier)->getJson("/api/v1/customers/{$lola->id}")->assertJsonPath('data.purchases_count', 1)->assertJsonPath('data.purchases_total', '100.00');
        $this->at($this->cashier)->getJson("/api/v1/customers/{$lola->id}/sales")->assertJsonPath('data.0.customer_added_later', true);
        $this->assertTrue(AuditLog::where('event', 'sale.customer_added')->exists());

        // Only once, never replaced, never on a sale that already has a customer or is voided.
        $this->assertErrorCode($this->at($this->cashier)->postJson("/api/v1/sales/{$sale['id']}/customer", ['customer_id' => $other->id]), 409, 'CONFLICT');
        $chosen = $this->checkout([$this->line('1')], [$this->cash('50')], ['customer_id' => $other->id])->json('data');
        $this->assertErrorCode($this->at($this->cashier)->postJson("/api/v1/sales/{$chosen['id']}/customer", ['customer_id' => $lola->id]), 409, 'CONFLICT');
        $voided = $this->checkout([$this->line('1')], [$this->cash('50')])->json('data');
        $this->at($this->manager)->postJson("/api/v1/sales/{$voided['id']}/void", ['reason' => 'Mistake'])->assertOk();
        $this->assertErrorCode($this->at($this->cashier)->postJson("/api/v1/sales/{$voided['id']}/customer", ['customer_id' => $lola->id]), 409, 'CONFLICT');

        // Needs customers.manage; the link itself can never be edited or removed.
        $clerk = $this->userWithRole('inventory_clerk');
        $this->assertErrorCode($this->at($clerk)->postJson("/api/v1/sales/{$voided['id']}/customer", ['customer_id' => $lola->id]), 403, 'FORBIDDEN');
        $this->expectException(QueryException::class);
        DB::table('sale_customer_links')->where('sale_id', $sale['id'])->delete();
    }
}
