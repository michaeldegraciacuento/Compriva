<?php

namespace App\Domain\Reporting;

use App\Models\Store;
use Illuminate\Support\Carbon;

/**
 * Report parameters. Dates are store business days (Asia/Manila), inclusive.
 * `fromUtc`/`toUtc` give the matching instants for timestamp columns.
 */
final class ReportFilters
{
    public function __construct(
        public readonly Carbon $from,
        public readonly Carbon $to,
        public readonly string $group,
        public readonly int $days,
        public readonly string $timezone,
    ) {}

    /** @param array<string, mixed> $input validated query */
    public static function fromInput(array $input, int $defaultDays): self
    {
        $timezone = Store::query()->orderBy('created_at')->value('timezone') ?? 'Asia/Manila';
        $today = Carbon::now($timezone)->startOfDay();

        return new self(
            isset($input['from']) ? Carbon::parse($input['from'], $timezone)->startOfDay() : $today->copy()->startOfMonth(),
            isset($input['to']) ? Carbon::parse($input['to'], $timezone)->startOfDay() : $today,
            $input['group'] ?? 'day',
            (int) ($input['days'] ?? $defaultDays),
            $timezone,
        );
    }

    public function fromDate(): string
    {
        return $this->from->toDateString();
    }

    public function toDate(): string
    {
        return $this->to->toDateString();
    }

    public function fromUtc(): Carbon
    {
        return $this->from->copy()->utc();
    }

    /** End of the last day, exclusive. */
    public function toUtc(): Carbon
    {
        return $this->to->copy()->addDay()->utc();
    }

    public function today(): Carbon
    {
        return Carbon::now($this->timezone)->startOfDay();
    }

    public function rangeLabel(): string
    {
        return $this->from->isSameDay($this->to)
            ? $this->from->format('j M Y')
            : $this->from->format('j M Y').' – '.$this->to->format('j M Y');
    }
}
