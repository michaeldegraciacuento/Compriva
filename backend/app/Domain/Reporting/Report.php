<?php

namespace App\Domain\Reporting;

/** One report: what it is, who may run it, which filters it uses, and how to build it. */
abstract class Report
{
    abstract public function key(): string;

    abstract public function title(): string;

    abstract public function description(): string;

    abstract public function build(ReportFilters $filters): ReportResult;

    /** reports.view, or reports.view_profit for reports that are all about cost and profit. */
    public function permission(): string
    {
        return 'reports.view';
    }

    /** Filters the screen shows: range (from/to), group (day/week/month), days (look-ahead). @return list<string> */
    public function filters(): array
    {
        return ['range'];
    }

    /** @return array<string, mixed> */
    public function describe(): array
    {
        return [
            'key' => $this->key(),
            'title' => $this->title(),
            'description' => $this->description(),
            'filters' => $this->filters(),
            'profit' => $this->permission() === 'reports.view_profit',
        ];
    }

    /** @return array{key: string, label: string, type: string, profit?: bool} */
    protected static function col(string $key, string $label, string $type = 'text', bool $profit = false): array
    {
        return ['key' => $key, 'label' => $label, 'type' => $type] + ($profit ? ['profit' => true] : []);
    }
}
