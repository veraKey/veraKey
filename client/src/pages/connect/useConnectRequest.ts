import { acceptRequest, envelope, type ConnectErrorCode, type ConnectRequest } from "@verakey/sdk/connect";
import type { PaymentResult, SignInResult } from "@verakey/sdk/signin";
import { useEffect, useState } from "react";
import type { Hex } from "viem";

export interface ConnectReply {
  progress(hash: Hex): void;
  result(value: SignInResult | PaymentResult): void;
  error(code: ConnectErrorCode, message: string, revert?: string): void;
}

export type Connection =
  | { status: "no-opener" }
  | { status: "waiting" }
  | { status: "rejected"; message: string }
  | { status: "request"; origin: string; request: ConnectRequest; reply: ConnectReply };

/**
 * The popup's side of "Sign in with VeraKey": announces itself to the window that opened it, takes one request
 * from it (the browser names its origin), and answers only that window, once.
 */
export function useConnectRequest(): Connection {
  const [connection, setConnection] = useState<Connection>(() => (window.opener ? { status: "waiting" } : { status: "no-opener" }));
  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) return;
    let handled = false;
    const onMessage = (event: MessageEvent) => {
      const verdict = acceptRequest({ source: event.source, origin: event.origin, data: event.data }, { opener, handled });
      if (verdict.kind === "ignore") return;
      if (verdict.kind === "reject") {
        opener.postMessage(envelope({ type: "error", id: verdict.id, code: verdict.code, message: verdict.message }), verdict.origin);
        if (!handled) setConnection({ status: "rejected", message: verdict.message });
        return;
      }
      handled = true;
      const { origin, request } = verdict;
      let answered = false;
      const post = (body: object, final: boolean) => {
        if (answered) return;
        if (final) answered = true;
        opener.postMessage(envelope({ ...body, id: request.id }), origin);
      };
      setConnection({
        status: "request",
        origin,
        request,
        reply: {
          progress: hash => post({ type: "progress", stage: "submitted", hash }, false),
          result: value => post({ type: "result", result: value }, true),
          error: (code, message, revert) => post({ type: "error", code, message, revert }, true),
        },
      });
    };
    window.addEventListener("message", onMessage);
    opener.postMessage(envelope({ type: "ready" }), "*");
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return connection;
}
