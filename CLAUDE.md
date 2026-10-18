# Piano Trainer

Browser app that renders real engraved sheet music (MusicXML) and follows along as the user
plays a Yamaha Clavinova CLP-875 over USB MIDI — flowkey-style "wait mode": the score waits at
each note/chord until the correct keys are played, then advances. Proper notation only, no
falling notes.

## Commands

```bash
npm run dev        # Vite dev server — open in Chrome (Safari has no Web MIDI)
npm test           # Vitest unit tests
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build
```

## Architecture

```
src/midi/      events.ts: pure MIDI event types + parsing (no Web MIDI imports)
               devices.ts: Web MIDI access, device list/choice/persistence (localStorage)
src/input/     keyboardSim.ts: computer keyboard simulates MIDI (dev fallback)
src/engine/    (milestone 3) pure follow engine: steps, matching, hand filter — no DOM/OSMD/MIDI
src/score/     (milestone 2) OSMD wrapper: load/render MusicXML, cursor, note colouring, timeline extraction
src/ui/        DOM wiring, control bar, event log
tests/         Vitest; engine and parsing are tested with fixtures + synthetic events
public/scores/ fixture MusicXML files
```

Layering rule: `src/engine/` and `src/midi/events.ts` are pure TypeScript — no DOM, OSMD or
Web MIDI imports — so the follow logic is unit-testable with fixture scores and synthetic
MIDI events.

## Decisions (from the project spec)

- **MIDI-only MVP.** Input is Web MIDI; MusicXML (`.musicxml`/`.xml`/`.mxl`) only, no MIDI-file
  import, no microphone.
- **Device choice, not hard-coded names.** List inputs/outputs, let the user pick, persist in
  localStorage. Survive hot-plug via `statechange`.
- **Note-on velocity 0 = note-off** (the CLP sends these). Piano transmits on channel 1; don't
  depend on channel. Sustain (CC64) is ignored for matching but must not break anything.
- **Never echo input to MIDI output.** The user keeps Local Control on; the CLP's own engine
  sounds their playing. The app writes to MIDI out only for demo playback / auto-playing the
  non-practised hand (milestone 5). WebAudio synthesis is a nice-to-have fallback only.
- **Steps**: a step = set of expected MIDI pitches at one onset, tagged by hand, linked to the
  score position. Chord tolerance window default 150 ms (configurable); notes need not be held
  simultaneously at the end.
- **Ties**: continuations are not new steps (no re-press). **Rests**: auto-skip.
  **Grace notes**: skipped by default (setting later). **Repeats/voltas**: follow OSMD cursor
  playback order if reliable, else document limitation and fall back to linear.
- **Sounding pitch** from OSMD note data (handles transposition/clefs), never naive conversion.
- **Hands**: staff 1 = right, staff 2 = left; picker when a score has ≠2 staves. Modes: right /
  left / both; single-hand mode can auto-play the other hand to the CLP.
- **Wrong notes** flash red and don't advance (strict mode later).
- When OSMD's API is unclear, check its docs/source rather than guessing; surface limitations
  instead of silently working around them.

## Milestones (stop after each for user testing)

1. ✅ Scaffold; detect Web MIDI; list devices; log incoming notes. (Keyboard sim included early
   as the dev fallback.)
2. ✅ Load/render MusicXML with OSMD (file picker, drag-drop, `.mxl` via Blob); step cursor
   with ← / → / Home. OSMD's `load()` auto-detects compressed `.mxl` from a Blob.
3. ✅ Follow engine (pure module + tests): `src/engine/timeline.ts` (RawStep → Step, hand
   tagging, tie/grace/rest handling) + `src/engine/follow.ts` (FollowSession: chord window,
   wrong notes, hand modes, auto-steps). 31 tests. Fixture scores: c-major-scale,
   two-hands-chords, ties-two-staves, warmup-repeats.
4. ✅ Wait mode end-to-end: `src/score/extract.ts` (OSMD Note → RawNote, sounding pitch via
   halfTone + 12 + PlaybackTranspose), `ScoreView.readSteps()` walks the cursor to extract the
   timeline, wrong notes flash the cursor red and show the offending note's name in a red
   header chip, Home restarts, ← / → seek the session. User preference: no green colouring of
   played notes (was implemented via `GraphicalNote.setColor()`, removed on request — that API
   works without re-rendering if per-note colouring is ever wanted again).
5. ✅ Hand modes (Both/Right/Left in control bar) + auto-play of the inactive hand via
   `src/midi/output.ts` (MidiOut — the only writer to MIDI out, never fed from input).
   Durations come from note Length × score tempo (`DefaultStartTempoInBpm`, fallback 100).
6. ✅ Looping (click a measure for start, another for end; L toggles, Esc clears; overlay via
   `GraphicalMeasure.PositionAndShape`, px = units × 10 × zoom), settings panel (chord window,
   zoom, key strip toggle; persisted in localStorage `pianoTrainer.settings`), on-screen
   88-key strip (`src/ui/keys.ts`: pressed/expected/wrong). `window.__pt` is a DEV-only debug
   handle.

## Environment notes

- User's Mac: Apple Silicon, conda base env active, **no Homebrew**. Node v25 is at
  `/usr/local/bin/node`.
- Related prior prototype at `~/scorefollow` (mic-oriented architecture; superseded by this
  fresh MIDI-first build, but its OSMD timeline/matcher code is a useful reference).
- **CLP-875 connected (2026-10-18).** USB-B-to-C data cable from the piano's square
  USB TO HOST socket to the MacBook's **top-right USB-C port** (the only working one —
  the others still don't enumerate anything; an SMC reset may fix them). Enumerates as
  "Clavinova" (Yamaha, vendor 0x0499, product 0x171f, USB Full Speed); the app lists and
  auto-selects it as both MIDI input and output. Verify with:
  `system_profiler SPUSBDataType | grep -iA6 yamaha`.
- The dev server runs on **port 5174** when the user's winemaking game (`~/winemaking-game`)
  is occupying 5173.
