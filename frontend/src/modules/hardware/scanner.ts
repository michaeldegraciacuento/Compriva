/**
 * USB HID barcode scanners act as keyboards: they "type" the barcode very fast
 * (a few ms per character) and press Enter. This detector tells a scan apart
 * from a person typing by the gap between keystrokes, so a scan is caught
 * even when the cursor is not in the scan box, and it drops the immediate
 * double reads some scanners send.
 */
export interface ScannerSettings {
  /** Shortest barcode accepted (UPC-E has 6 digits, store codes may be shorter). */
  minLength: number;
  /** A scanner types faster than this between characters; people are slower. */
  maxGapMs: number;
  /** The same barcode again within this time is a double read, not a second item. */
  duplicateWindowMs: number;
}

export const DEFAULT_SCANNER: ScannerSettings = { minLength: 4, maxGapMs: 40, duplicateWindowMs: 500 };

export type ScanDecision = { kind: "scan"; code: string } | { kind: "duplicate"; code: string } | { kind: "none" };

export class ScanDetector {
  private buffer = "";
  private lastKeyAt = 0;
  private lastScan: { code: string; at: number } | null = null;

  constructor(private settings: ScannerSettings = DEFAULT_SCANNER) {}

  configure(settings: ScannerSettings): void {
    this.settings = settings;
  }

  /** Feed one key; returns a decision when Enter ends a burst. */
  key(key: string, at: number): ScanDecision {
    if (key === "Enter") {
      const code = this.buffer;
      this.buffer = "";
      return code.length >= this.settings.minLength ? this.accept(code, at) : { kind: "none" };
    }
    if (key.length !== 1) return { kind: "none" }; // Shift, Tab, arrows…

    // A slow key means a person is typing: start a new burst from this key.
    if (this.buffer && at - this.lastKeyAt > this.settings.maxGapMs) this.buffer = "";
    this.buffer += key;
    this.lastKeyAt = at;
    return { kind: "none" };
  }

  /** A barcode that arrived another way (the scan box's Enter): applies the duplicate rule. */
  accept(code: string, at: number): ScanDecision {
    const duplicate = this.lastScan?.code === code && at - this.lastScan.at < this.settings.duplicateWindowMs;
    this.lastScan = { code, at };
    return duplicate ? { kind: "duplicate", code } : { kind: "scan", code };
  }

  /** Whether keys are arriving at scanner speed right now. */
  inBurst(at: number): boolean {
    return this.buffer.length > 0 && at - this.lastKeyAt <= this.settings.maxGapMs;
  }

  reset(): void {
    this.buffer = "";
  }
}

/** A short beep for an unknown barcode (Web Audio; silent if unavailable). */
export function errorBeep(): void {
  try {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 440;
    gain.gain.value = 0.05;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.25);
    oscillator.onended = () => void context.close();
  } catch {
    // no audio: the on-screen message is enough
  }
}
