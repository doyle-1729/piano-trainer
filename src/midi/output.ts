/**
 * MIDI output: plays notes on the piano's sound engine (auto-play of the
 * non-practised hand). This is the ONLY place the app writes to a MIDI
 * output, and it is never fed from MIDI input — the user keeps Local Control
 * on, so echoing input would double every note.
 */

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CC_ALL_NOTES_OFF = 123;

export type PlayableNote = { midi: number; durationMs: number };

export class MidiOut {
  private timers = new Set<number>();
  private sounding = new Set<number>();

  /** The port is resolved per call so device changes are picked up. */
  constructor(private port: () => MIDIOutput | null) {}

  play(notes: PlayableNote[], velocity = 70): void {
    const out = this.port();
    if (!out) return;
    for (const { midi, durationMs } of notes) {
      out.send([NOTE_ON, midi, velocity]);
      this.sounding.add(midi);
      const timer = window.setTimeout(() => {
        this.timers.delete(timer);
        this.sounding.delete(midi);
        this.port()?.send([NOTE_OFF, midi, 64]);
      }, Math.max(50, durationMs));
      this.timers.add(timer);
    }
  }

  /** Silence everything we started (restart, loop jump, device/mode change). */
  allOff(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    const out = this.port();
    if (out) {
      for (const midi of this.sounding) out.send([NOTE_OFF, midi, 64]);
      out.send([0xb0, CC_ALL_NOTES_OFF, 0]);
    }
    this.sounding.clear();
  }
}
