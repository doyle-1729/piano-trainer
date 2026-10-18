const LOWEST = 21; // A0
const HIGHEST = 108; // C8
const BLACK = new Set([1, 3, 6, 8, 10]);
const WHITE_COUNT = 52;

/**
 * On-screen 88-key strip (debug aid): shows pressed keys, the keys the
 * current step is waiting for, and flashes wrong presses red.
 */
export class KeyStrip {
  private keys = new Map<number, HTMLElement>();
  private expected = new Set<number>();
  private wrongTimers = new Map<number, number>();

  constructor(el: HTMLElement) {
    el.classList.add("keystrip");
    const whiteWidth = 100 / WHITE_COUNT;
    let whites = 0;
    for (let midi = LOWEST; midi <= HIGHEST; midi++) {
      const key = document.createElement("div");
      const isBlack = BLACK.has(midi % 12);
      key.className = isBlack ? "key black" : "key white";
      if (isBlack) {
        key.style.left = `${whites * whiteWidth - whiteWidth * 0.3}%`;
        key.style.width = `${whiteWidth * 0.6}%`;
      } else {
        key.style.left = `${whites * whiteWidth}%`;
        key.style.width = `${whiteWidth}%`;
        whites++;
      }
      this.keys.set(midi, key);
      el.appendChild(key);
    }
  }

  setPressed(midi: number, on: boolean): void {
    this.keys.get(midi)?.classList.toggle("pressed", on);
  }

  setExpected(midis: number[]): void {
    for (const midi of this.expected) this.keys.get(midi)?.classList.remove("expected");
    this.expected = new Set(midis);
    for (const midi of this.expected) this.keys.get(midi)?.classList.add("expected");
  }

  flashWrong(midi: number): void {
    const key = this.keys.get(midi);
    if (!key) return;
    key.classList.add("wrong");
    clearTimeout(this.wrongTimers.get(midi));
    this.wrongTimers.set(
      midi,
      window.setTimeout(() => {
        key.classList.remove("wrong");
        this.wrongTimers.delete(midi);
      }, 600),
    );
  }

  clear(): void {
    for (const key of this.keys.values()) key.classList.remove("pressed", "expected", "wrong");
    this.expected.clear();
  }
}
