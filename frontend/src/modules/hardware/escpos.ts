import type { ReceiptLine } from "./receipt-layout";

/**
 * ESC/POS: the command set of thermal receipt printers (Epson, Xprinter,
 * Rongta, most generic 58/80 mm printers). The bytes go to the printer
 * unchanged through the Windows spooler (src-tauri/src/printing.rs).
 */
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const COMMANDS = {
  init: [ESC, 0x40],
  codePage437: [ESC, 0x74, 0x00],
  alignLeft: [ESC, 0x61, 0x00],
  alignCenter: [ESC, 0x61, 0x01],
  boldOn: [ESC, 0x45, 0x01],
  boldOff: [ESC, 0x45, 0x00],
  /** Double height only, so the line width stays the same. */
  largeOn: [GS, 0x21, 0x01],
  largeOff: [GS, 0x21, 0x00],
  /** Feed 4 lines, then a partial cut (GS V 66 n). */
  feedAndCut: [ESC, 0x64, 0x04, GS, 0x56, 0x42, 0x00],
} as const;

/**
 * Opens a cash drawer wired to the printer's drawer port (RJ11/RJ12):
 * ESC p m t1 t2, a pulse on pin 2 (m = 0) or pin 5 (m = 1) of 50 ms on, 500 ms off.
 */
export function drawerPulse(pin: 0 | 1 = 0): number[] {
  return [ESC, 0x70, pin, 0x19, 0xfa];
}

/** Code page 437 for the few non-ASCII characters receipts use; anything else prints as "?". */
const CP437: Record<string, number> = {
  "ñ": 0xa4, "Ñ": 0xa5, "á": 0xa0, "é": 0x82, "í": 0xa1, "ó": 0xa2, "ú": 0xa3, "ü": 0x81, "Ü": 0x9a, "É": 0x90, "°": 0xf8,
};
const REPLACEMENTS: Record<string, string> = { "₱": "P", "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "×": "x" };

export function encodeText(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const replaced = REPLACEMENTS[char];
    if (replaced) bytes.push(...[...replaced].map((c) => c.charCodeAt(0)));
    else if (char.charCodeAt(0) < 0x80) bytes.push(char.charCodeAt(0));
    else bytes.push(CP437[char] ?? 0x3f);
  }
  return bytes;
}

export interface EscPosOptions {
  width: number;
  copies?: number;
  cut?: boolean;
  /** Open the cash drawer after printing (cash sales). */
  openDrawer?: boolean;
  drawerPin?: 0 | 1;
}

/** The whole print job: every copy, cut after each, then the drawer pulse if asked. */
export function encodeReceipt(lines: ReceiptLine[], options: EscPosOptions): Uint8Array {
  const out: number[] = [...COMMANDS.init, ...COMMANDS.codePage437];
  const copies = Math.max(1, Math.min(3, options.copies ?? 1));

  for (let copy = 0; copy < copies; copy++) {
    for (const line of lines) {
      if (line.kind === "rule") {
        out.push(...COMMANDS.alignLeft, ...encodeText("-".repeat(options.width)), LF);
        continue;
      }
      if (line.kind === "feed") {
        out.push(LF);
        continue;
      }
      out.push(...(line.align === "center" ? COMMANDS.alignCenter : COMMANDS.alignLeft));
      if (line.bold) out.push(...COMMANDS.boldOn);
      if (line.large) out.push(...COMMANDS.largeOn);
      out.push(...encodeText(line.text), LF);
      if (line.large) out.push(...COMMANDS.largeOff);
      if (line.bold) out.push(...COMMANDS.boldOff);
    }
    out.push(...COMMANDS.alignLeft);
    out.push(...(options.cut === false ? [LF, LF, LF, LF] : COMMANDS.feedAndCut));
  }

  if (options.openDrawer) out.push(...drawerPulse(options.drawerPin));
  return new Uint8Array(out);
}

/** Only the drawer pulse (the "open drawer" button). */
export function encodeDrawerPulse(pin: 0 | 1 = 0): Uint8Array {
  return new Uint8Array([...COMMANDS.init, ...drawerPulse(pin)]);
}

/** A short test page: alignment, bold, characters, the paper width. */
export function encodeTestPage(width: number, printerName: string): Uint8Array {
  const lines: ReceiptLine[] = [
    { kind: "text", text: "COMPRIVA PRINTER TEST", align: "center", bold: true, large: true },
    { kind: "rule" },
    { kind: "text", text: `Printer: ${printerName}`.slice(0, width) },
    { kind: "text", text: `Width: ${width} characters` },
    { kind: "text", text: "1234567890".repeat(Math.ceil(width / 10)).slice(0, width) },
    { kind: "text", text: "Characters: Ñ ñ é (₱ prints as P)" },
    { kind: "text", text: "Bold line", bold: true },
    { kind: "text", text: "Centered", align: "center" },
    { kind: "rule" },
  ];
  return encodeReceipt(lines, { width });
}
