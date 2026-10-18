import { describe, expect, it } from "vitest";
import { soundingMidi, toRawNote, type OsmdNoteLike } from "../src/score/extract";

function osmdNote(overrides: Partial<OsmdNoteLike> & { staves?: number; staffIndex?: number } = {}): OsmdNoteLike {
  const { staves = 2, staffIndex = 0, ...rest } = overrides;
  const staffObjects = Array.from({ length: staves }, (_, i) => ({ staffNo: i }));
  const note: OsmdNoteLike = {
    halfTone: 48, // C4
    isRest: () => false,
    IsGraceNote: false,
    IsCueNote: false,
    NoteTie: undefined,
    ParentStaff: undefined as never,
    ...rest,
  };
  if (!note.ParentStaff) {
    note.ParentStaff = Object.assign(staffObjects[staffIndex]!, {
      ParentInstrument: { PlaybackTranspose: 0, Staves: staffObjects },
    }) as unknown as OsmdNoteLike["ParentStaff"];
  }
  return note;
}

describe("toRawNote", () => {
  it("converts halfTone to MIDI (C4 = 60)", () => {
    expect(toRawNote(osmdNote(), 0)).toMatchObject({ midi: 60 });
  });

  it("applies PlaybackTranspose for transposing instruments", () => {
    const note = osmdNote();
    note.ParentStaff.ParentInstrument.PlaybackTranspose = -2; // e.g. Bb instrument
    expect(soundingMidi(note)).toBe(58);
  });

  it("returns null for rests", () => {
    expect(toRawNote(osmdNote({ isRest: () => true }), 0)).toBeNull();
  });

  it("reports the 1-based staff number within the instrument", () => {
    expect(toRawNote(osmdNote({ staffIndex: 0 }), 0)).toMatchObject({ staff: 1 });
    expect(toRawNote(osmdNote({ staffIndex: 1 }), 0)).toMatchObject({ staff: 2 });
  });

  it("marks tie continuations but not tie starts", () => {
    const start = osmdNote();
    start.NoteTie = { StartNote: start };
    expect(toRawNote(start, 0)).toMatchObject({ tiedFromPrevious: false });

    const continuation = osmdNote();
    continuation.NoteTie = { StartNote: start };
    expect(toRawNote(continuation, 0)).toMatchObject({ tiedFromPrevious: true });
  });

  it("marks grace and cue notes", () => {
    expect(toRawNote(osmdNote({ IsGraceNote: true }), 0)).toMatchObject({ grace: true });
    expect(toRawNote(osmdNote({ IsCueNote: true }), 0)).toMatchObject({ grace: true });
  });
});
