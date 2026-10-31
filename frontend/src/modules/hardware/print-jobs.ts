"use client";

import { create } from "zustand";

import type { Sale } from "../pos/types";
import { openDrawer, printReceipt, tookCash, type HardwareResult } from "./printing";
import { useHardware } from "./settings";

interface Job {
  busy: boolean;
  result: HardwareResult | null;
}

/** Print status per sale, so the screen can show it and offer a retry. */
export const usePrintJobs = create<{ jobs: Record<string, Job>; set(saleId: string, job: Job): void }>()((set) => ({
  jobs: {},
  set: (saleId, job) => set((state) => ({ jobs: { ...state.jobs, [saleId]: job } })),
}));

async function run(saleId: string, task: () => Promise<HardwareResult>): Promise<void> {
  const { set } = usePrintJobs.getState();
  set(saleId, { busy: true, result: null });
  let result: HardwareResult;
  try {
    result = await task();
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  set(saleId, { busy: false, result });
}

/** Prints (or reprints) a sale's receipt. Never throws: the outcome is in usePrintJobs. */
export async function printSale(sale: Sale, options: { reprint?: boolean; openDrawer?: boolean; before?: () => Promise<void> } = {}): Promise<void> {
  await useHardware.getState().load();
  await run(sale.id, async () => {
    await options.before?.();
    return printReceipt(sale, useHardware.getState().settings, options);
  });
}

/**
 * Right after a sale is saved: print if this terminal auto-prints, and open
 * the drawer for cash sales. Runs after the sale, never as part of it.
 */
export async function afterSale(sale: Sale): Promise<void> {
  await useHardware.getState().load();
  const settings = useHardware.getState().settings;
  const cash = tookCash(sale);
  if (settings.autoPrint) {
    await printSale(sale, { openDrawer: cash });
  } else if (cash && settings.openDrawerOnCash) {
    await run(sale.id, () => openDrawer(settings));
  }
}
