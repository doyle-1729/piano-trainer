import type { MidiEvent } from "../midi/events";

/**
 * Dev fallback: the computer keyboard simulates MIDI input so the app can be
 * tested without the piano. A W S E D F T G Y H U J K = C4…C5; Z / X shift
 * the octave down / up.
 */

const KEY_TO_OFFSET: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6,
  g: 7, y: 8, h: 9, u: 10, j: 11, k: 12,
};

const MIN_BASE = 24; // C1
const MAX_BASE = 84; // C6 (top key k reaches C7)

export class KeyboardSim {
  private base = 60; // C4
  private held = new Map<string, number>();
  private listeners = new Set<(e: MidiEvent) => void>();
  private octaveListeners = new Set<(base: number) => void>();

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && /^(input|select|textarea)$/i.test(target.tagName)) return;
    const key = e.key.toLowerCase();
    if (key === "z" || key === "x") {
      this.base = Math.min(MAX_BASE, Math.max(MIN_BASE, this.base + (key === "z" ? -12 : 12)));
      for (const l of this.octaveListeners) l(this.base);
      return;
    }
    const offset = KEY_TO_OFFSET[key];
    if (offset === undefined || this.held.has(key)) return;
    const note = this.base + offset;
    this.held.set(key, note);
    this.emit({ kind: "noteOn", note, velocity: 80, channel: 1 });
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    const note = this.held.get(key);
    if (note === undefined) return;
    this.held.delete(key);
    this.emit({ kind: "noteOff", note, channel: 1 });
  };

  get octaveBase(): number {
    return this.base;
  }

  start(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  stop(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    for (const [, note] of this.held) this.emit({ kind: "noteOff", note, channel: 1 });
    this.held.clear();
  }

  onEvent(listener: (e: MidiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onOctaveChange(listener: (base: number) => void): () => void {
    this.octaveListeners.add(listener);
    return () => this.octaveListeners.delete(listener);
  }

  private emit(e: MidiEvent): void {
    for (const l of this.listeners) l(e);
  }
}
