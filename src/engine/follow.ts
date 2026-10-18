import type { Hand, Step } from "./timeline";

/**
 * The follow engine: waits at each step until the required pitches for the
 * active hand(s) have been pressed, then advances. Pure TypeScript — fed by
 * noteOn() calls, reports through returned events. No DOM/OSMD/MIDI imports.
 */

export type HandMode = "right" | "left" | "both";

export type FollowEvent =
  /** A correct press; the step may or may not be complete yet. */
  | { kind: "match"; midi: number; step: Step }
  /** A press that matches nothing at the current step. */
  | { kind: "wrong"; midi: number; step: Step }
  /**
   * The session entered this step. auto=true means nothing is required here
   * for the active hands (tie continuations, or the other hand only) and the
   * session moved straight on — the UI still gets to move the cursor and
   * auto-play can still sound the other hand's notes.
   */
  | { kind: "step"; step: Step; auto: boolean }
  | { kind: "finished" };

export type FollowOptions = {
  hands?: HandMode;
  /**
   * Chord tolerance: all required pitches must arrive within this many ms of
   * each other (the notes need not still be held). Default 150.
   */
  chordWindowMs?: number;
};

export class FollowSession {
  private timeline: Step[];
  private index = 0;
  private done = false;
  private started = false;
  private hands: HandMode;
  private windowMs: number;
  /** Required pitches pressed so far at the current step → press time (ms). */
  private pending = new Map<number, number>();

  constructor(timeline: Step[], options: FollowOptions = {}) {
    this.timeline = timeline;
    this.hands = options.hands ?? "both";
    this.windowMs = options.chordWindowMs ?? 150;
  }

  /** Current step, or null when finished (or before begin() on an empty score). */
  get step(): Step | null {
    return this.done ? null : (this.timeline[this.index] ?? null);
  }

  get finished(): boolean {
    return this.done;
  }

  get handMode(): HandMode {
    return this.hands;
  }

  get chordWindowMs(): number {
    return this.windowMs;
  }

  setChordWindowMs(ms: number): void {
    this.windowMs = ms;
  }

  /** Pitches the player still has to press at the current step. */
  remainingPitches(): number[] {
    return this.requiredPitches().filter((p) => !this.pending.has(p));
  }

  /** All pitches required at the current step for the active hands. */
  requiredPitches(): number[] {
    const step = this.step;
    if (!step) return [];
    return step.notes.filter((n) => n.isOnset && this.handActive(n.hand)).map((n) => n.midi);
  }

  /** Correctly pressed pitches at the current step (for colouring). */
  matchedPitches(): number[] {
    return [...this.pending.keys()];
  }

  /** Enter the first step. Call once; returns the initial step/finished events. */
  begin(): FollowEvent[] {
    return this.seek(0);
  }

  /** Jump to a timeline index (restart = seek(0), looping later). */
  seek(index: number): FollowEvent[] {
    this.index = index;
    this.done = false;
    this.started = true;
    this.pending.clear();
    return this.enterCurrent();
  }

  setHands(mode: HandMode): FollowEvent[] {
    this.hands = mode;
    this.pending.clear();
    // The current step may now require nothing — advance through it if so.
    if (!this.started || this.done) return [];
    return this.requiredPitches().length === 0 ? this.advance() : [];
  }

  /** Feed one note-on. timeMs is any monotonic clock in milliseconds. */
  noteOn(midi: number, timeMs: number): FollowEvent[] {
    if (!this.started || this.done) return [];
    const step = this.step;
    if (!step) return [];

    const required = this.requiredPitches();
    if (required.includes(midi)) {
      // Drop earlier presses that fell out of the chord window, then record this one.
      for (const [pitch, t] of this.pending) {
        if (timeMs - t > this.windowMs) this.pending.delete(pitch);
      }
      this.pending.set(midi, timeMs);
      const events: FollowEvent[] = [{ kind: "match", midi, step }];
      if (required.every((p) => this.pending.has(p))) events.push(...this.advance());
      return events;
    }

    // Not required here: tie continuations, skipped grace notes and the
    // inactive hand's notes are ignorable, anything else is wrong.
    const ignorable = step.notes.some((n) => n.midi === midi);
    return ignorable ? [] : [{ kind: "wrong", midi, step }];
  }

  private handActive(hand: Hand): boolean {
    return this.hands === "both" || this.hands === hand;
  }

  private advance(): FollowEvent[] {
    this.index++;
    this.pending.clear();
    return this.enterCurrent();
  }

  /** Emit a step event for the current position, running through auto steps. */
  private enterCurrent(): FollowEvent[] {
    const events: FollowEvent[] = [];
    for (;;) {
      const step = this.timeline[this.index];
      if (!step) {
        this.done = true;
        events.push({ kind: "finished" });
        return events;
      }
      const auto = this.requiredPitches().length === 0;
      events.push({ kind: "step", step, auto });
      if (!auto) return events;
      this.index++;
    }
  }
}
