"use client";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { signInButton } from "./kit/button";
import { VeraKeySession, type VeraKeyPaymentReceipt, type VeraKeySessionError, type VeraKeySessionState } from "./session";
import type { VeraKeyPlayer } from "./signin";

/**
 * The integration kit for React: VeraKeyProvider holds one VeraKeySession for the tree below it, useVeraKey reads
 * it, and SignInWithVeraKey is the button. The server side is createVeraKeyServer from @verakey/sdk/server.
 */

const SessionContext = createContext<VeraKeySession | null>(null);
/** What a server render shows: nothing is known before the page asks its server. */
const LOADING: VeraKeySessionState = { status: "loading", player: null, paying: false, error: null };

/** One VeraKeySession for the tree below; `server` is where the kit's routes are mounted (default /api/verakey). */
export function VeraKeyProvider(props: { server?: string; children?: ReactNode }): ReactElement {
  const [session] = useState(() => new VeraKeySession({ server: props.server }));
  useEffect(() => {
    void session.load();
  }, [session]);
  return createElement(SessionContext.Provider, { value: session }, props.children);
}

export interface VeraKeyHook extends VeraKeySessionState {
  signIn(): Promise<VeraKeyPlayer | null>;
  signOut(): Promise<void>;
  pay(params: { amount: bigint }): Promise<VeraKeyPaymentReceipt | null>;
}

/** The session's state and actions, in any component below VeraKeyProvider. */
export function useVeraKey(): VeraKeyHook {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useVeraKey needs a <VeraKeyProvider> above it.");
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
  const state = useSyncExternalStore(subscribe, () => session.state, () => LOADING);
  return { ...state, signIn: () => session.signIn(), signOut: () => session.signOut(), pay: params => session.pay(params) };
}

export interface SignInWithVeraKeyProps {
  theme?: "dark" | "light";
  className?: string;
  style?: CSSProperties;
  onSignIn?: (player: VeraKeyPlayer) => void;
  onError?: (error: VeraKeySessionError) => void;
}

/** Signs the player in, shows their shortened player ID once signed in, and signs them out. */
export function SignInWithVeraKey(props: SignInWithVeraKeyProps): ReactElement {
  const verakey = useVeraKey();
  const onClick = () => {
    if (verakey.status === "signed-in") {
      verakey.signOut().catch(error => props.onError?.(error as VeraKeySessionError));
      return;
    }
    verakey.signIn().then(
      player => {
        if (player) props.onSignIn?.(player);
      },
      error => props.onError?.(error as VeraKeySessionError)
    );
  };
  return signInButton(verakey, props, onClick);
}
