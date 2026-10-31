<?php

namespace App\Http\Controllers\Api\V1\System;

use App\Domain\Settings\Settings;
use App\Http\Controllers\Controller;
use App\Models\Setting;
use App\Models\Store;
use App\Support\Audit\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Store details and store-wide settings (docs/README.md).
 * Needs settings.manage. Every change is audited with old and new values,
 * and reaches desktop terminals with their next sync.
 */
class SettingsController extends Controller
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => $this->payload()]);
    }

    public function update(Request $request, string $group, AuditLogger $audit): JsonResponse
    {
        abort_unless(array_key_exists($group, Settings::CATALOG), 404);
        $values = $request->validate(Settings::rules($group));
        Settings::update($request->user(), $group, $values, $audit);

        return response()->json(['data' => $this->payload()]);
    }

    public function updateStore(Request $request, AuditLogger $audit): JsonResponse
    {
        $store = $this->store();
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'legal_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'tin' => ['sometimes', 'nullable', 'string', 'max:20', 'regex:/^[0-9-]+$/'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'is_vat_registered' => ['sometimes', 'boolean'],
        ], ['tin.regex' => 'The TIN may only contain digits and dashes, e.g. 123-456-789-000.']);

        $before = $store->only(array_keys($data));
        $store->update($data);
        $changed = collect($store->getChanges())->except('updated_at');
        if ($changed->isNotEmpty()) {
            $audit->record('store.updated', $store, collect($before)->only($changed->keys())->all(), $changed->all());
        }

        return response()->json(['data' => $this->payload()]);
    }

    /** @return array<string, mixed> */
    private function payload(): array
    {
        $store = $this->store();
        // Who last changed each group (seeded defaults have no updated_by).
        $updated = Setting::whereNull('store_id')->whereIn('group', array_keys(Settings::CATALOG))->whereNotNull('updated_by')
            ->with('updater:id,name')->orderByDesc('updated_at')->get()->groupBy('group')
            ->map(fn ($rows) => ['at' => $rows->first()->updated_at?->toIso8601ZuluString(), 'by' => $rows->first()->updater?->name]);

        return [
            'store' => [
                'name' => $store->name, 'legal_name' => $store->legal_name, 'tin' => $store->tin, 'address' => $store->address,
                'phone' => $store->phone, 'email' => $store->email, 'is_vat_registered' => $store->is_vat_registered,
                'timezone' => $store->timezone, 'currency' => $store->currency,
            ],
            'settings' => collect(array_keys(Settings::CATALOG))->mapWithKeys(fn (string $group) => [$group => Settings::group($group)])->all(),
            'updated' => $updated,
            // Fixed in this version; shown so nobody looks for a switch.
            'fixed' => ['costing_method' => 'weighted_average', 'prices_include_vat' => true],
        ];
    }

    private function store(): Store
    {
        return Store::query()->orderBy('created_at')->firstOrFail();
    }
}
