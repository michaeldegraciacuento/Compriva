<?php

namespace App\Domain\Reporting\Export;

use App\Domain\Reporting\Dec;
use App\Domain\Reporting\ReportResult;
use App\Models\Store;
use Dompdf\Dompdf;
use Dompdf\Options;

/**
 * Turns a ReportResult into CSV, Excel (.xlsx) or PDF. Numbers keep their exact
 * decimal value: CSV writes them plain, Excel stores them as numbers with a
 * display format, PDF shows them grouped (1,234.50).
 */
class ReportExporter
{
    public const FORMATS = ['csv' => 'text/csv; charset=UTF-8', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'pdf' => 'application/pdf'];

    public function export(ReportResult $report, string $format): string
    {
        return match ($format) {
            'csv' => $this->csv($report),
            'xlsx' => $this->xlsx($report),
            'pdf' => $this->pdf($report),
        };
    }

    public function filename(ReportResult $report, string $format): string
    {
        return 'compriva-'.$report->key.'-'.now()->format('Ymd-His').'.'.$format;
    }

    // --- CSV -----------------------------------------------------------------------

    public function csv(ReportResult $report): string
    {
        $out = fopen('php://temp', 'r+');
        fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM so Excel reads ₱ and ñ correctly
        fputcsv($out, [$report->title.' — '.$report->subtitle], escape: '');
        fputcsv($out, array_column($report->columns, 'label'), escape: '');
        foreach ([...$report->rows, ...($report->totals ? [$report->totals] : [])] as $row) {
            fputcsv($out, array_map(fn (array $c) => $row[$c['key']] ?? '', $report->columns), escape: '');
        }
        rewind($out);

        return (string) stream_get_contents($out);
    }

    // --- Excel ---------------------------------------------------------------------

    /** Style indexes in styles.xml. */
    private const STYLE = ['text' => 0, 'bold' => 1, 'int' => 2, 'money' => 3, 'qty' => 4, 'percent' => 5, 'date' => 0, 'title' => 6];

    public function xlsx(ReportResult $report): string
    {
        $rows = [];
        $rows[] = $this->xlsxRow(1, [[$report->title, 'title']]);
        $rows[] = $this->xlsxRow(2, [[$report->subtitle, 'text']]);
        $rows[] = $this->xlsxRow(4, array_map(fn (array $c) => [$c['label'], 'bold'], $report->columns));

        $r = 5;
        foreach ($report->rows as $row) {
            $rows[] = $this->xlsxRow($r++, array_map(fn (array $c) => [$row[$c['key']] ?? null, $c['type']], $report->columns));
        }
        if ($report->totals) {
            $rows[] = $this->xlsxRow($r, array_map(fn (array $c) => [$report->totals[$c['key']] ?? null, in_array($c['type'], ['text', 'date'], true) ? 'bold' : $c['type']], $report->columns));
        }

        $widths = implode('', array_map(fn (int $i, array $c) => sprintf('<col min="%d" max="%d" width="%d" customWidth="1"/>', $i + 1, $i + 1, $c['type'] === 'text' ? 28 : 15), array_keys($report->columns), $report->columns));
        $sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            .'<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            ."<cols>{$widths}</cols><sheetData>".implode('', $rows).'</sheetData></worksheet>';

        $zip = new ZipWriter;
        $zip->add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            .'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            .'<Default Extension="xml" ContentType="application/xml"/>'
            .'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            .'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            .'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            .'</Types>');
        $zip->add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            .'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            .'</Relationships>');
        $zip->add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            .'<sheets><sheet name="'.$this->xml(mb_substr($this->sheetName($report->title), 0, 31)).'" sheetId="1" r:id="rId1"/></sheets></workbook>');
        $zip->add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            .'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            .'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            .'</Relationships>');
        $zip->add('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            .'<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.####"/><numFmt numFmtId="166" formatCode="0.0&quot;%&quot;"/></numFmts>'
            .'<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>'
            .'<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
            .'<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            .'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            .'<cellXfs count="7">'
            .'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            .'<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
            .'<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
            .'<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
            .'<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
            .'<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
            .'<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
            .'</cellXfs></styleSheet>');
        $zip->add('xl/worksheets/sheet1.xml', $sheet);

        return $zip->finish();
    }

    /** @param list<array{0: mixed, 1: string}> $cells value and column type */
    private function xlsxRow(int $number, array $cells): string
    {
        $xml = '';
        foreach ($cells as $i => [$value, $type]) {
            if ($value === null || $value === '') {
                continue;
            }
            $ref = $this->column($i).$number;
            $style = self::STYLE[$type] ?? 0;
            $xml .= in_array($type, ['int', 'money', 'qty', 'percent'], true) && is_numeric($value)
                ? sprintf('<c r="%s" s="%d"><v>%s</v></c>', $ref, $style, $value)
                : sprintf('<c r="%s" s="%d" t="inlineStr"><is><t>%s</t></is></c>', $ref, $style, $this->xml((string) $value));
        }

        return "<row r=\"{$number}\">{$xml}</row>";
    }

    private function column(int $index): string
    {
        $name = '';
        for ($index++; $index > 0; $index = intdiv($index - 1, 26)) {
            $name = chr(65 + ($index - 1) % 26).$name;
        }

        return $name;
    }

    private function sheetName(string $title): string
    {
        return str_replace(['\\', '/', '?', '*', '[', ']', ':'], ' ', $title);
    }

    private function xml(string $text): string
    {
        return htmlspecialchars($text, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }

    // --- PDF -----------------------------------------------------------------------

    public function pdf(ReportResult $report): string
    {
        $options = new Options;
        $options->set('defaultFont', 'DejaVu Sans');
        $options->set('isRemoteEnabled', false);
        $options->set('tempDir', storage_path('framework/cache'));
        $options->set('fontCache', storage_path('framework/cache'));

        $pdf = new Dompdf($options);
        $pdf->loadHtml(view('reports.pdf', [
            'report' => $report,
            'store' => Store::query()->orderBy('created_at')->first(),
            'format' => fn (mixed $value, string $type) => $this->display($value, $type),
            'generatedAt' => now()->setTimezone(Store::query()->orderBy('created_at')->value('timezone') ?? 'Asia/Manila'),
        ])->render());
        $pdf->setPaper('A4', count($report->columns) > 6 ? 'landscape' : 'portrait');
        $pdf->render();

        return (string) $pdf->output();
    }

    /** Display text for a cell. */
    public function display(mixed $value, string $type): string
    {
        if ($value === null || $value === '') {
            return '';
        }

        return match ($type) {
            'money' => Dec::group((string) $value),
            'qty', 'int' => Dec::group((string) $value),
            'percent' => $value.'%',
            default => (string) $value,
        };
    }
}
