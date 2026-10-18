import "./ui/style.css";
import { isWebMidiSupported, MidiManager } from "./midi/devices";
import { noteName, SUSTAIN_PEDAL, type MidiEvent } from "./midi/events";
import { MidiOut } from "./midi/output";
import { KeyboardSim } from "./input/keyboardSim";
import { EventLog } from "./ui/log";
import { KeyStrip } from "./ui/keys";
import { ScoreView } from "./score/view";
import { buildTimeline, firstIndexAtMeasure, onsetNotes, type Hand, type Step } from "./engine/timeline";
import { FollowSession, type FollowEvent, type HandMode } from "./engine/follow";
import { Player } from "./playback";

const KEYBOARD_ID = "__keyboard__";
const SOURCE_KEY = "pianoTrainer.inputSource";
const SETTINGS_KEY = "pianoTrainer.settings";

const SAMPLES = [
  { name: "C major scale", url: "/scores/c-major-scale.musicxml" },
  { name: "Two hands with chords", url: "/scores/two-hands-chords.musicxml" },
  { name: "Ties across two staves", url: "/scores/ties-two-staves.musicxml" },
  { name: "Warmup with repeats", url: "/scores/warmup-repeats.musicxml" },
];

// ---------- settings ----------

type Settings = {
  hands: HandMode;
  autoPlay: boolean;
  chordWindowMs: number;
  zoomPct: number;
  showKeys: boolean;
  tempoPct: number;
};

const DEFAULT_SETTINGS: Settings = {
  hands: "both",
  autoPlay: true,
  chordWindowMs: 150,
  zoomPct: 100,
  showKeys: false,
  tempoPct: 100,
};

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const settings = loadSettings();

function saveSettings(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ---------- page ----------

const app = document.getElementById("app")!;
app.innerHTML = `
  <header>
    <h1>Piano Trainer</h1>
    <span class="status" id="status">starting…</span>
    <span class="status waiting" id="position" hidden></span>
    <span class="status wrong-note" id="wrong-note" hidden></span>
    <span class="status loop-chip" id="loop-chip" hidden></span>
    <button class="loop-clear" id="loop-clear" type="button" hidden>✕ clear loop</button>
  </header>
  <div id="banner"></div>
  <div class="controls">
    <label>Score
      <span class="file-row">
        <button id="open-btn" type="button">Open file…</button>
        <select id="sample-select">
          <option value="">Samples…</option>
          ${SAMPLES.map((s, i) => `<option value="${i}">${s.name}</option>`).join("")}
        </select>
        <input id="file-input" type="file" accept=".musicxml,.xml,.mxl" hidden />
      </span>
    </label>
    <label>Playback
      <button id="play-btn" type="button" disabled>▶ Play</button>
    </label>
    <label>Hands
      <span class="file-row">
        <select id="hands-select">
          <option value="both">Both</option>
          <option value="right">Right only</option>
          <option value="left">Left only</option>
        </select>
        <label class="inline-check" id="autoplay-label">
          <input type="checkbox" id="autoplay-check" /> auto-play other hand
        </label>
      </span>
    </label>
    <label>MIDI input
      <select id="input-select"></select>
    </label>
    <label>MIDI output
      <select id="output-select"></select>
    </label>
  </div>
  <details class="settings">
    <summary>Settings</summary>
    <div class="settings-row">
      <label>Chord window (ms)
        <input id="chord-window" type="number" min="30" max="2000" step="10" />
      </label>
      <label>Zoom <span id="zoom-value"></span>
        <input id="zoom-range" type="range" min="50" max="200" step="10" />
      </label>
      <label>Playback tempo <span id="tempo-value"></span>
        <input id="tempo-range" type="range" min="50" max="150" step="5" />
      </label>
      <label class="inline-check settings-check">
        <input type="checkbox" id="keys-check" /> on-screen keyboard
      </label>
    </div>
  </details>
  <div id="score-wrap">
    <div id="score-empty">
      Drop a <strong>.musicxml</strong> / <strong>.xml</strong> / <strong>.mxl</strong> file here,
      or use <em>Open file…</em> / the samples above.
    </div>
    <div id="score"></div>
    <div id="loop-overlay"></div>
  </div>
  <div id="keystrip-wrap" hidden><div id="keystrip"></div></div>
  <p class="hint" id="cursor-hint" hidden>
    Wait mode: play the highlighted notes to advance. Click a measure to jump there;
    <strong>→</strong>/<strong>←</strong> step, <strong>Home</strong> restarts,
    <strong>Space</strong> plays/stops the score (the loop segment when one is on).
    Loop: <strong>shift-click</strong> the start measure, shift-click the end;
    <strong>L</strong> toggles, <strong>Esc</strong> or ✕ clears.
  </p>
  <details class="monitor">
    <summary>MIDI monitor</summary>
    <div class="now-playing">
      <span class="label">Held notes</span>
      <span id="held"></span>
      <span class="pedal" id="pedal">pedal up</span>
    </div>
    <p class="hint" id="hint"></p>
    <div class="log" id="log"></div>
  </details>
`;

const statusEl = document.getElementById("status")!;
const positionEl = document.getElementById("position")!;
const wrongNoteEl = document.getElementById("wrong-note")!;
const loopChipEl = document.getElementById("loop-chip")!;
const loopClearBtn = document.getElementById("loop-clear") as HTMLButtonElement;
const bannerEl = document.getElementById("banner")!;
const inputSelect = document.getElementById("input-select") as HTMLSelectElement;
const outputSelect = document.getElementById("output-select") as HTMLSelectElement;
const sampleSelect = document.getElementById("sample-select") as HTMLSelectElement;
const handsSelect = document.getElementById("hands-select") as HTMLSelectElement;
const autoplayCheck = document.getElementById("autoplay-check") as HTMLInputElement;
const chordWindowInput = document.getElementById("chord-window") as HTMLInputElement;
const zoomRange = document.getElementById("zoom-range") as HTMLInputElement;
const zoomValue = document.getElementById("zoom-value")!;
const tempoRange = document.getElementById("tempo-range") as HTMLInputElement;
const tempoValue = document.getElementById("tempo-value")!;
const playBtn = document.getElementById("play-btn") as HTMLButtonElement;
const keysCheck = document.getElementById("keys-check") as HTMLInputElement;
const openBtn = document.getElementById("open-btn") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const scoreWrap = document.getElementById("score-wrap")!;
const scoreEmpty = document.getElementById("score-empty")!;
const loopOverlay = document.getElementById("loop-overlay")!;
const keystripWrap = document.getElementById("keystrip-wrap")!;
const cursorHint = document.getElementById("cursor-hint")!;
const heldEl = document.getElementById("held")!;
const pedalEl = document.getElementById("pedal")!;
const hintEl = document.getElementById("hint")!;
const log = new EventLog(document.getElementById("log")!);
const keyStrip = new KeyStrip(document.getElementById("keystrip")!);

// ---------- score, session, output ----------

const score = new ScoreView(document.getElementById("score")!);
let midiManager: MidiManager | null = null;
const midiOut = new MidiOut(() => midiManager?.outputPort ?? null);

// Demo playback of the score / loop segment. The player is the only consumer
// of MidiOut besides auto-play; it is never fed from MIDI input.
const player = new Player(midiOut, wholeNoteMs);
player.onStep = (i) => {
  const step = timeline[i];
  if (!step) return;
  score.moveToScoreStep(step.scoreStep);
  positionEl.hidden = false;
  positionEl.textContent = `measure ${step.measureIndex + 1} · playing…`;
};
player.onStop = (i) => {
  playBtn.textContent = "▶ Play";
  // Sync wait mode to wherever playback got to.
  if (session && timeline.length > 0) {
    apply(session.seek(Math.min(i, timeline.length - 1)), false);
  }
};

function lastIndexAtMeasure(steps: Step[], measureIndex: number): number {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i]!.measureIndex <= measureIndex) return i;
  }
  return steps.length - 1;
}

function togglePlay(): void {
  if (!session || timeline.length === 0) return;
  if (player.playing) {
    player.stop();
    return;
  }
  midiOut.allOff();
  let from: number;
  let to = timeline.length - 1;
  let wrap = false;
  if (loop.active && loop.start !== null && loop.end !== null) {
    from = firstIndexAtMeasure(timeline, loop.start);
    to = lastIndexAtMeasure(timeline, loop.end);
    wrap = true;
  } else {
    from = session.step && session.step.index < timeline.length ? session.step.index : 0;
  }
  playBtn.textContent = "◼ Stop";
  player.start(timeline, from, to, wrap);
}

playBtn.addEventListener("click", togglePlay);
let session: FollowSession | null = null;
let timeline: Step[] = [];
let wrongFlashTimer: number | undefined;
let wrongNoteTimer: number | undefined;

// Loop region, in 0-based measure indices.
const loop = { start: null as number | null, end: null as number | null, active: false };

function otherHand(mode: HandMode): Hand | null {
  return mode === "right" ? "left" : mode === "left" ? "right" : null;
}

function wholeNoteMs(): number {
  return ((4 * 60_000) / score.tempoBpm()) * (100 / settings.tempoPct);
}

function updatePosition(): void {
  positionEl.hidden = !session;
  keyStrip.setExpected(session?.remainingPitches() ?? []);
  if (!session) return;
  const step = session.step;
  if (!step) {
    positionEl.textContent = "🎉 finished — press Home to restart";
    return;
  }
  const waiting = session.remainingPitches().map(noteName).join(" ") || "…";
  positionEl.textContent = `measure ${step.measureIndex + 1} · waiting for ${waiting}`;
}

/**
 * Apply engine events to the UI. `live` means the events come from actual
 * playing (or begin/restart) rather than manual navigation: only live steps
 * trigger auto-play, and only live advancement honours the loop.
 */
function apply(events: FollowEvent[], live: boolean): void {
  for (const e of events) {
    switch (e.kind) {
      case "match":
        break;
      case "wrong":
        log.add(`wrong note ${noteName(e.midi)} (expected ${session?.remainingPitches().map(noteName).join(" ")})`, "info");
        score.setCursorFeedback("wrong");
        clearTimeout(wrongFlashTimer);
        wrongFlashTimer = window.setTimeout(() => score.setCursorFeedback("neutral"), 350);
        wrongNoteEl.textContent = `✗ ${noteName(e.midi)}`;
        wrongNoteEl.hidden = false;
        clearTimeout(wrongNoteTimer);
        wrongNoteTimer = window.setTimeout(() => (wrongNoteEl.hidden = true), 1500);
        keyStrip.flashWrong(e.midi);
        break;
      case "step": {
        score.moveToScoreStep(e.step.scoreStep);
        score.setCursorFeedback("neutral");
        const other = otherHand(session?.handMode ?? "both");
        if (live && settings.autoPlay && other) {
          const notes = onsetNotes(e.step, other).map((n) => ({
            midi: n.midi,
            durationMs: n.duration * wholeNoteMs(),
          }));
          if (notes.length > 0) midiOut.play(notes);
        }
        break;
      }
      case "finished":
        score.setCursorFeedback("done");
        break;
    }
  }

  // Loop: when live playing runs past the loop end (or the piece ends), jump back.
  if (live && loop.active && loop.start !== null && loop.end !== null && session) {
    const step = session.step;
    if (!step || step.measureIndex > loop.end) {
      midiOut.allOff();
      apply(session.seek(firstIndexAtMeasure(timeline, loop.start)), live);
      return;
    }
  }
  updatePosition();
}

function restart(): void {
  if (!session) return;
  player.stop();
  midiOut.allOff();
  const target = loop.active && loop.start !== null ? firstIndexAtMeasure(timeline, loop.start) : 0;
  apply(session.seek(target), true);
}

// ---------- looping ----------

function updateLoopUi(): void {
  loopClearBtn.hidden = loop.start === null;
  if (loop.start === null) {
    loopChipEl.hidden = true;
    loopOverlay.replaceChildren();
    return;
  }
  loopChipEl.hidden = false;
  const startLabel = `m${loop.start + 1}`;
  if (loop.end === null) {
    loopChipEl.textContent = `loop: ${startLabel} → shift-click the end measure`;
  } else {
    loopChipEl.textContent = `loop: ${startLabel}–m${loop.end + 1} ${loop.active ? "(on)" : "(off — L)"}`;
  }
  loopChipEl.classList.toggle("on", loop.active);

  loopOverlay.replaceChildren(
    ...score.measureRects(loop.start, loop.end ?? loop.start).map((r) => {
      const div = document.createElement("div");
      div.className = `loop-rect${loop.active ? " on" : ""}`;
      Object.assign(div.style, {
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      return div;
    }),
  );
}

function clearLoop(): void {
  loop.start = loop.end = null;
  loop.active = false;
  updateLoopUi();
}

loopClearBtn.addEventListener("click", clearLoop);

scoreWrap.addEventListener("click", (e) => {
  if (!session) return;
  const measure = score.measureAtPoint(e.clientX, e.clientY);
  if (measure === null) return;

  if (!e.shiftKey) {
    // Plain click: jump the cursor to that measure (manual navigation, like ←/→).
    player.stop();
    apply(session.seek(firstIndexAtMeasure(timeline, measure)), false);
    return;
  }

  // Shift-click: loop selection — start measure first, then the end measure.
  if (loop.start === null || loop.end !== null) {
    loop.start = measure;
    loop.end = null;
    loop.active = false;
  } else {
    loop.end = Math.max(loop.start, measure);
    loop.start = Math.min(loop.start, measure);
    loop.active = true;
  }
  updateLoopUi();
});

// Re-rendering on window resize moves the measures; redraw the overlay.
let resizeTimer: number | undefined;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(updateLoopUi, 400);
});

// ---------- score loading ----------

async function loadScore(content: string | Blob, label: string): Promise<void> {
  player.stop();
  midiOut.allOff();
  try {
    await score.load(content);
  } catch (err) {
    log.add(`failed to load ${label}: ${String(err)}`, "info");
    bannerEl.innerHTML = `<div class="banner">Couldn't load <strong>${label}</strong>: ${String(err)}</div>`;
    return;
  }
  bannerEl.replaceChildren();
  scoreEmpty.hidden = true;
  cursorHint.hidden = false;
  clearLoop();
  keyStrip.clear();

  timeline = buildTimeline(score.readSteps());
  session = new FollowSession(timeline, {
    hands: settings.hands,
    chordWindowMs: settings.chordWindowMs,
  });
  log.add(`loaded score: ${score.title || label} (${timeline.length} steps, ${score.tempoBpm()} bpm)`, "info");
  playBtn.disabled = false;
  apply(session.begin(), true);
}

async function loadFile(file: File): Promise<void> {
  if (!/\.(musicxml|xml|mxl)$/i.test(file.name)) {
    log.add(`unsupported file type: ${file.name}`, "info");
    return;
  }
  await loadScore(file, file.name);
}

openBtn.onclick = () => fileInput.click();
fileInput.onchange = () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
  fileInput.value = "";
};

sampleSelect.onchange = async () => {
  const sample = SAMPLES[Number(sampleSelect.value)];
  sampleSelect.value = "";
  if (!sample) return;
  const res = await fetch(sample.url);
  await loadScore(await res.text(), sample.name);
};

["dragover", "drop"].forEach((type) =>
  window.addEventListener(type, (e) => {
    e.preventDefault();
    scoreWrap.classList.toggle("dropping", type === "dragover");
    if (type === "drop") {
      const file = (e as DragEvent).dataTransfer?.files?.[0];
      if (file) loadFile(file);
    }
  }),
);
window.addEventListener("dragleave", () => scoreWrap.classList.remove("dropping"));

// ---------- keyboard shortcuts ----------

window.addEventListener("keydown", (e) => {
  if (!session || e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  if (target && /^(input|select|textarea)$/i.test(target.tagName)) return;
  if (e.key === "ArrowRight") {
    player.stop();
    const next = session.step ? session.step.index + 1 : timeline.length;
    apply(session.seek(Math.min(next, timeline.length)), false);
  } else if (e.key === "ArrowLeft") {
    player.stop();
    const prev = session.step ? session.step.index - 1 : timeline.length - 1;
    if (prev >= 0) apply(session.seek(prev), false);
  } else if (e.key === "Home") {
    restart();
  } else if (e.key === " ") {
    togglePlay();
  } else if (e.key === "l" || e.key === "L") {
    if (loop.start !== null && loop.end !== null) {
      loop.active = !loop.active;
      updateLoopUi();
    }
  } else if (e.key === "Escape") {
    clearLoop();
  } else return;
  e.preventDefault();
});

// ---------- settings UI ----------

function applyHandModeUi(): void {
  autoplayCheck.disabled = settings.hands === "both";
  document.getElementById("autoplay-label")!.classList.toggle("disabled", settings.hands === "both");
}

handsSelect.value = settings.hands;
autoplayCheck.checked = settings.autoPlay;
chordWindowInput.value = String(settings.chordWindowMs);
zoomRange.value = String(settings.zoomPct);
zoomValue.textContent = `${settings.zoomPct}%`;
keysCheck.checked = settings.showKeys;
keystripWrap.hidden = !settings.showKeys;
tempoRange.value = String(settings.tempoPct);
tempoValue.textContent = `${settings.tempoPct}%`;
score.setZoom(settings.zoomPct / 100);
applyHandModeUi();

handsSelect.onchange = () => {
  settings.hands = handsSelect.value as HandMode;
  saveSettings();
  applyHandModeUi();
  player.stop();
  midiOut.allOff();
  if (session) apply(session.setHands(settings.hands), true);
  updatePosition();
};

autoplayCheck.onchange = () => {
  settings.autoPlay = autoplayCheck.checked;
  saveSettings();
  if (!settings.autoPlay) midiOut.allOff();
};

chordWindowInput.onchange = () => {
  const value = Number(chordWindowInput.value);
  if (Number.isFinite(value) && value >= 30) {
    settings.chordWindowMs = value;
    saveSettings();
    session?.setChordWindowMs(value);
  }
};

tempoRange.oninput = () => {
  settings.tempoPct = Number(tempoRange.value);
  tempoValue.textContent = `${settings.tempoPct}%`;
  saveSettings();
};

zoomRange.oninput = () => {
  settings.zoomPct = Number(zoomRange.value);
  zoomValue.textContent = `${settings.zoomPct}%`;
  saveSettings();
  score.setZoom(settings.zoomPct / 100);
  updateLoopUi();
};

keysCheck.onchange = () => {
  settings.showKeys = keysCheck.checked;
  saveSettings();
  keystripWrap.hidden = !settings.showKeys;
};

// ---------- MIDI input & monitor ----------

const held = new Set<number>();

function renderHeld(): void {
  heldEl.replaceChildren(
    ...[...held].sort((a, b) => a - b).map((n) => {
      const chip = document.createElement("span");
      chip.className = "note-chip";
      chip.textContent = `${noteName(n)} (${n})`;
      return chip;
    }),
  );
}

function handleEvent(e: MidiEvent): void {
  if (e.kind === "noteOn") {
    held.add(e.note);
    renderHeld();
    keyStrip.setPressed(e.note, true);
    log.add(`note on   ${noteName(e.note).padEnd(4)} midi ${e.note}  vel ${e.velocity}  ch ${e.channel}`, "on");
    if (session && !session.finished && !player.playing) apply(session.noteOn(e.note, performance.now()), true);
  } else if (e.kind === "noteOff") {
    held.delete(e.note);
    renderHeld();
    keyStrip.setPressed(e.note, false);
    log.add(`note off  ${noteName(e.note).padEnd(4)} midi ${e.note}`, "off");
  } else if (e.controller === SUSTAIN_PEDAL) {
    const down = e.value >= 64;
    pedalEl.textContent = down ? "pedal down" : "pedal up";
    pedalEl.classList.toggle("down", down);
  }
}

const keyboardSim = new KeyboardSim();
keyboardSim.onEvent(handleEvent);
keyboardSim.onOctaveChange((base) => log.add(`keyboard octave base is now ${noteName(base)}`, "info"));

function setKeyboardHint(active: boolean): void {
  hintEl.textContent = active
    ? "Computer keyboard: A W S E D F T G Y H U J K play C4–C5 chromatically; Z / X shift the octave."
    : "";
}

async function initMidi(): Promise<void> {
  if (!isWebMidiSupported()) {
    populateSelectors(null);
    statusEl.textContent = "Web MIDI not supported";
    statusEl.classList.add("bad");
    bannerEl.innerHTML = `<div class="banner">This browser doesn't support Web MIDI (Safari doesn't).
      Open this page in <strong>Chrome</strong> to use the piano. The computer-keyboard input still works.</div>`;
    return;
  }

  // Populate with the keyboard fallback right away: Chrome may sit on a
  // permission prompt for a while, and the app should be usable meanwhile.
  populateSelectors(null);
  statusEl.textContent = "requesting MIDI access…";

  let midi: MidiManager;
  try {
    midi = await MidiManager.create();
  } catch (err) {
    populateSelectors(null);
    statusEl.textContent = "MIDI access denied";
    statusEl.classList.add("bad");
    bannerEl.innerHTML = `<div class="banner">MIDI access was blocked (${String(err)}).
      Allow it in Chrome's site settings and reload. The computer-keyboard input still works.</div>`;
    return;
  }

  midiManager = midi;
  midi.onEvent((e) => {
    if (inputSelect.value !== KEYBOARD_ID) handleEvent(e);
  });
  midi.onDevicesChanged(() => {
    populateSelectors(midi);
    log.add("MIDI devices changed", "info");
  });
  populateSelectors(midi);
}

function populateSelectors(midi: MidiManager | null): void {
  const inputs = midi?.listInputs() ?? [];
  const outputs = midi?.listOutputs() ?? [];

  statusEl.textContent = midi
    ? `Web MIDI OK — ${inputs.length} input${inputs.length === 1 ? "" : "s"}, ${outputs.length} output${outputs.length === 1 ? "" : "s"}`
    : "Web MIDI unavailable";
  if (midi) statusEl.classList.add("ok");

  inputSelect.replaceChildren(
    ...inputs.map((d) => new Option(d.name, d.id)),
    new Option("Computer keyboard (dev)", KEYBOARD_ID),
  );
  const storedSource = localStorage.getItem(SOURCE_KEY);
  if (storedSource === KEYBOARD_ID || inputs.length === 0) {
    inputSelect.value = KEYBOARD_ID;
  } else if (midi?.inputId && inputs.some((d) => d.id === midi.inputId)) {
    inputSelect.value = midi.inputId;
  }

  outputSelect.replaceChildren(
    new Option("None", ""),
    ...outputs.map((d) => new Option(d.name, d.id)),
  );
  outputSelect.value = midi?.outputId ?? "";

  applyInputChoice(midi);

  inputSelect.onchange = () => {
    localStorage.setItem(SOURCE_KEY, inputSelect.value);
    applyInputChoice(midi);
  };
  outputSelect.onchange = () => {
    midiOut.allOff();
    midi?.selectOutput(outputSelect.value || null);
  };
}

function applyInputChoice(midi: MidiManager | null): void {
  const useKeyboard = inputSelect.value === KEYBOARD_ID;
  if (useKeyboard) {
    midi?.selectInput(null);
    keyboardSim.start();
  } else {
    keyboardSim.stop();
    midi?.selectInput(inputSelect.value);
  }
  setKeyboardHint(useKeyboard);
  log.add(
    useKeyboard
      ? "input: computer keyboard"
      : `input: ${inputSelect.selectedOptions[0]?.textContent ?? inputSelect.value}`,
    "info",
  );
}

log.add("Piano Trainer — milestones 5+6: hand modes, auto-play, looping, settings", "info");
initMidi();

if (import.meta.env.DEV) {
  // Debug handle for poking at the score from the console.
  (window as unknown as Record<string, unknown>).__pt = {
    score,
    loop,
    getSession: () => session,
    handleEvent,
  };
}
