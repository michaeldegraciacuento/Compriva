<?php

namespace App\Domain\Reporting;

/**
 * A finished report: the same structure feeds the screen (JSON), CSV, Excel
 * and PDF. Values are strings (decimals stay exact) or ints; null = blank.
 *
 * Column types: text, date, int, qty, money, percent.
 * Columns marked `profit` (costs, profit, margin) are removed for users
 * without reports.view_profit.
 */
final class ReportResult
{
    /**
     * @param  list<array{key: string, label: string, type: string, profit?: bool}>  $columns
     * @param  list<array<string, mixed>>  $rows
     * @param  ?array<string, mixed>  $totals
     * @param  list<string>  $notes
     */
    public function __construct(
        public readonly string $key,
        public readonly string $title,
        public readonly string $subtitle,
        public array $columns,
        public array $rows,
        public ?array $totals = null,
        public readonly array $notes = [],
    ) {}

    /** Drops cost and profit columns. */
    public function withoutProfit(): self
    {
        $hidden = array_column(array_filter($this->columns, fn (array $c) => $c['profit'] ?? false), 'key');
        if ($hidden === []) {
            return $this;
        }
        $strip = fn (array $row) => array_diff_key($row, array_flip($hidden));

        return new self(
            $this->key, $this->title, $this->subtitle,
            array_values(array_filter($this->columns, fn (array $c) => ! ($c['profit'] ?? false))),
            array_map($strip, $this->rows),
            $this->totals === null ? null : $strip($this->totals),
            $this->notes,
        );
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'key' => $this->key,
            'title' => $this->title,
            'subtitle' => $this->subtitle,
            'columns' => $this->columns,
            'rows' => $this->rows,
            'totals' => $this->totals,
            'notes' => $this->notes,
        ];
    }
}
