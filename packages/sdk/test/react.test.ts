import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { signInButton } from "../src/kit/button";
import { VERAKEY_MARK } from "../src/kit/mark";
import { SignInWithVeraKey, VeraKeyProvider, useVeraKey } from "../src/react";
import { VeraKeySessionError, type VeraKeySessionState } from "../src/session";

const PLAYER = { id: `0x12${"00".repeat(30)}ab`, account: "0x00000000000000000000000000000000000000aa" } as const;
const state = (patch: Partial<VeraKeySessionState>): VeraKeySessionState => ({ status: "signed-out", player: null, paying: false, error: null, ...patch });
const html = (s: VeraKeySessionState, theme?: "dark" | "light") => renderToStaticMarkup(signInButton(s, { theme }, () => {}));

describe("SignInWithVeraKey's button", () => {
  it("asks to sign in, and is disabled while the session loads", () => {
    const loading = html(state({ status: "loading" }));
    expect(loading).toContain("Sign in with VeraKey");
    expect(loading).toMatch(/<button[^>]*disabled/);
    expect(html(state({}))).not.toMatch(/<button[^>]*disabled/);
  });

  it("waits for VeraKey while the player approves", () => {
    const waiting = html(state({ status: "signing-in" }));
    expect(waiting).toContain("Waiting for VeraKey…");
    expect(waiting).toMatch(/<button[^>]*disabled/);
    expect(waiting).toContain('aria-busy="true"');
  });

  it("shows the signed-in player's shortened ID and offers to sign out", () => {
    expect(html(state({ status: "signed-in", player: PLAYER }))).toContain("0x12…ab · Sign out");
  });

  it("says in one line why a sign-in failed: its own words for the browser, the server's words for the server", () => {
    expect(html(state({ error: new VeraKeySessionError("blocked", "The browser blocked the VeraKey window.") }))).toContain(
      "Allow pop-ups for this site, then try again."
    );
    expect(html(state({ error: new VeraKeySessionError("server", "Open this site at https://game.example.") }))).toContain(
      "Open this site at https://game.example."
    );
    expect(html(state({ error: new VeraKeySessionError("proof", "The proof could not be made.") }))).toContain("The proof could not be made.");
    expect(html(state({}))).toMatch(/data-testid="verakey-error"[^>]*><\/span>/);
  });

  it("carries its test ids, the embedded mark and a live region", () => {
    const markup = html(state({}));
    expect(markup).toContain('data-testid="verakey-sign-in"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain(`src="${VERAKEY_MARK}"`);
    expect(VERAKEY_MARK).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
  });

  it("has a dark and a light theme", () => {
    expect(html(state({}), "dark")).toContain("background:#09090b");
    expect(html(state({}), "light")).toContain("background:#ffffff");
  });
});

describe("VeraKeyProvider", () => {
  it("renders on a server as loading, without touching browser APIs", () => {
    const markup = renderToString(createElement(VeraKeyProvider, null, createElement(SignInWithVeraKey)));
    expect(markup).toContain("Sign in with VeraKey");
    expect(markup).toMatch(/<button[^>]*disabled/);
  });

  it("gives components the session's actions, confirmPayment among them", () => {
    let hook: ReturnType<typeof useVeraKey> | undefined;
    const Probe = () => {
      hook = useVeraKey();
      return null;
    };
    renderToString(createElement(VeraKeyProvider, null, createElement(Probe)));
    expect(hook?.status).toBe("loading");
    for (const action of ["signIn", "signOut", "pay", "confirmPayment"] as const) expect(typeof hook?.[action], action).toBe("function");
  });

  it("makes useVeraKey outside a provider say what is missing", () => {
    const Orphan = () => {
      useVeraKey();
      return null;
    };
    expect(() => renderToString(createElement(Orphan))).toThrow(/VeraKeyProvider/);
  });
});
