import type { RawNote } from "../engine/timeline";

/**
 * Conversion from OSMD's note model to the engine's RawNote. Typed against a
 * structural subset of OSMD's Note so it stays unit-testable without OSMD.
 */
export interface OsmdNoteLike {
  /** OSMD half tone: MIDI − 12 (C4 = 48). */
  halfTone: number;
  isRest(): boolean;
  IsGraceNote: boolean;
  IsCueNote: boolean;
  /** Present when the note is part of a tie; StartNote identifies the onset. */
  NoteTie?: { StartNote: unknown } | undefined;
  /** Note length; RealValue is in whole-note units. */
  Length?: { RealValue: number };
  ParentStaff: {
    ParentInstrument: {
      /** MusicXML <transpose>: written → sounding. */
      PlaybackTranspose: number;
      Staves: readonly unknown[];
    };
  };
}

/** Sounding MIDI pitch (handles transposing instruments; clefs are already baked in). */
export function soundingMidi(note: OsmdNoteLike): number {
  return note.halfTone + 12 + (note.ParentStaff.ParentInstrument.PlaybackTranspose ?? 0);
}

/** Convert one OSMD note, or null for rests. */
export function toRawNote(note: OsmdNoteLike, part: number): RawNote | null {
  if (note.isRest()) return null;
  return {
    midi: soundingMidi(note),
    part,
    staff: note.ParentStaff.ParentInstrument.Staves.indexOf(note.ParentStaff) + 1,
    tiedFromPrevious: !!note.NoteTie && note.NoteTie.StartNote !== note,
    grace: note.IsGraceNote || note.IsCueNote,
    duration: note.Length?.RealValue ?? 0.25,
  };
}
