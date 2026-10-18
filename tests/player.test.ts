import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Player, type PlayableNote, type PlayerOut } from "../src/playback";
import type { Step, TimelineNote } from "../src/engine/timeline";

function note(midi: number, duration = 0.25, isOnset = true): TimelineNote {
  return { midi, hand: "right", isOnset, duration };
}

function step(index: number, timestamp: number, notes: TimelineNote[], measureIndex = 0): Step {
  return { index, scoreStep: index, measureIndex, timestamp, notes };
}

class FakeOut implements PlayerOut {
  played: PlayableNote[][] = [];
  allOffCalls = 0;
  play(notes: PlayableNote[]): void {
    this.played.push(notes);
  }
  allOff(): void {
    this.allOffCalls++;
  }
}

// 100 bpm quarter notes → whole note = 2400ms, quarter gap = 600ms.
const WHOLE_MS = 2400;

describe("Player", () => {
  let out: FakeOut;
  let player: Player;

  beforeEach(() => {
    vi.useFakeTimers();
    out = new FakeOut();
    player = new Player(out, () => WHOLE_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const quarters = [
    step(0, 0, [note(60)]),
    step(1, 0.25, [note(62)]),
    step(2, 0.5, [note(64)], 1),
  ];

  it("plays steps at the score's spacing", () => {
    player.start(quarters, 0, 2, false);
    expect(out.played).toEqual([[{ midi: 60, durationMs: 600 }]]);
    vi.advanceTimersByTime(600);
    expect(out.played).toHaveLength(2);
    expect(out.played[1]).toEqual([{ midi: 62, durationMs: 600 }]);
    vi.advanceTimersByTime(600);
    expect(out.played).toHaveLength(3);
  });

  it("reports steps and a final stop", () => {
    const steps: number[] = [];
    let stoppedAt = -1;
    player.onStep = (i) => steps.push(i);
    player.onStop = (i) => (stoppedAt = i);
    player.start(quarters, 0, 2, false);
    vi.advanceTimersByTime(10_000);
    expect(steps).toEqual([0, 1, 2]);
    expect(player.playing).toBe(false);
    expect(stoppedAt).toBe(2);
    expect(out.allOffCalls).toBe(1);
  });

  it("skips non-onset notes (ties, graces)", () => {
    player.start([step(0, 0, [note(60), note(64, 0.25, false)])], 0, 0, false);
    expect(out.played).toEqual([[{ midi: 60, durationMs: 600 }]]);
  });

  it("plays only the requested range", () => {
    const steps: number[] = [];
    player.onStep = (i) => steps.push(i);
    player.start(quarters, 1, 2, false);
    vi.advanceTimersByTime(10_000);
    expect(steps).toEqual([1, 2]);
  });

  it("wraps the range until stopped", () => {
    const steps: number[] = [];
    player.onStep = (i) => steps.push(i);
    player.start(quarters, 0, 1, true);
    vi.advanceTimersByTime(600 * 4);
    expect(steps.length).toBeGreaterThan(3);
    expect(steps.slice(0, 4)).toEqual([0, 1, 0, 1]);
    expect(player.playing).toBe(true);
    player.stop();
    expect(player.playing).toBe(false);
  });

  it("stop() silences output and is idempotent", () => {
    player.start(quarters, 0, 2, false);
    player.stop();
    player.stop();
    expect(out.allOffCalls).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(out.played).toHaveLength(1); // nothing scheduled after stop
  });

  it("ignores an empty or inverted range", () => {
    player.start([], 0, 0, false);
    expect(player.playing).toBe(false);
    player.start(quarters, 2, 1, false);
    expect(player.playing).toBe(false);
  });
});
