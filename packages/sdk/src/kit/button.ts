import { createElement, type CSSProperties, type ReactElement } from "react";
import type { VeraKeySessionState } from "../session";
import { VERAKEY_MARK } from "./mark";

/** The line under the button after a failed sign-in, by error code; other codes, "server" among them, show the error's own message. */
const MESSAGES: Partial<Record<string, string>> = {
  blocked: "Allow pop-ups for this site, then try again.",
  unavailable: "VeraKey did not answer. This page may send Cross-Origin-Opener-Policy: same-origin.",
  network: "This site's server did not answer.",
};

export interface ButtonLook {
  theme?: "dark" | "light";
  className?: string;
  style?: CSSProperties;
}

/** A player ID short enough for a button: 0x12…ab. */
export const shortPlayerId = (id: string): string => `${id.slice(0, 4)}…${id.slice(-2)}`;

/** The Sign in with VeraKey button for one session state. */
export function signInButton(state: VeraKeySessionState, look: ButtonLook, onClick: () => void): ReactElement {
  const dark = (look.theme ?? "dark") === "dark";
  const busy = state.status === "signing-in";
  const disabled = state.status === "loading" || busy;
  const label = busy
    ? "Waiting for VeraKey…"
    : state.status === "signed-in" && state.player
      ? `${shortPlayerId(state.player.id)} · Sign out`
      : "Sign in with VeraKey";
  const message = state.status === "signed-out" && state.error ? (MESSAGES[state.error.code] ?? state.error.message) : "";
  const wrapper: CSSProperties = { display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 6 };
  const button: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
    borderRadius: 10,
    border: `1px solid ${dark ? "#27272a" : "#d4d4d8"}`,
    background: dark ? "#09090b" : "#ffffff",
    color: dark ? "#fafafa" : "#09090b",
    font: "inherit",
    fontWeight: 600,
    lineHeight: 1.2,
    cursor: disabled ? "default" : "pointer",
    opacity: state.status === "loading" ? 0.6 : 1,
    ...look.style,
  };
  const mark: CSSProperties = { display: "block", borderRadius: 4 };
  const note: CSSProperties = { fontSize: "0.85em", color: dark ? "#fca5a5" : "#b91c1c" };
  const buttonProps = {
    type: "button" as const,
    "data-testid": "verakey-sign-in",
    className: look.className,
    style: button,
    disabled,
    "aria-busy": busy || undefined,
    onClick,
  };
  const noteProps = { "data-testid": "verakey-error", role: "status", "aria-live": "polite" as const, style: note };
  return createElement(
    "span",
    { style: wrapper },
    createElement(
      "button",
      buttonProps,
      createElement("img", { src: VERAKEY_MARK, alt: "", width: 20, height: 20, style: mark }),
      createElement("span", null, label)
    ),
    createElement("span", noteProps, message)
  );
}
