<?php

namespace App\Http\Controllers\Api\V1\Reports;

use App\Domain\Reporting\Export\ReportExporter;
use App\Domain\Reporting\ReportCatalog;
use App\Domain\Reporting\ReportFilters;
use App\Domain\Settings\Settings;
use App\Http\Controllers\Controller;
use App\Support\Audit\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

/**
 * Reports (docs/README.md). JSON for the screen, or
 * ?format=csv|xlsx|pdf for a download. Cost and profit need reports.view_profit:
 * profit-only reports are hidden, and profit columns are removed elsewhere.
 */
class ReportController extends Controller
{
    public function index(Request $request, ReportCatalog $catalog): JsonResponse
    {
        return response()->json(['data' => array_map(fn ($report) => $report->describe(), $catalog->for($request->user()))]);
    }

    public function show(Request $request, string $key, ReportCatalog $catalog, ReportExporter $exporter, AuditLogger $audit): Response
    {
        $report = $catalog->find($key);
        abort_if($report === null, 404, 'There is no such report.');
        abort_unless($request->user()->hasPermission($report->permission()), 403, 'You may not view this report.');

        $input = $request->validate([
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'group' => ['nullable', Rule::in(['day', 'week', 'month'])],
            'days' => ['nullable', 'integer', 'min:0', 'max:365'],
            'format' => ['nullable', Rule::in(['json', 'csv', 'xlsx', 'pdf'])],
        ]);

        $filters = ReportFilters::fromInput($input, (int) Settings::get('inventory', 'expiry_warning_days'));
        if ($filters->from->diffInDays($filters->to) > 400) {
            abort(422, 'Choose a period of at most 400 days.');
        }

        $result = $report->build($filters);
        if (! $request->user()->hasPermission('reports.view_profit')) {
            $result = $result->withoutProfit();
        }

        $format = $input['format'] ?? 'json';
        if ($format === 'json') {
            return response()->json(['data' => $result->toArray()]);
        }

        $audit->record('report.exported', null, new: ['report' => $key, 'format' => $format, 'from' => $filters->fromDate(), 'to' => $filters->toDate()]);

        return response($exporter->export($result, $format), 200, [
            'Content-Type' => ReportExporter::FORMATS[$format],
            'Content-Disposition' => 'attachment; filename="'.$exporter->filename($result, $format).'"',
            'Cache-Control' => 'no-store',
        ]);
    }
}
