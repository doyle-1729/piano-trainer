import { describe, expect, it } from "vitest";
import { noteName, parseMidiMessage, SUSTAIN_PEDAL } from "../src/midi/events";

describe("parseMidiMessage", () => {
  it("parses note-on", () => {
    expect(parseMidiMessage([0x90, 60, 100])).toEqual({
      kind: "noteOn", note: 60, velocity: 100, channel: 1,
    });
  });

  it("treats note-on with velocity 0 as note-off", () => {
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({ kind: "noteOff", note: 60, channel: 1 });
  });

  it("parses note-off", () => {
    expect(parseMidiMessage([0x80, 21, 64])).toEqual({ kind: "noteOff", note: 21, channel: 1 });
  });

  it("reads the channel from the status byte", () => {
    expect(parseMidiMessage([0x91, 60, 1])).toMatchObject({ channel: 2 });
    expect(parseMidiMessage([0x8f, 60, 0])).toMatchObject({ channel: 16 });
  });

  it("parses sustain pedal CC64", () => {
    expect(parseMidiMessage([0xb0, SUSTAIN_PEDAL, 127])).toEqual({
      kind: "control", controller: 64, value: 127, channel: 1,
    });
  });

  it("ignores short, running-status and unmodelled messages", () => {
    expect(parseMidiMessage([0xf8])).toBeNull(); // clock
    expect(parseMidiMessage([60, 100, 0])).toBeNull(); // no status byte
    expect(parseMidiMessage([0xa0, 60, 50])).toBeNull(); // aftertouch
  });
});

describe("noteName", () => {
  it("names the piano range", () => {
    expect(noteName(21)).toBe("A0");
    expect(noteName(60)).toBe("C4");
    expect(noteName(61)).toBe("C#4");
    expect(noteName(69)).toBe("A4");
    expect(noteName(108)).toBe("C8");
  });
});
