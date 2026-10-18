import { describe, expect, it } from "vitest";
import { buildTimeline, defaultHandMap, firstIndexAtMeasure, onsetNotes, onsetPitches } from "../src/engine/timeline";
import { rawStep } from "./helpers";

describe("buildTimeline", () => {
  it("tags staff 1 as right hand and staff 2 as left hand", () => {
    const [step] = buildTimeline([rawStep(0, [60], [48])]);
    expect(step!.notes).toEqual(
      expect.arrayContaining([
        { midi: 60, hand: "right", isOnset: true, duration: 0.25 },
        { midi: 48, hand: "left", isOnset: true, duration: 0.25 },
      ]),
    );
  });

  it("drops rest-only cursor positions", () => {
    const steps = buildTimeline([rawStep(0, [60]), rawStep(1), rawStep(2, [62])]);
    expect(steps.map((s) => s.scoreStep)).toEqual([0, 2]);
    expect(steps.map((s) => s.index)).toEqual([0, 1]);
  });

  it("keeps tie continuations as non-onsets", () => {
    const [step] = buildTimeline([rawStep(0, [{ midi: 60, tiedFromPrevious: true }, 64])]);
    expect(step!.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ midi: 60, hand: "right", isOnset: false }),
        expect.objectContaining({ midi: 64, hand: "right", isOnset: true }),
      ]),
    );
  });

  it("skips grace notes by default, requires them when opted in", () => {
    const raw = [rawStep(0, [{ midi: 62, grace: true }, 60])];
    const skipped = buildTimeline(raw)[0]!.notes.find((n) => n.midi === 62);
    expect(skipped).toMatchObject({ isOnset: false });
    const included = buildTimeline(raw, defaultHandMap, { includeGraceNotes: true })[0]!;
    expect(included.notes.find((n) => n.midi === 62)).toMatchObject({ isOnset: true });
  });

  it("dedupes unisons, letting an onset win over a tie continuation", () => {
    const [step] = buildTimeline([
      rawStep(0, [{ midi: 60 }, { midi: 60, tiedFromPrevious: true }]),
    ]);
    expect(step!.notes).toEqual([{ midi: 60, hand: "right", isOnset: true, duration: 0.25 }]);
  });

  it("drops notes the hand map excludes", () => {
    const steps = buildTimeline([rawStep(0, [60], [48])], (n) => (n.staff === 1 ? "right" : null));
    expect(steps[0]!.notes).toEqual([{ midi: 60, hand: "right", isOnset: true, duration: 0.25 }]);
  });

  it("onsetPitches returns one hand's fresh onsets only", () => {
    const [step] = buildTimeline([
      rawStep(0, [60, { midi: 64, tiedFromPrevious: true }], [48, 52]),
    ]);
    expect(onsetPitches(step!, "left").sort()).toEqual([48, 52]);
    expect(onsetPitches(step!, "right")).toEqual([60]);
  });

  it("onsetNotes carries durations for auto-play", () => {
    const [step] = buildTimeline([rawStep(0, [], [{ midi: 48, duration: 0.5 }])]);
    expect(onsetNotes(step!, "left")).toEqual([
      { midi: 48, hand: "left", isOnset: true, duration: 0.5 },
    ]);
  });

  it("firstIndexAtMeasure finds the loop jump target", () => {
    const raw = [rawStep(0, [60]), rawStep(1, [62]), rawStep(2, [64]), rawStep(3, [65])];
    raw[0]!.measureIndex = 0;
    raw[1]!.measureIndex = 1;
    raw[2]!.measureIndex = 2;
    raw[3]!.measureIndex = 2;
    const timeline = buildTimeline(raw);
    expect(firstIndexAtMeasure(timeline, 0)).toBe(0);
    expect(firstIndexAtMeasure(timeline, 2)).toBe(2);
    expect(firstIndexAtMeasure(timeline, 1)).toBe(1);
    // past the last measure: fall back to the start
    expect(firstIndexAtMeasure(timeline, 9)).toBe(0);
  });
});
