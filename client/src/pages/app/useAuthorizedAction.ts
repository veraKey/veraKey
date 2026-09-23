import type { ProofState } from "@verakey/sdk/client";
import { useCallback, useState } from "react";

/** Runs one proof-authorized action at a time and exposes its timeline state. */
export function useAuthorizedAction() {
  const [state, setState] = useState<ProofState>({ status: "idle" });
  const [label, setLabel] = useState<string | null>(null);
  const busy = ["authenticating", "proving", "relaying", "confirming"].includes(state.status);

  const run = useCallback(async <T,>(name: string, job: (emit: (s: ProofState) => void) => Promise<T>): Promise<T | null> => {
    setLabel(name);
    setState({ status: "idle" });
    try {
      return await job(setState);
    } catch {
      return null; // The timeline shows the rejection.
    }
  }, []);

  return { state, label, busy, run, reset: () => setState({ status: "idle" }) };
}
