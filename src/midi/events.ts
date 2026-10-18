/**
 * Normalised MIDI events. Pure module — no Web MIDI imports — so the follow
 * engine and tests consume these without a browser.
 */

export type NoteOn = { kind: "noteOn"; note: number; velocity: number; channel: number };
export type NoteOff = { kind: "noteOff"; note: number; channel: number };
export type ControlChange = { kind: "control"; controller: number; value: number; channel: number };

export type MidiEvent = NoteOn | NoteOff | ControlChange;

export const SUSTAIN_PEDAL = 64;

/**
 * Parse one raw MIDI message. Note-on with velocity 0 is a note-off (the
 * CLP-875 and most keyboards send these). Returns null for messages we don't
 * model (sysex, clock, aftertouch, …).
 */
export function parseMidiMessage(data: ArrayLike<number>): MidiEvent | null {
  if (data.length < 3) return null;
  const status = data[0] as number;
  if (status < 0x80) return null;
  const type = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const d1 = data[1] as number;
  const d2 = data[2] as number;
  if (type === 0x90) {
    return d2 > 0
      ? { kind: "noteOn", note: d1, velocity: d2, channel }
      : { kind: "noteOff", note: d1, channel };
  }
  if (type === 0x80) return { kind: "noteOff", note: d1, channel };
  if (type === 0xb0) return { kind: "control", controller: d1, value: d2, channel };
  return null;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** 60 → "C4", 21 → "A0", 108 → "C8". */
export function noteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}
