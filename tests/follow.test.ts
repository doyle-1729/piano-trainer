import { describe, expect, it } from "vitest";
import { FollowSession, type FollowEvent } from "../src/engine/follow";
import { buildTimeline } from "../src/engine/timeline";
import { rawStep } from "./helpers";

const kinds = (events: FollowEvent[]) => events.map((e) => e.kind);

function session(raw: Parameters<typeof buildTimeline>[0], options = {}) {
  const s = new FollowSession(buildTimeline(raw), options);
  const initial = s.begin();
  return { s, initial };
}

describe("FollowSession basics", () => {
  it("advances through single notes and finishes", () => {
    const { s } = session([rawStep(0, [60]), rawStep(1, [62])]);
    expect(kinds(s.noteOn(60, 0))).toEqual(["match", "step"]);
    expect(kinds(s.noteOn(62, 500))).toEqual(["match", "finished"]);
    expect(s.finished).toBe(true);
    expect(s.noteOn(60, 600)).toEqual([]); // input after the end is ignored
  });

  it("flags wrong notes and does not advance", () => {
    const { s } = session([rawStep(0, [60])]);
    const events = s.noteOn(61, 0);
    expect(events).toEqual([{ kind: "wrong", midi: 61, step: expect.objectContaining({ index: 0 }) }]);
    expect(s.step!.index).toBe(0);
  });

  it("ignores input before begin()", () => {
    const s = new FollowSession(buildTimeline([rawStep(0, [60])]));
    expect(s.noteOn(60, 0)).toEqual([]);
    s.begin();
    expect(kinds(s.noteOn(60, 1))).toEqual(["match", "finished"]);
  });

  it("restarts via seek(0)", () => {
    const { s } = session([rawStep(0, [60]), rawStep(1, [62])]);
    s.noteOn(60, 0);
    const events = s.seek(0);
    expect(kinds(events)).toEqual(["step"]);
    expect(s.step!.index).toBe(0);
    expect(s.matchedPitches()).toEqual([]);
  });
});

describe("chords and the tolerance window", () => {
  it("completes a chord when all notes arrive within the window", () => {
    const { s } = session([rawStep(0, [60, 64, 67])]);
    expect(kinds(s.noteOn(64, 0))).toEqual(["match"]);
    expect(kinds(s.noteOn(60, 50))).toEqual(["match"]);
    expect(s.remainingPitches()).toEqual([67]);
    expect(kinds(s.noteOn(67, 140))).toEqual(["match", "finished"]);
  });

  it("drops stale presses outside the window (default 150 ms)", () => {
    const { s } = session([rawStep(0, [60, 64])]);
    s.noteOn(60, 0);
    expect(kinds(s.noteOn(64, 200))).toEqual(["match"]); // 60 went stale — chord not complete
    expect(s.remainingPitches()).toEqual([60]);
    expect(kinds(s.noteOn(60, 250))).toEqual(["match", "finished"]); // re-pressed in time
  });

  it("honours a custom window", () => {
    const { s } = session([rawStep(0, [60, 64])], { chordWindowMs: 1000 });
    s.noteOn(60, 0);
    expect(kinds(s.noteOn(64, 900))).toEqual(["match", "finished"]);
  });

  it("re-pressing an already matched pitch refreshes its time", () => {
    const { s } = session([rawStep(0, [60, 64])]);
    s.noteOn(60, 0);
    s.noteOn(60, 300);
    expect(kinds(s.noteOn(64, 350))).toEqual(["match", "finished"]);
  });
});

describe("ties, grace notes and rests", () => {
  it("does not require a re-press on a tie continuation, and auto-steps through it", () => {
    const raw = [rawStep(0, [60]), rawStep(1, [{ midi: 60, tiedFromPrevious: true }]), rawStep(2, [62])];
    const { s } = session(raw);
    const events = s.noteOn(60, 0);
    // match, auto-step through the tied position, land on step 2
    expect(kinds(events)).toEqual(["match", "step", "step"]);
    expect(events[1]).toMatchObject({ kind: "step", auto: true, step: { scoreStep: 1 } });
    expect(events[2]).toMatchObject({ kind: "step", auto: false, step: { scoreStep: 2 } });
  });

  it("pressing a tied pitch again is not wrong", () => {
    const raw = [rawStep(0, [{ midi: 60, tiedFromPrevious: true }, 64])];
    const { s } = session(raw);
    expect(s.noteOn(60, 0)).toEqual([]); // ignorable, not wrong
    expect(kinds(s.noteOn(64, 10))).toEqual(["match", "finished"]);
  });

  it("pressing a skipped grace-note pitch is not wrong", () => {
    const { s } = session([rawStep(0, [{ midi: 62, grace: true }, 60])]);
    expect(s.noteOn(62, 0)).toEqual([]);
    expect(kinds(s.noteOn(60, 10))).toEqual(["match", "finished"]);
  });

  it("rest-only positions never block (dropped from the timeline)", () => {
    const { s } = session([rawStep(0, [60]), rawStep(1), rawStep(2, [62])]);
    const events = s.noteOn(60, 0);
    expect(kinds(events)).toEqual(["match", "step"]);
    expect((events[1] as { step: { scoreStep: number } }).step.scoreStep).toBe(2);
  });
});

describe("hand modes", () => {
  const raw = [
    rawStep(0, [72], [48]), // both hands
    rawStep(1, [], [50]),   // left only
    rawStep(2, [76], []),   // right only
  ];

  it("right-only: left-hand steps auto-advance, left-hand notes are ignorable", () => {
    const { s } = session(raw, { hands: "right" });
    expect(s.requiredPitches()).toEqual([72]);
    expect(s.noteOn(48, 0)).toEqual([]); // other hand's note at this step: not wrong
    const events = s.noteOn(72, 10);
    expect(kinds(events)).toEqual(["match", "step", "step"]);
    expect(events[1]).toMatchObject({ auto: true, step: { scoreStep: 1 } }); // LH-only step
    expect(events[2]).toMatchObject({ auto: false, step: { scoreStep: 2 } });
  });

  it("both: requires both hands' pitches", () => {
    const { s } = session(raw);
    s.noteOn(72, 0);
    expect(s.remainingPitches()).toEqual([48]);
    expect(kinds(s.noteOn(48, 50))).toEqual(["match", "step"]);
  });

  it("begin() auto-steps through leading steps that need no input", () => {
    const { s, initial } = session([rawStep(0, [], [48]), rawStep(1, [72])], { hands: "right" });
    expect(kinds(initial)).toEqual(["step", "step"]);
    expect(initial[0]).toMatchObject({ auto: true });
    expect(s.step!.scoreStep).toBe(1);
  });

  it("switching hands mid-step clears progress and may auto-advance", () => {
    const { s } = session([rawStep(0, [72], [48]), rawStep(1, [], [50])]);
    s.noteOn(72, 0); // partial in "both"
    const events = s.setHands("right");
    expect(events).toEqual([]); // 72 now the only requirement, but progress was cleared
    s.noteOn(72, 100);
    // now at LH-only step in right mode → auto → finished
    expect(s.finished).toBe(true);
  });

  it("a fully finished switch emits finished once", () => {
    const { s } = session([rawStep(0, [], [48])], { hands: "both" });
    s.noteOn(48, 0);
    expect(s.finished).toBe(true);
    expect(s.setHands("right")).toEqual([]);
  });
});
