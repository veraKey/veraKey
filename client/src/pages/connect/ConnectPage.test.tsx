import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Connection } from "./useConnectRequest";

let connection: Connection = { status: "waiting" };
vi.mock("./useConnectRequest", () => ({ useConnectRequest: () => connection }));
vi.mock("@/state/VeraKeyProvider", () => ({
  useVeraKey: () => ({ config: null, configError: null }),
  createClient: () => null,
  proverThreads: () => 1,
}));

const { default: ConnectPage, WaitingForSite } = await import("./ConnectPage");
const testIds = (html: string) => [...html.matchAll(/data-testid="([^"]+)"/g)].map(([, id]) => id);
const reply = { sending() {}, progress() {}, result() {}, error() {} };

describe("the Sign in with VeraKey popup", () => {
  it("marks what an integration test drives with stable test ids", () => {
    connection = {
      status: "request",
      origin: "http://localhost:5273",
      request: { id: "1", method: "signIn", params: { nonce: `0x${"11".repeat(32)}` } },
      reply,
    };
    const ids = testIds(renderToStaticMarkup(<ConnectPage />));
    for (const id of ["connect-requester", "connect-create-passkey", "connect-unlock", "connect-cancel"]) expect(ids).toContain(id);
  });

  it("offers to close the window when it refuses a site's request", () => {
    connection = { status: "rejected", message: "The request is malformed." };
    const ids = testIds(renderToStaticMarkup(<ConnectPage />));
    expect(ids).toContain("connect-rejected");
    expect(ids).toContain("connect-close");
  });

  it("shows that it waits for the site, and offers to close once the site takes too long", () => {
    connection = { status: "waiting" };
    expect(testIds(renderToStaticMarkup(<ConnectPage />))).toContain("connect-waiting");
    const stalled = renderToStaticMarkup(<WaitingForSite stalled />);
    expect(testIds(stalled)).toContain("connect-close");
    expect(stalled).toMatch(/has not sent/);
    expect(testIds(renderToStaticMarkup(<WaitingForSite stalled={false} />))).not.toContain("connect-close");
  });
});
