# Piano Trainer

Sheet-music follow-along trainer: load MusicXML, play on a digital piano over USB MIDI, and the
score waits at each note/chord until you play it. See `CLAUDE.md` for architecture and decisions.

```bash
npm install
npm run dev    # open the printed URL in Chrome (Safari has no Web MIDI)
npm test
```

No piano handy? Choose "Computer keyboard (dev)" as the input: A W S E D F T G Y H U J K play
C4–C5 chromatically, Z / X shift the octave.
