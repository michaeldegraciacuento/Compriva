<?php

namespace Tests\Feature\System;

use App\Domain\Settings\Settings;
use App\Models\AuditLog;
use App\Models\Customer;
use App\Models\SyncChange;
use App\Support\Database\ImmutableRecordException;
use Illuminate\Support\Carbon;
use Tests\Feature\Sync\SyncTestCase;

/** Store details and settings (owner), and the read-only audit log (owner and manager). */
class SettingsAndAuditTest extends SyncTestCase
{
    public function test_the_owner_changes_receipt_settings_and_every_change_is_audited_and_synced(): void
    {
        $owner = $this->userWithRole('owner');
        $this->assertErrorCode($this->at($this->manager)->getJson('/api/v1/settings'), 403, 'FORBIDDEN');

        $this->at($owner)->getJson('/api/v1/settings')->assertOk()
            ->assertJsonPath('data.settings.receipt.footer_text', 'Thank you for shopping!') // seeded
            ->assertJsonPath('data.settings.pos.allocation_share_percent', 90)
            ->assertJsonPath('data.settings.sync.max_offline_hours', 72)
            ->assertJsonPath('data.fixed.costing_method', 'weighted_average');
    }

    public function test_settings_are_validated_normalized_and_used(): void
    {
        $owner = $this->userWithRole('owner');
        $cursor = (int) SyncChange::max('id');

        $this->at($owner)->putJson('/api/v1/settings/receipt', [
            'header_lines' => ['  Open daily 7am-9pm ', '', 'Brgy. Pinyahan, QC'],
            'footer_text' => 'Salamat po!',
        ])->assertOk()
            ->assertJsonPath('data.settings.receipt.header_lines', ['Open daily 7am-9pm', 'Brgy. Pinyahan, QC'])
            ->assertJsonPath('data.settings.receipt.footer_text', 'Salamat po!')
            ->assertJsonPath('data.settings.receipt.show_vat_breakdown', true)
            ->assertJsonPath('data.updated.receipt.by', $owner->name);

        // One audit entry with only what changed.
        $entry = AuditLog::where('event', 'settings.updated')->sole();
        $this->assertEquals(['group' => 'receipt', 'header_lines' => [], 'footer_text' => 'Thank you for shopping!'], $entry->old_values);
        $this->assertSame('Salamat po!', $entry->new_values['footer_text']);

        // Saving the same values again changes and records nothing.
        $this->at($owner)->putJson('/api/v1/settings/receipt', ['footer_text' => 'Salamat po!'])->assertOk();
        $this->assertSame(1, AuditLog::where('event', 'settings.updated')->count());

        // Receipts and terminals use them.
        $this->openShift();
        $this->checkout([$this->line('1')], [$this->cash('50')])->assertCreated()
            ->assertJsonPath('data.receipt.footer_text', 'Salamat po!')
            ->assertJsonPath('data.receipt.header_lines.0', 'Open daily 7am-9pm');
        $this->assertTrue(SyncChange::where('id', '>', $cursor)->where('entity', 'setting')->exists());

        $this->assertErrorCode($this->at($owner)->putJson('/api/v1/settings/pos', ['allocation_share_percent' => 5]), 422, 'VALIDATION_FAILED');
        $this->assertErrorCode($this->at($owner)->putJson('/api/v1/settings/receipt', ['header_lines' => array_fill(0, 6, 'x')]), 422, 'VALIDATION_FAILED');
        $this->at($owner)->putJson('/api/v1/settings/unknown', [])->assertNotFound();

        $this->at($owner)->putJson('/api/v1/settings/pos', ['max_cash_in_drawer' => '15000', 'allocation_share_percent' => '80'])->assertOk()
            ->assertJsonPath('data.settings.pos.max_cash_in_drawer', '15000.0000')
            ->assertJsonPath('data.settings.pos.allocation_share_percent', 80);
        $this->assertSame(80, Settings::get('pos', 'allocation_share_percent'));
        $this->at($this->cashier)->getJson('/api/v1/pos/terminal')->assertJsonPath('data.pos.max_cash_in_drawer', '15000.0000');

        // How long terminals may stay offline: their cashier list expires accordingly.
        Carbon::setTestNow('2026-11-01 08:00:00');
        $this->at($owner)->putJson('/api/v1/settings/sync', ['max_offline_hours' => 24])->assertOk();
        $snapshot = $this->asTerminal()->pull()->json('data.snapshot');
        $this->assertSame(24, $snapshot['settings']['pos']['max_offline_hours']);
        $this->assertSame('15000.0000', $snapshot['settings']['pos']['max_cash_in_drawer']);
        $this->assertSame('2026-11-02T08:00:00Z', $snapshot['cashiers']['valid_until']);
        Carbon::setTestNow();
    }

    public function test_store_details_are_validated_audited_and_reach_terminals(): void
    {
        $owner = $this->userWithRole('owner');

        $this->assertErrorCode($this->at($owner)->patchJson('/api/v1/settings/store', ['tin' => 'ABC']), 422, 'VALIDATION_FAILED');
        $this->at($owner)->patchJson('/api/v1/settings/store', ['name' => 'Aling Nena Grocery', 'tin' => '123-456-789-000'])->assertOk()
            ->assertJsonPath('data.store.name', 'Aling Nena Grocery')
            ->assertJsonPath('data.store.tin', '123-456-789-000');

        $entry = AuditLog::where('event', 'store.updated')->sole();
        $this->assertSame('Aling Nena Grocery', $entry->new_values['name']);
        $this->assertArrayNotHasKey('updated_at', $entry->new_values);

        $this->assertSame('Aling Nena Grocery', $this->asTerminal()->pull()->json('data.snapshot.settings.store.name'));
    }

    public function test_the_audit_log_is_filtered_labelled_exported_and_read_only(): void
    {
        $owner = $this->userWithRole('owner');
        $lola = Customer::factory()->create(['name' => 'Lola Carmen']);
        $this->openShift();
        $sale = $this->checkout([$this->line('1')], [$this->cash('50')])->json('data');
        $this->at($this->manager)->postJson("/api/v1/sales/{$sale['id']}/void", ['reason' => 'Wrong item'])->assertOk();
        $this->at($this->cashier)->patchJson("/api/v1/customers/{$lola->id}", ['phone' => '0917 111 2222'])->assertOk();

        $this->assertErrorCode($this->at($this->cashier)->getJson('/api/v1/audit-logs'), 403, 'FORBIDDEN');

        // Newest first, with who, the terminal, and a readable subject.
        $voids = $this->at($this->manager)->getJson('/api/v1/audit-logs?event=sale.voided')->assertOk();
        $voids->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.user.name', $this->manager->name)
            ->assertJsonPath('data.0.subject.type', 'sale')
            ->assertJsonPath('data.0.subject.label', $sale['receipt_number']);

        $customer = $this->at($this->manager)->getJson("/api/v1/audit-logs?subject_type=customer&subject_id={$lola->id}")->assertOk();
        $customer->assertJsonPath('data.0.event', 'customer.updated')->assertJsonPath('data.0.subject.label', 'Lola Carmen')
            ->assertJsonPath('data.0.new_values.phone', '0917 111 2222');

        $byCategory = collect($this->at($this->manager)->getJson('/api/v1/audit-logs?category=sale')->json('data'))->pluck('event')->unique()->sort()->values()->all();
        $this->assertSame(['sale.completed', 'sale.voided'], $byCategory);
        $byUser = collect($this->at($this->manager)->getJson("/api/v1/audit-logs?user_id={$this->cashier->id}")->json('data'))->pluck('user.id')->unique()->all();
        $this->assertSame([$this->cashier->id], $byUser);
        $this->assertSame(0, count($this->at($this->manager)->getJson('/api/v1/audit-logs?from=2020-01-01&to=2020-01-31')->json('data')));
        $this->at($this->manager)->getJson('/api/v1/audit-logs?q=Juan')->assertOk(); // by the person's name

        $filters = $this->at($this->manager)->getJson('/api/v1/audit-logs/filters')->assertOk()->json('data');
        $this->assertContains('sale.voided', array_column($filters['events'], 'event'));
        $this->assertContains($this->cashier->id, array_column($filters['users'], 'id'));

        // CSV download: the filtered rows, and the download itself is recorded.
        $csv = $this->at($owner)->get('/api/v1/audit-logs?format=csv&category=sale');
        $csv->assertOk()->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $lines = array_values(array_filter(explode("\n", trim(substr($csv->getContent(), 3)))));
        $this->assertStringStartsWith('Time,Event,User,Terminal', $lines[0]);
        $this->assertStringContainsString($sale['receipt_number'], $csv->getContent());
        $this->assertTrue(AuditLog::where('event', 'audit.exported')->exists());

        $this->expectException(ImmutableRecordException::class);
        AuditLog::first()->update(['event' => 'tampered']);
    }
}
