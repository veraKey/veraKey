import type { ConnectHost } from "../../src/connect";
import { VERAKEY } from "./signin";

export class FakePopup {
  closed = false;
  closeCalls = 0;
  sent: { message: any; target: string }[] = [];
  postMessage(message: unknown, target: string) {
    this.sent.push({ message, target });
  }
  close() {
    this.closeCalls++;
    this.closed = true;
  }
}

/** Stands in for the site's `window`: records the popup it opens and delivers the popup's messages. */
export class FakeWindow implements ConnectHost {
  popup: FakePopup | null = new FakePopup();
  opened: { url: string; target: string }[] = [];
  private listeners = new Set<(event: MessageEvent) => void>();
  open(url: string, target: string) {
    this.opened.push({ url, target });
    return this.popup;
  }
  addEventListener(_type: "message", listener: (event: MessageEvent) => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "message", listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener);
  }
  emit(data: unknown, { origin = VERAKEY, source = this.popup as unknown } = {}) {
    for (const listener of [...this.listeners]) listener({ data, origin, source } as MessageEvent);
  }
  get request() {
    return this.popup!.sent.at(-1)?.message;
  }
}

export const tick = () => new Promise(resolve => setTimeout(resolve, 0));
