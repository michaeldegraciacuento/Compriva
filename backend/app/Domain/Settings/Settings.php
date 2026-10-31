<?php

namespace App\Domain\Settings;

use App\Models\Setting;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use Illuminate\Support\Facades\DB;

/**
 * Store-wide settings (docs/README.md). Only settings the system
 * actually uses are listed here; each has a default and validation rules.
 * Values live in `settings` (global rows, store_id NULL). Saving one records
 * a sync change (SyncChangeObserver), so terminals pick it up.
 */
final class Settings
{
    /**
     * group => key => [default, rules]
     *
     * @var array<string, array<string, array{0: mixed, 1: list<mixed>}>>
     */
    public const CATALOG = [
        'receipt' => [
            'header_lines' => [[], ['array', 'max:5']],
            'footer_text' => ['Thank you for shopping!', ['nullable', 'string', 'max:200']],
            'show_vat_breakdown' => [true, ['boolean']],
        ],
        'pos' => [
            'allow_over_allocation' => [false, ['boolean']],
            'allocation_share_percent' => [90, ['integer', 'min:10', 'max:100']],
            'max_cash_in_drawer' => ['20000.0000', ['decimal:0,2', 'min:0', 'max:9999999']],
        ],
        'sync' => [
            'max_offline_hours' => [null, ['integer', 'min:1', 'max:168']], // null: config('compriva.sync.max_offline_hours')
        ],
        'inventory' => [
            'expiry_warning_days' => [30, ['integer', 'min:1', 'max:365']],
        ],
    ];

    /** Settings holding money, stored as 4-decimal strings like every amount. */
    private const MONEY = ['pos.max_cash_in_drawer'];

    /** Extra rules for list items. @var array<string, list<mixed>> */
    public const ITEM_RULES = [
        'receipt.header_lines.*' => ['nullable', 'string', 'max:48'], // blank lines are dropped
    ];

    public static function default(string $group, string $key): mixed
    {
        $default = self::CATALOG[$group][$key][0] ?? null;

        return $group === 'sync' && $key === 'max_offline_hours' ? (int) config('compriva.sync.max_offline_hours') : $default;
    }

    public static function get(string $group, string $key): mixed
    {
        $stored = Setting::whereNull('store_id')->where('group', $group)->where('key', $key)->first();

        return $stored === null || $stored->value === null ? self::default($group, $key) : $stored->value;
    }

    /** Every catalog key of a group, stored or default. @return array<string, mixed> */
    public static function group(string $group): array
    {
        $stored = Setting::whereNull('store_id')->where('group', $group)->pluck('value', 'key');

        return collect(self::CATALOG[$group] ?? [])
            ->mapWithKeys(fn ($definition, string $key) => [$key => $stored[$key] ?? self::default($group, $key)])
            ->all();
    }

    /** @return array<string, list<mixed>> validation rules for a partial update of $group */
    public static function rules(string $group): array
    {
        $rules = [];
        foreach (self::CATALOG[$group] as $key => [, $keyRules]) {
            $rules[$key] = ['sometimes', ...$keyRules];
        }
        foreach (self::ITEM_RULES as $path => $itemRules) {
            if (str_starts_with($path, "{$group}.")) {
                $rules[substr($path, strlen($group) + 1)] = $itemRules;
            }
        }

        return $rules;
    }

    /**
     * Saves the changed keys and records one audit entry with old and new values.
     *
     * @param  array<string, mixed>  $values  validated
     * @return array<string, mixed> the group after saving
     */
    public static function update(User $actor, string $group, array $values, AuditLogger $audit): array
    {
        $before = self::group($group);
        $values = collect($values)->map(fn ($value, string $key) => self::normalize("{$group}.{$key}", $value));
        $changed = $values->filter(fn ($value, string $key) => $value !== self::normalize("{$group}.{$key}", $before[$key]));

        if ($changed->isNotEmpty()) {
            DB::transaction(function () use ($actor, $group, $changed, $before, $audit) {
                foreach ($changed as $key => $value) {
                    Setting::updateOrCreate(
                        ['store_id' => null, 'group' => $group, 'key' => $key],
                        ['value' => $value, 'updated_by' => $actor->id],
                    );
                }
                $audit->record('settings.updated', null,
                    ['group' => $group, ...$changed->map(fn ($v, string $key) => $before[$key])->all()],
                    ['group' => $group, ...$changed->all()]);
            });
        }

        return self::group($group);
    }

    private static function isInteger(string $path): bool
    {
        [$group, $key] = explode('.', $path, 2);

        return in_array('integer', self::CATALOG[$group][$key][1] ?? [], true);
    }

    /** Money as a 4-decimal string, lists without blank lines, whole numbers as integers, text trimmed. */
    private static function normalize(string $path, mixed $value): mixed
    {
        return match (true) {
            in_array($path, self::MONEY, true) => bcadd((string) $value, '0', 4),
            is_array($value) => array_values(array_filter(array_map(fn ($line) => trim((string) $line), $value), fn ($line) => $line !== '')),
            $value !== null && self::isInteger($path) => (int) $value,
            is_string($value) => trim($value) === '' ? null : trim($value),
            default => $value,
        };
    }
}
