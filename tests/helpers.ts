import type { RawNote, RawStep } from "../src/engine/timeline";

type NoteSpec = number | Partial<RawNote> & { midi: number };

/** Build a RawStep: rawStep(0, [60, 64], [{ midi: 48, staff: 2 }]) */
export function rawStep(scoreStep: number, rh: NoteSpec[] = [], lh: NoteSpec[] = []): RawStep {
  const note = (spec: NoteSpec, staff: number): RawNote => {
    const partial = typeof spec === "number" ? { midi: spec } : spec;
    return { part: 0, staff, tiedFromPrevious: false, grace: false, duration: 0.25, ...partial };
  };
  return {
    scoreStep,
    measureIndex: 0,
    timestamp: scoreStep,
    notes: [...rh.map((s) => note(s, 1)), ...lh.map((s) => note(s, 2))],
  };
}
