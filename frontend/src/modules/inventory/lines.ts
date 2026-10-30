import { skuUnits, trimDecimal } from "@/modules/catalog/sku";
import type { Sku } from "@/modules/catalog/types";

import type { DocumentLineInput, DocumentType } from "./types";

/**
 * A stock document line while it is being edited. Every value stays a string
 * (docs/database.md D4); the server converts units and does the arithmetic.
 * These checks only catch mistakes early: the server validates everything again.
 */
export interface LineDraft {
  key: number;
  sku: Sku;
  unit_id: string;
  quantity: string;
  counted_quantity: string;
  unit_cost: string;
  batch_number: string;
  expiry_date: string;
  stock_batch_id: string;
}

export type LineProblems = Partial<Record<"quantity" | "counted_quantity" | "unit_cost" | "batch_number" | "expiry_date" | "stock_batch_id", string>>;

const DECIMAL = /^\d{1,11}(\.\d{1,4})?$/;
const WHOLE = /^\d{1,11}(\.0{1,4})?$/;

let nextKey = 1;

export function newLine(sku: Sku): LineDraft {
  return {
    key: nextKey++,
    sku,
    unit_id: sku.base_unit.id,
    quantity: "",
    counted_quantity: "",
    unit_cost: trimDecimal(sku.cost_price),
    batch_number: "",
    expiry_date: "",
    stock_batch_id: "",
  };
}

/** The selected unit and its factor (falls back to the base unit). */
export function lineUnit(line: LineDraft) {
  const units = skuUnits(line.sku);
  return units.find((u) => u.unit.id === line.unit_id) ?? units[0];
}

function checkQuantity(value: string, allowsDecimal: boolean, unitCode: string, allowZero: boolean): string | undefined {
  const text = value.trim();
  if (text === "") return "Enter a quantity.";
  if (!DECIMAL.test(text)) return "Use a number with up to 4 decimals.";
  if (!allowZero && Number(text) <= 0) return "Must be greater than zero.";
  if (!allowsDecimal && !WHOLE.test(text)) return `${unitCode} is counted in whole numbers.`;
  return undefined;
}

export function lineProblems(type: DocumentType, line: LineDraft): LineProblems {
  const problems: LineProblems = {};
  const tracks = line.sku.tracks ?? { batches: false, expiry: false };

  if (type === "adjustment") {
    // Counts are always entered in the base unit.
    const base = line.sku.base_unit;
    problems.counted_quantity = checkQuantity(line.counted_quantity, base.allows_decimal, base.code, true);
    if (tracks.batches && !line.stock_batch_id) problems.stock_batch_id = "Choose the batch you counted.";
  } else {
    const { unit } = lineUnit(line);
    problems.quantity = checkQuantity(line.quantity, unit.allows_decimal, unit.code, false);
  }

  if (type === "stock_in") {
    if (line.unit_cost.trim() !== "" && !DECIMAL.test(line.unit_cost.trim())) problems.unit_cost = "Use a number with up to 4 decimals.";
    if (tracks.batches && !line.batch_number.trim()) problems.batch_number = "Enter the batch or lot number.";
    if (tracks.expiry && !line.expiry_date) problems.expiry_date = "Enter the expiry date.";
  }

  return Object.fromEntries(Object.entries(problems).filter(([, message]) => message)) as LineProblems;
}

/** The request body for one line: only the fields that document type uses. */
export function toLineInput(type: DocumentType, line: LineDraft): DocumentLineInput {
  const optional = (value: string) => (value.trim() === "" ? null : value.trim());

  if (type === "adjustment") {
    return { product_sku_id: line.sku.id, counted_quantity: line.counted_quantity.trim(), stock_batch_id: optional(line.stock_batch_id) };
  }

  const input: DocumentLineInput = { product_sku_id: line.sku.id, unit_id: line.unit_id, quantity: line.quantity.trim() };
  if (type === "stock_in") {
    if (line.unit_cost.trim() !== "") input.unit_cost = line.unit_cost.trim();
    input.batch_number = optional(line.batch_number);
    input.expiry_date = optional(line.expiry_date);
  } else {
    input.stock_batch_id = optional(line.stock_batch_id);
  }
  return input;
}

/**
 * "= 48 pc" preview of a quantity in another unit. Display only: the server
 * converts with exact decimals when it posts.
 */
export function basePreview(line: LineDraft): string | null {
  const { factor } = lineUnit(line);
  if (factor === "1" || Number(factor) === 1 || !DECIMAL.test(line.quantity.trim())) return null;
  const total = Number(line.quantity) * Number(factor);
  return `= ${Number(total.toFixed(4))} ${line.sku.base_unit.code}`;
}
