const MAX_ENTRIES = 300;

/** Scrolling event log, newest entry on top. */
export class EventLog {
  constructor(private el: HTMLElement) {}

  add(text: string, cls: "on" | "off" | "control" | "info" = "info"): void {
    const row = document.createElement("div");
    row.className = `log-row log-${cls}`;
    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = new Date().toLocaleTimeString(undefined, { hour12: false });
    const msg = document.createElement("span");
    msg.textContent = text;
    row.append(time, msg);
    this.el.prepend(row);
    while (this.el.childElementCount > MAX_ENTRIES) this.el.lastElementChild?.remove();
  }

  clear(): void {
    this.el.replaceChildren();
  }
}
