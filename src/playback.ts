import type { Step } from "./engine/timeline";

export type PlayableNote = { midi: number; durationMs: number };

/** The slice of MidiOut the player needs (kept structural for testing). */
export type PlayerOut = {
  play(notes: PlayableNote[], velocity?: number): void;
  allOff(): void;
};

/**
 * Plays a range of timeline steps to the MIDI output: demo playback of the
 * whole score or of the loop segment. Scheduling is drift-corrected (each
 * step's delay is computed against an absolute target time, so timer jitter
 * doesn't accumulate), and `wholeNoteMs` is re-read every step so tempo
 * changes take effect mid-playback.
 */
export class Player {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private steps: Step[] = [];
  private from = 0;
  private to = 0;
  private wrap = false;
  private pos = 0;
  private targetTime = 0;
  private _playing = false;

  /** Fired as each step starts sounding (move the cursor here). */
  onStep?: (index: number) => void;
  /** Fired when playback stops for any reason, with the last step reached. */
  onStop?: (index: number) => void;

  constructor(
    private out: PlayerOut,
    private wholeNoteMs: () => number,
  ) {}

  get playing(): boolean {
    return this._playing;
  }

  /** Play steps[from..to] inclusive; `wrap` repeats the range until stopped. */
  start(steps: Step[], from: number, to: number, wrap: boolean): void {
    this.stop();
    to = Math.min(to, steps.length - 1);
    from = Math.max(0, from);
    if (steps.length === 0 || from > to) return;
    this.steps = steps;
    this.from = from;
    this.to = to;
    this.wrap = wrap;
    this.pos = from;
    this.targetTime = performance.now();
    this._playing = true;
    this.tick();
  }

  stop(): void {
    if (!this._playing) return;
    clearTimeout(this.timer);
    this._playing = false;
    this.out.allOff();
    this.onStop?.(this.pos);
  }

  private tick(): void {
    const step = this.steps[this.pos];
    if (!step) {
      this.stop();
      return;
    }
    const whole = this.wholeNoteMs();
    const notes = step.notes
      .filter((n) => n.isOnset)
      .map((n) => ({ midi: n.midi, durationMs: n.duration * whole }));
    if (notes.length > 0) this.out.play(notes);
    this.onStep?.(this.pos);

    const next = this.pos + 1;
    if (next <= this.to) {
      const gap = (this.steps[next]!.timestamp - step.timestamp) * whole;
      this.targetTime += gap;
      this.pos = next;
      this.timer = setTimeout(() => this.tick(), Math.max(5, this.targetTime - performance.now()));
    } else {
      // Let the final step ring out before wrapping or stopping.
      const tail = Math.max(200, ...notes.map((n) => n.durationMs));
      this.targetTime += tail;
      const delay = Math.max(5, this.targetTime - performance.now());
      if (this.wrap) {
        this.pos = this.from;
        this.timer = setTimeout(() => this.tick(), delay);
      } else {
        this.timer = setTimeout(() => this.stop(), delay);
      }
    }
  }
}
