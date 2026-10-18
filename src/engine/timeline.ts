/**
 * Score timeline: the pure data the follow engine runs on.
 *
 * The adapter layer (OSMD cursor walk) produces RawSteps; buildTimeline turns
 * them into Steps with hand tags. This module has no DOM/OSMD/MIDI imports so
 * it is unit-testable with hand-built fixtures.
 */

export type Hand = "right" | "left";

/** One note as extracted from the score at one cursor position. */
export type RawNote = {
  /** Sounding MIDI pitch (transposition already applied by the extractor). */
  midi: number;
  /** 0-based instrument/part index. */
  part: number;
  /** 1-based staff number within the part. */
  staff: number;
  /** True for the continuation of a tie — not a new onset. */
  tiedFromPrevious: boolean;
  grace: boolean;
  /** Note length in whole-note units (quarter = 0.25). Used to pace auto-play. */
  duration: number;
};

/** One cursor position in score order (repeats already unrolled by OSMD). */
export type RawStep = {
  /** OSMD cursor step index — the UI moves the cursor to this. */
  scoreStep: number;
  /** 0-based measure index. */
  measureIndex: number;
  /** Musical time in whole-note units (for auto-play pacing later). */
  timestamp: number;
  notes: RawNote[];
};

export type TimelineNote = {
  midi: number;
  hand: Hand;
  /**
   * True for a fresh onset the player must press. False for tie continuations
   * and skipped grace notes: those are never required, and pressing them is
   * not wrong either.
   */
  isOnset: boolean;
  /** Note length in whole-note units. */
  duration: number;
};

export type Step = {
  /** Index in the timeline (rest-only cursor positions are dropped). */
  index: number;
  scoreStep: number;
  measureIndex: number;
  timestamp: number;
  notes: TimelineNote[];
};

/** Assigns a note to a hand; null drops it from the timeline entirely. */
export type HandMap = (note: { part: number; staff: number }) => Hand | null;

/** Spec default: staff 1 = right hand, staff 2 = left hand. */
export const defaultHandMap: HandMap = (n) =>
  n.staff === 1 ? "right" : n.staff === 2 ? "left" : null;

export type TimelineOptions = {
  /** When true, grace notes become required onsets. Default: skipped. */
  includeGraceNotes?: boolean;
};

export function buildTimeline(
  raw: RawStep[],
  handMap: HandMap = defaultHandMap,
  opts: TimelineOptions = {},
): Step[] {
  const steps: Step[] = [];
  for (const rawStep of raw) {
    // Dedupe unisons per (hand, midi); an onset wins over a non-onset.
    const byKey = new Map<string, TimelineNote>();
    for (const note of rawStep.notes) {
      const hand = handMap(note);
      if (hand === null) continue;
      const isOnset = !note.tiedFromPrevious && (!note.grace || !!opts.includeGraceNotes);
      const key = `${hand}:${note.midi}`;
      const existing = byKey.get(key);
      if (!existing || (isOnset && !existing.isOnset)) {
        byKey.set(key, { midi: note.midi, hand, isOnset, duration: note.duration });
      }
    }
    if (byKey.size === 0) continue; // rest-only position: not a step
    steps.push({
      index: steps.length,
      scoreStep: rawStep.scoreStep,
      measureIndex: rawStep.measureIndex,
      timestamp: rawStep.timestamp,
      notes: [...byKey.values()],
    });
  }
  return steps;
}

/** Fresh-onset notes of one hand at a step (what auto-play sends for the inactive hand). */
export function onsetNotes(step: Step, hand: Hand): TimelineNote[] {
  return step.notes.filter((n) => n.hand === hand && n.isOnset);
}

/** Fresh-onset pitches of one hand at a step. */
export function onsetPitches(step: Step, hand: Hand): number[] {
  return onsetNotes(step, hand).map((n) => n.midi);
}

/** First timeline index whose measure is >= the given measure (for loop jumps). */
export function firstIndexAtMeasure(timeline: Step[], measureIndex: number): number {
  const i = timeline.findIndex((s) => s.measureIndex >= measureIndex);
  return i === -1 ? 0 : i;
}
