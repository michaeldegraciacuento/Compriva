<?php

namespace App\Http\Controllers\Api\V1\System;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Device;
use App\Models\Store;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Database\MorphMap;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

/**
 * The audit log (docs/README.md): who did what, when, from where.
 * Read-only: the table is append-only and nothing here changes it. Needs
 * audit.view. ?format=csv downloads the filtered entries (at most 10,000),
 * and the download itself is audited.
 */
class AuditLogController extends Controller
{
    private const CSV_LIMIT = 10_000;

    /** Attributes tried, in order, to name an entry's subject (receipt number, name, code…). */
    private const LABELS = ['receipt_number', 'return_number', 'po_number', 'document_number', 'display_name', 'name', 'code'];

    public function index(Request $request, AuditLogger $audit): JsonResponse|Response
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'event' => ['nullable', 'string', 'max:100'],
            'category' => ['nullable', 'string', 'max:50', 'regex:/^[a-z_]+$/'],
            'user_id' => ['nullable', 'uuid'],
            'device_id' => ['nullable', 'uuid'],
            'subject_type' => ['nullable', 'string', Rule::in(array_keys(MorphMap::MAP))],
            'subject_id' => ['nullable', 'uuid'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'format' => ['nullable', Rule::in(['json', 'csv'])],
        ]);

        $query = $this->filtered($filters)->with(['user:id,name,username', 'device:id,code,name'])->orderByDesc('created_at')->orderByDesc('id');

        if (($filters['format'] ?? 'json') === 'csv') {
            $entries = $query->limit(self::CSV_LIMIT)->get();
            $audit->record('audit.exported', null, new: ['rows' => $entries->count(), 'filters' => collect($filters)->except('format')->all()]);

            return response($this->csv($entries, $this->labels($entries)), 200, [
                'Content-Type' => 'text/csv; charset=UTF-8',
                'Content-Disposition' => 'attachment; filename="audit-log-'.now($this->timezone())->format('Y-m-d-His').'.csv"',
                'Cache-Control' => 'no-store',
            ]);
        }

        $page = $query->paginate($filters['per_page'] ?? 50);
        $labels = $this->labels(collect($page->items()));

        return response()->json([
            'data' => collect($page->items())->map(fn (AuditLog $entry) => $this->entry($entry, $labels))->values(),
            'meta' => [
                'current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(),
                'total' => $page->total(), 'from' => $page->firstItem(), 'to' => $page->lastItem(),
            ],
        ]);
    }

    /** What the filters can offer: the events, people and terminals that appear in the log. */
    public function filters(): JsonResponse
    {
        $users = AuditLog::query()->whereNotNull('user_id')->distinct()->pluck('user_id');
        $devices = AuditLog::query()->whereNotNull('device_id')->distinct()->pluck('device_id');

        return response()->json(['data' => [
            'events' => AuditLog::query()->select('event')->selectRaw('count(*) as count')->groupBy('event')->orderBy('event')->get()
                ->map(fn ($row) => ['event' => $row->event, 'count' => (int) $row->count])->values(),
            'users' => User::whereKey($users)->orderBy('name')->get(['id', 'name', 'username'])
                ->map(fn (User $u) => ['id' => $u->id, 'name' => $u->name, 'username' => $u->username])->values(),
            'devices' => Device::whereKey($devices)->orderBy('code')->get(['id', 'code', 'name'])
                ->map(fn (Device $d) => ['id' => $d->id, 'code' => $d->code, 'name' => $d->name])->values(),
        ]]);
    }

    /** @param  array<string, mixed>  $filters */
    private function filtered(array $filters): Builder
    {
        $tz = $this->timezone();

        return AuditLog::query()
            ->when($filters['event'] ?? null, fn (Builder $q, $event) => $q->where('event', $event))
            ->when($filters['category'] ?? null, fn (Builder $q, $category) => $q->where('event', 'like', "{$category}.%"))
            ->when($filters['user_id'] ?? null, fn (Builder $q, $id) => $q->where('user_id', $id))
            ->when($filters['device_id'] ?? null, fn (Builder $q, $id) => $q->where('device_id', $id))
            ->when($filters['subject_type'] ?? null, fn (Builder $q, $type) => $q->where('auditable_type', $type))
            ->when($filters['subject_id'] ?? null, fn (Builder $q, $id) => $q->where('auditable_id', $id))
            // Days are the store's days (Asia/Manila); created_at is stored in UTC.
            ->when($filters['from'] ?? null, fn (Builder $q, $from) => $q->where('created_at', '>=', Carbon::parse($from, $tz)->startOfDay()->utc()))
            ->when($filters['to'] ?? null, fn (Builder $q, $to) => $q->where('created_at', '<', Carbon::parse($to, $tz)->addDay()->startOfDay()->utc()))
            ->when($filters['q'] ?? null, fn (Builder $q, $term) => $q->where(fn (Builder $q) => $q
                ->where('event', 'like', "%{$term}%")
                ->orWhere('request_id', $term)
                ->orWhere('ip_address', $term)
                ->orWhere('auditable_id', $term)
                ->orWhereHas('user', fn (Builder $q) => $q->where('name', 'like', "%{$term}%")->orWhere('username', 'like', "%{$term}%"))));
    }

    /**
     * Readable names for the entries' subjects, loaded per type in one query each.
     *
     * @param  Collection<int, AuditLog>  $entries
     * @return array<string, string> "type:id" => label
     */
    private function labels(Collection $entries): array
    {
        $labels = [];
        foreach ($entries->whereNotNull('auditable_type')->groupBy('auditable_type') as $type => $group) {
            $class = MorphMap::MAP[$type] ?? null;
            if ($class === null) {
                continue;
            }
            $query = $class::query();
            if (method_exists($class, 'bootSoftDeletes')) {
                $query->withTrashed();
            }
            foreach ($query->whereKey($group->pluck('auditable_id')->unique()->values())->get() as $model) {
                $attributes = $model->getAttributes();
                $label = collect(self::LABELS)->map(fn (string $attribute) => $attributes[$attribute] ?? null)->first(fn ($value) => filled($value));
                if ($type === 'device') {
                    $label = trim(($attributes['code'] ?? '').' · '.($attributes['name'] ?? ''), ' ·');
                }
                if ($type === 'setting') {
                    $label = "{$attributes['group']}.{$attributes['key']}";
                }
                $labels["{$type}:{$model->getKey()}"] = (string) ($label ?? $model->getKey());
            }
        }

        return $labels;
    }

    /**
     * @param  array<string, string>  $labels
     * @return array<string, mixed>
     */
    private function entry(AuditLog $entry, array $labels): array
    {
        return [
            'id' => $entry->id,
            'event' => $entry->event,
            'user' => $entry->user ? ['id' => $entry->user->id, 'name' => $entry->user->name, 'username' => $entry->user->username] : null,
            'device' => $entry->device ? ['id' => $entry->device->id, 'code' => $entry->device->code, 'name' => $entry->device->name] : null,
            'subject' => $entry->auditable_type === null ? null : [
                'type' => $entry->auditable_type,
                'id' => $entry->auditable_id,
                'label' => $labels["{$entry->auditable_type}:{$entry->auditable_id}"] ?? null,
            ],
            'old_values' => $entry->old_values,
            'new_values' => $entry->new_values,
            'ip_address' => $entry->ip_address,
            'user_agent' => $entry->user_agent,
            'request_id' => $entry->request_id,
            'created_at' => $entry->created_at->toIso8601ZuluString(),
        ];
    }

    /**
     * @param  Collection<int, AuditLog>  $entries
     * @param  array<string, string>  $labels
     */
    private function csv(Collection $entries, array $labels): string
    {
        $tz = $this->timezone();
        $out = fopen('php://temp', 'r+');
        fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM so Excel shows ñ and ₱ correctly
        fputcsv($out, ['Time', 'Event', 'User', 'Terminal', 'Subject type', 'Subject', 'Subject ID', 'Old values', 'New values', 'IP address', 'Request ID'], escape: '\\');
        foreach ($entries as $entry) {
            fputcsv($out, [
                $entry->created_at->copy()->setTimezone($tz)->format('Y-m-d H:i:s'),
                $entry->event,
                $entry->user?->name,
                $entry->device?->code,
                $entry->auditable_type,
                $labels["{$entry->auditable_type}:{$entry->auditable_id}"] ?? null,
                $entry->auditable_id,
                $entry->old_values === null ? null : json_encode($entry->old_values, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                $entry->new_values === null ? null : json_encode($entry->new_values, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                $entry->ip_address,
                $entry->request_id,
            ], escape: '\\');
        }
        rewind($out);

        return (string) stream_get_contents($out);
    }

    private function timezone(): string
    {
        return Store::query()->orderBy('created_at')->value('timezone') ?? 'Asia/Manila';
    }
}
