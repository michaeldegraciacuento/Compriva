{{-- Report PDF (dompdf). Data: ReportResult $report, Store $store, callable $format. --}}
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>{{ $report->title }}</title>
<style>
    @page { margin: 14mm 12mm 16mm; }
    body { font-family: "DejaVu Sans", sans-serif; font-size: 8.5pt; color: #1f2933; }
    header { border-bottom: 1.5pt solid #0f6b4f; padding-bottom: 6pt; margin-bottom: 10pt; }
    .store { font-size: 9pt; color: #52606d; }
    h1 { font-size: 15pt; margin: 2pt 0; color: #0b3d2e; }
    .subtitle { font-size: 9.5pt; color: #3e4c59; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #e8f5ee; color: #0b3d2e; text-align: left; font-weight: bold; padding: 4pt 5pt; border-bottom: 1pt solid #9fcfb7; }
    td { padding: 3pt 5pt; border-bottom: 0.5pt solid #e4e7eb; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    tr.total td { font-weight: bold; border-top: 1pt solid #3e4c59; border-bottom: none; background: #f5f7fa; }
    .notes { margin-top: 10pt; font-size: 7.5pt; color: #616e7c; }
    .empty { padding: 16pt; text-align: center; color: #616e7c; }
    footer { position: fixed; bottom: -10mm; left: 0; right: 0; font-size: 7pt; color: #9aa5b1; }
</style>
</head>
<body>
<footer>Compriva · generated {{ $generatedAt->format('j M Y g:i A') }}</footer>
<header>
    <div class="store">{{ $store?->name }}@if($store?->address) · {{ $store->address }}@endif</div>
    <h1>{{ $report->title }}</h1>
    <div class="subtitle">{{ $report->subtitle }}</div>
</header>

@if (count($report->rows) === 0)
    <p class="empty">No data for this period.</p>
@else
<table>
    <thead>
        <tr>
            @foreach ($report->columns as $column)
                <th class="{{ in_array($column['type'], ['int', 'qty', 'money', 'percent']) ? 'num' : '' }}">{{ $column['label'] }}</th>
            @endforeach
        </tr>
    </thead>
    <tbody>
        @foreach ($report->rows as $row)
            <tr>
                @foreach ($report->columns as $column)
                    <td class="{{ in_array($column['type'], ['int', 'qty', 'money', 'percent']) ? 'num' : '' }}">{{ $format($row[$column['key']] ?? null, $column['type']) }}</td>
                @endforeach
            </tr>
        @endforeach
        @if ($report->totals)
            <tr class="total">
                @foreach ($report->columns as $column)
                    <td class="{{ in_array($column['type'], ['int', 'qty', 'money', 'percent']) ? 'num' : '' }}">{{ $format($report->totals[$column['key']] ?? null, $column['type']) }}</td>
                @endforeach
            </tr>
        @endif
    </tbody>
</table>
@endif

@if ($report->notes)
    <div class="notes">
        @foreach ($report->notes as $note)<p>{{ $note }}</p>@endforeach
        <p>Amounts in Philippine pesos (PHP).</p>
    </div>
@endif
</body>
</html>
