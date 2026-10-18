import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import type { RawStep } from "../engine/timeline";
import { toRawNote, type OsmdNoteLike } from "./extract";

/** Safety net against an iterator that never ends (e.g. malformed repeat structure). */
const MAX_STEPS = 100_000;

export type CursorFeedback = "neutral" | "wrong" | "done";

const CURSOR_COLORS: Record<CursorFeedback, string> = {
  neutral: "#4da3ff",
  wrong: "#e5484d",
  done: "#30a46c",
};

/**
 * OSMD wrapper: load/render MusicXML, drive the visible cursor, extract the
 * raw timeline, and colour noteheads for feedback. `load` accepts a string
 * (XML text) or a Blob/File — OSMD detects compressed .mxl itself.
 */
/** OSMD renders at 10 px per unit at zoom 1. */
const UNIT_PX = 10;

export type MeasureRect = { x: number; y: number; width: number; height: number };

export class ScoreView {
  private osmd: OpenSheetMusicDisplay;
  private container: HTMLElement;
  private _loaded = false;
  private scoreStep = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,
      backend: "svg",
      drawTitle: true,
      followCursor: true,
      cursorsOptions: [{ type: 0, color: CURSOR_COLORS.neutral, alpha: 0.5, follow: true }],
    });
  }

  async load(content: string | Blob): Promise<void> {
    await this.osmd.load(content);
    this.osmd.render();
    this.osmd.cursor.show();
    this._loaded = true;
    this.scoreStep = 0;
  }

  get loaded(): boolean {
    return this._loaded;
  }

  get title(): string {
    return this.osmd.Sheet?.TitleString ?? "";
  }

  /**
   * Walk the cursor through the whole score (OSMD's iterator unrolls repeats
   * and voltas) and collect every position's notes, then rewind.
   */
  readSteps(): RawStep[] {
    const cursor = this.osmd.cursor;
    const instruments = this.osmd.Sheet.Instruments;
    const follow = this.osmd.FollowCursor;
    this.osmd.FollowCursor = false; // don't scroll the page during the walk
    cursor.reset();
    const steps: RawStep[] = [];
    for (let scoreStep = 0; !cursor.Iterator.EndReached; scoreStep++) {
      if (scoreStep > MAX_STEPS) throw new Error(`score cursor did not end after ${MAX_STEPS} steps`);
      const it = cursor.Iterator;
      const notes = [];
      for (const note of cursor.NotesUnderCursor()) {
        const osmdNote = note as unknown as OsmdNoteLike;
        const raw = toRawNote(osmdNote, instruments.indexOf(note.ParentStaff.ParentInstrument));
        if (raw) notes.push(raw);
      }
      steps.push({
        scoreStep,
        measureIndex: it.CurrentMeasureIndex,
        timestamp: it.CurrentEnrolledTimestamp.RealValue,
        notes,
      });
      cursor.next();
    }
    cursor.reset();
    this.scoreStep = 0;
    this.osmd.FollowCursor = follow;
    return steps;
  }

  /** Move the visible cursor to a score step (forward is incremental; backward rewinds). */
  moveToScoreStep(target: number): void {
    if (!this._loaded) return;
    const cursor = this.osmd.cursor;
    if (target < this.scoreStep) {
      cursor.reset();
      this.scoreStep = 0;
    }
    while (this.scoreStep < target && !cursor.Iterator.EndReached) {
      cursor.next();
      this.scoreStep++;
    }
  }

  /** The score's starting tempo in BPM, or the fallback when it has none. */
  tempoBpm(fallback = 100): number {
    const bpm = this.osmd.Sheet?.DefaultStartTempoInBpm;
    return bpm && bpm > 0 ? bpm : fallback;
  }

  get zoom(): number {
    return this.osmd.Zoom;
  }

  /** Re-renders at the new zoom and restores the cursor position. */
  setZoom(zoom: number): void {
    this.osmd.Zoom = zoom;
    if (!this._loaded) return;
    const current = this.scoreStep;
    this.osmd.render();
    this.osmd.cursor.show();
    this.scoreStep = 0;
    this.moveToScoreStep(current);
  }

  /** 0-based measure index at a mouse position, or null when not on a measure. */
  measureAtPoint(clientX: number, clientY: number): number | null {
    if (!this._loaded) return null;
    const rect = this.container.getBoundingClientRect();
    const scale = UNIT_PX * this.osmd.Zoom;
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale;
    const measureList = this.osmd.GraphicSheet.MeasureList;
    for (let i = 0; i < measureList.length; i++) {
      for (const gm of measureList[i] ?? []) {
        if (!gm) continue;
        const box = gm.PositionAndShape;
        const pos = box.AbsolutePosition;
        if (x >= pos.x && x <= pos.x + box.Size.width && y >= pos.y - 1 && y <= pos.y + box.Size.height + 1) {
          return i;
        }
      }
    }
    return null;
  }

  /** Pixel rectangles (container-relative) of all staves of measures [from..to]. */
  measureRects(from: number, to: number): MeasureRect[] {
    if (!this._loaded) return [];
    const scale = UNIT_PX * this.osmd.Zoom;
    const rects: MeasureRect[] = [];
    const measureList = this.osmd.GraphicSheet.MeasureList;
    for (let i = from; i <= to && i < measureList.length; i++) {
      for (const gm of measureList[i] ?? []) {
        if (!gm) continue;
        const box = gm.PositionAndShape;
        rects.push({
          x: box.AbsolutePosition.x * scale,
          y: (box.AbsolutePosition.y - 1) * scale,
          width: box.Size.width * scale,
          height: (box.Size.height + 2) * scale,
        });
      }
    }
    return rects;
  }

  setCursorFeedback(kind: CursorFeedback): void {
    const cursor = this.osmd.cursor;
    cursor.CursorOptions = { ...cursor.CursorOptions, color: CURSOR_COLORS[kind] };
    cursor.update();
  }

}
