import { parseMidiMessage, type MidiEvent } from "./events";

/**
 * Web MIDI device management: enumerate inputs/outputs, let the user pick,
 * remember the choice, survive hot-plugging. Nothing here ever echoes input
 * to an output — outputs are only written to by explicit callers (auto-play,
 * demo playback in later milestones).
 */

const INPUT_KEY = "pianoTrainer.midiInput";
const OUTPUT_KEY = "pianoTrainer.midiOutput";

export type DeviceInfo = { id: string; name: string };

export function isWebMidiSupported(): boolean {
  return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
}

export class MidiManager {
  private access: MIDIAccess;
  private selectedInput: MIDIInput | null = null;
  private selectedOutput: MIDIOutput | null = null;
  private eventListeners = new Set<(e: MidiEvent) => void>();
  private deviceListeners = new Set<() => void>();
  private messageHandler = (e: Event) => {
    const data = (e as MIDIMessageEvent).data;
    if (!data) return;
    const parsed = parseMidiMessage(data);
    if (parsed) for (const l of this.eventListeners) l(parsed);
  };

  private constructor(access: MIDIAccess) {
    this.access = access;
    this.access.onstatechange = () => {
      this.reselectFromStorage();
      for (const l of this.deviceListeners) l();
    };
  }

  static async create(): Promise<MidiManager> {
    const access = await navigator.requestMIDIAccess({ sysex: false });
    const mgr = new MidiManager(access);
    mgr.reselectFromStorage();
    return mgr;
  }

  listInputs(): DeviceInfo[] {
    return [...this.access.inputs.values()].map((i) => ({ id: i.id, name: i.name ?? i.id }));
  }

  listOutputs(): DeviceInfo[] {
    return [...this.access.outputs.values()].map((o) => ({ id: o.id, name: o.name ?? o.id }));
  }

  get inputId(): string | null {
    return this.selectedInput?.id ?? null;
  }

  get outputId(): string | null {
    return this.selectedOutput?.id ?? null;
  }

  get outputPort(): MIDIOutput | null {
    return this.selectedOutput;
  }

  selectInput(id: string | null): void {
    if (this.selectedInput) this.selectedInput.removeEventListener("midimessage", this.messageHandler);
    this.selectedInput = (id && this.access.inputs.get(id)) || null;
    if (this.selectedInput) this.selectedInput.addEventListener("midimessage", this.messageHandler);
    localStorage.setItem(INPUT_KEY, id ?? "");
  }

  selectOutput(id: string | null): void {
    this.selectedOutput = (id && this.access.outputs.get(id)) || null;
    localStorage.setItem(OUTPUT_KEY, id ?? "");
  }

  /** Parsed events from the currently selected input. Returns an unsubscribe. */
  onEvent(listener: (e: MidiEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Fires when devices are plugged in or removed. Returns an unsubscribe. */
  onDevicesChanged(listener: () => void): () => void {
    this.deviceListeners.add(listener);
    return () => this.deviceListeners.delete(listener);
  }

  /**
   * Apply the remembered choice: keep the current selection if it still
   * exists, otherwise the stored device if present, otherwise the first one.
   */
  private reselectFromStorage(): void {
    if (!this.selectedInput || !this.access.inputs.get(this.selectedInput.id)) {
      const stored = localStorage.getItem(INPUT_KEY);
      const inputs = this.listInputs();
      const pick = inputs.find((i) => i.id === stored) ?? inputs[0];
      this.selectInput(pick?.id ?? null);
    }
    if (!this.selectedOutput || !this.access.outputs.get(this.selectedOutput.id)) {
      const stored = localStorage.getItem(OUTPUT_KEY);
      const outputs = this.listOutputs();
      const pick = outputs.find((o) => o.id === stored) ?? outputs[0];
      this.selectOutput(pick?.id ?? null);
    }
  }
}
