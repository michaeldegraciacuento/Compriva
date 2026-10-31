import { getPlatform } from "@/platform";
import type { PrinterInfo } from "@/platform/types";

import type { Sale } from "../pos/types";
import { encodeDrawerPulse, encodeReceipt, encodeTestPage } from "./escpos";
import { PAPER_WIDTH, receiptLines } from "./receipt-layout";
import type { HardwareSettings } from "./settings";

/**
 * Printing and the cash drawer. Kept apart from money: these run only after a
 * sale is saved, never throw, and report a result the screen shows next to a
 * "Retry print" button. A failed print never touches the sale.
 */
export type HardwareResult = { ok: true; message: string } | { ok: false; message: string };

const NOT_READY = new Set(["Offline", "Stopped", "Error"]);

export async function listPrinters(): Promise<PrinterInfo[]> {
  const platform = await getPlatform();
  return platform.printers ? platform.printers.list() : [];
}

/** Whether the chosen printer exists and is ready, with a message for the cashier when it is not. */
export async function checkPrinter(name: string | null): Promise<HardwareResult> {
  if (!name) return { ok: false, message: "No receipt printer is chosen. Choose one on the Hardware page." };
  let printers: PrinterInfo[];
  try {
    printers = await listPrinters();
  } catch (error) {
    return { ok: false, message: `Cannot read the printer list: ${String(error)}` };
  }
  const printer = printers.find((p) => p.name === name);
  if (!printer) return { ok: false, message: `Printer "${name}" is not installed on this computer. Check the cable and the Windows driver.` };
  if (NOT_READY.has(printer.status)) {
    return { ok: false, message: `Printer "${name}" is ${printer.status.toLowerCase()}. Check that it is on, has paper and its cover is closed.` };
  }
  return { ok: true, message: `${name} is ${printer.status.toLowerCase()}.` };
}

async function sendRaw(settings: HardwareSettings, data: Uint8Array, job: string): Promise<HardwareResult> {
  const platform = await getPlatform();
  if (!platform.printers) return { ok: false, message: "Direct printing needs the Compriva desktop app." };
  const ready = await checkPrinter(settings.printer);
  if (!ready.ok) return ready;
  try {
    await platform.printers.printRaw(settings.printer!, data, job);
    return { ok: true, message: "Sent to the printer." };
  } catch (error) {
    return { ok: false, message: `Printing failed: ${String(error)}` };
  }
}

/** Uses raw ESC/POS printing for a thermal printer on desktop, the print dialog otherwise. */
const usesEscPos = (settings: HardwareSettings) => settings.method === "escpos" && settings.paper !== "a4";

/**
 * Prints a receipt. On the system path the receipt must be on screen
 * (`Receipt` with `.receipt-print`), because the print dialog prints the page.
 */
export async function printReceipt(sale: Sale, settings: HardwareSettings, options: { reprint?: boolean; openDrawer?: boolean } = {}): Promise<HardwareResult> {
  if (usesEscPos(settings)) {
    const width = PAPER_WIDTH[settings.paper as "58mm" | "80mm"];
    const data = encodeReceipt(receiptLines(sale, width, { reprint: options.reprint }), {
      width,
      copies: settings.copies,
      openDrawer: options.openDrawer && settings.openDrawerOnCash,
      drawerPin: settings.drawerPin,
    });
    return sendRaw(settings, data, `Receipt ${sale.receipt_number}`);
  }
  try {
    // Let the receipt that was just shown render first: the print dialog prints the page.
    await new Promise((resolve) => setTimeout(resolve, 300));
    window.print();
    if (options.openDrawer && settings.openDrawerOnCash && settings.printer) await openDrawer(settings);
    return { ok: true, message: "Sent to the print dialog." };
  } catch (error) {
    return { ok: false, message: `Printing failed: ${String(error)}` };
  }
}

/** Pulses the cash drawer through the receipt printer. */
export async function openDrawer(settings: HardwareSettings): Promise<HardwareResult> {
  const result = await sendRaw(settings, encodeDrawerPulse(settings.drawerPin), "Cash drawer");
  return result.ok ? { ok: true, message: "Drawer opened." } : result;
}

export async function printTestPage(settings: HardwareSettings): Promise<HardwareResult> {
  if (!usesEscPos(settings)) {
    window.print();
    return { ok: true, message: "Sent to the print dialog." };
  }
  const width = PAPER_WIDTH[settings.paper as "58mm" | "80mm"];
  return sendRaw(settings, encodeTestPage(width, settings.printer ?? ""), "Compriva test page");
}

/** True when a sale took cash, so the drawer has to open. */
export const tookCash = (sale: Sale) => (sale.payments ?? []).some((p) => p.method === "cash");
