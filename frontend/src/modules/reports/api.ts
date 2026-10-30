import { getApiClient } from "@/lib/api";

export type ColumnType = "text" | "date" | "int" | "qty" | "money" | "percent";

export interface ReportInfo {
  key: string;
  title: string;
  description: string;
  /** range = from/to, group = day/week/month, days = look-ahead days */
  filters: ("range" | "group" | "days")[];
  profit: boolean;
}

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  profit?: boolean;
}

export type ReportValue = string | number | null;

export interface ReportData {
  key: string;
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: Record<string, ReportValue>[];
  totals: Record<string, ReportValue> | null;
  notes: string[];
}

export interface ReportParams {
  from?: string;
  to?: string;
  group?: "day" | "week" | "month";
  days?: number;
}

export type ExportFormat = "csv" | "xlsx" | "pdf";

export const fetchReportCatalog = async () => (await getApiClient()).get<ReportInfo[]>("/reports");
export const fetchReport = async (key: string, params: ReportParams) => (await getApiClient()).get<ReportData>(`/reports/${key}`, { params });

/** Downloads an export and hands it to the browser (or the desktop webview) as a file. */
export async function downloadReport(key: string, params: ReportParams, format: ExportFormat): Promise<void> {
  const { blob, filename } = await (await getApiClient()).download(`/reports/${key}`, { params: { ...params, format } });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename ?? `compriva-${key}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
