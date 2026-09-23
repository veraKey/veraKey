import { changePayload } from "@verakey/sdk/action";
import { ChangeKind } from "@verakey/sdk/constants";
import type { TrackedChange } from "@verakey/sdk/client";
import { CalendarClock, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { decodeAbiParameters, isAddress, type Address } from "viem";
import { DEMO_APPS, appByKey } from "@/lib/apps";
import { formatDuration, formatUsdg, parseUsdg, shortHex } from "@/lib/format";
import { trackedChanges } from "@/lib/history";
import { useVeraKey } from "@/state/VeraKeyProvider";
import { Kicker, ProofTimeline, RejectionNote, useNow } from "./components";
import { useAuthorizedAction } from "./useAuthorizedAction";

export function describeChange(change: Pick<TrackedChange, "kind" | "payload">): string {
  switch (change.kind) {
    case ChangeKind.SetLimits: {
      const [perTx, daily] = decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], change.payload);
      return `Caps → ${formatUsdg(perTx)} per payment, ${formatUsdg(daily)} per day`;
    }
    case ChangeKind.SetRecipient: {
      const [recipient, allowed] = decodeAbiParameters([{ type: "address" }, { type: "bool" }], change.payload);
      return `${allowed ? "Allow" : "Remove"} recipient ${shortHex(recipient)}`;
    }
    case ChangeKind.SetAllowlist: {
      const [enabled] = decodeAbiParameters([{ type: "bool" }], change.payload);
      return enabled ? "Only pay allowlisted recipients" : "Pay any recipient";
    }
    case ChangeKind.SetGuardian: {
      const [guardian] = decodeAbiParameters([{ type: "address" }], change.payload);
      return guardian === "0x0000000000000000000000000000000000000000" ? "Remove guardian" : `Guardian → ${shortHex(guardian)}`;
    }
    case ChangeKind.AddOwner:
      return `Add owner ${shortHex(change.payload, 8, 6)}`;
    case ChangeKind.RemoveOwner:
      return `Remove owner ${shortHex(change.payload, 8, 6)}`;
    default:
      return "Unknown change";
  }
}

/** Scheduled changes for one account, with countdowns, apply and cancel. */
export function PendingChanges({ appKey, action }: { appKey: string; action: ReturnType<typeof useAuthorizedAction> }) {
  const { client, accounts, refreshAccounts } = useVeraKey();
  const app = appByKey(appKey);
  const account = accounts[app.key];
  const [items, setItems] = useState<TrackedChange[]>([]);
  const now = useNow(items.length > 0, 1000);

  const reload = useCallback(async () => {
    if (!client || !account?.deployed) return setItems([]);
    const tracked = trackedChanges.list(account.address);
    const live = await Promise.all(tracked.map(async c => ((await client.isPending(account.address, c.changeId)) ? c : null)));
    tracked.filter((_, i) => !live[i]).forEach(c => trackedChanges.remove(c.changeId));
    setItems(live.filter((c): c is TrackedChange => c !== null));
  }, [client, account?.address, account?.deployed]);

  useEffect(() => {
    reload();
  }, [reload, action.state.status]);

  if (!account?.deployed) return null;
  return (
    <div className="vk-panel">
      <div className="vk-panel-head"><span>Scheduled changes</span><span>timelock {formatDuration(Number(account.changeDelay))}</span></div>
      <div className="vk-panel-body" style={{ paddingTop: 6 }}>
        {items.length === 0 ? (
          <p style={{ margin: "10px 0 0", color: "var(--vk-muted)", fontSize: 12 }}>Nothing scheduled.</p>
        ) : (
          items.map(change => {
            const left = change.eta - Math.floor(now / 1000);
            return (
              <div className="vk-change" key={change.changeId}>
                <span>
                  {describeChange(change)}
                  <small>{shortHex(change.changeId, 10, 6)}</small>
                </span>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {left > 0 ? (
                    <span className="vk-countdown"><CalendarClock size={12} /> {formatDuration(left)}</span>
                  ) : (
                    <button
                      className="vk-btn vk-btn-primary"
                      style={{ minHeight: 32 }}
                      disabled={action.busy}
                      onClick={async () => {
                        try {
                          await client!.applyChange(account.address, change);
                          trackedChanges.remove(change.changeId);
                          toast.success("Change applied");
                          await refreshAccounts();
                          reload();
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : String(error));
                        }
                      }}
                    >
                      Apply
                    </button>
                  )}
                  <button
                    className="vk-btn vk-btn-ghost"
                    style={{ minHeight: 32 }}
                    disabled={action.busy}
                    title="Cancel with a passkey proof"
                    onClick={() =>
                      action.run("Cancel change", async emit => {
                        await client!.cancelChange(app.appId, change.changeId, emit);
                        trackedChanges.remove(change.changeId);
                        await refreshAccounts();
                      })
                    }
                  >
                    <X size={13} />
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function AppSwitch({ value, onChange, disabled }: { value: string; onChange: (key: string) => void; disabled?: boolean }) {
  return (
    <div className="vk-seg">
      {DEMO_APPS.map(a => (
        <button key={a.key} className={a.key === value ? "is-active" : ""} onClick={() => onChange(a.key)} disabled={disabled}>
          {a.name}
        </button>
      ))}
    </div>
  );
}

export function Policy() {
  const { client, accounts, refreshAccounts } = useVeraKey();
  const [appKey, setAppKey] = useState("pay");
  const app = appByKey(appKey);
  const account = accounts[app.key];
  const action = useAuthorizedAction();
  const [perTx, setPerTx] = useState("");
  const [daily, setDaily] = useState("");
  const [recipient, setRecipient] = useState("");

  const schedule = (name: string, change: { kind: ChangeKind; payload: `0x${string}` }) =>
    action.run(name, async emit => {
      const tracked = await client!.scheduleChange(app.appId, change, emit);
      trackedChanges.add(tracked);
      await refreshAccounts();
    });

  const spentPct = account?.deployed && account.dailyCap > 0n ? Number((account.spentToday * 1000n) / account.dailyCap) / 10 : 0;
  const perTxUnits = parseUsdg(perTx);
  const dailyUnits = parseUsdg(daily);

  return (
    <div className={`vk-grid-2 vk-tone-${app.tone}`}>
      <section className="vk-stack">
        <div>
          <Kicker>Spending policy</Kicker>
          <h1 className="vk-title">Authentication<br /><em>is not authorization.</em></h1>
          <p className="vk-lede">
            A valid proof only says "an owner's passkey approved this". The account's own rules decide
            whether it may happen. Raising a limit or adding an owner is timelocked, so a stolen, unlocked
            phone cannot quietly lift the caps and drain the account.
          </p>
        </div>
        <AppSwitch value={appKey} onChange={setAppKey} disabled={action.busy} />
        {!account?.deployed ? (
          <div className="vk-note">Deploy the {app.name} account from the Accounts page first.</div>
        ) : (
          <>
            <div className="vk-panel">
              <div className="vk-panel-head"><span>Current policy · {app.name}</span><span>enforced on-chain</span></div>
              <div className="vk-panel-body vk-quote" style={{ paddingTop: 4 }}>
                <div><span>Per-payment cap</span><span className="vk-mono">{formatUsdg(account.perTxCap)} USDG</span></div>
                <div><span>Daily cap</span><span className="vk-mono">{formatUsdg(account.dailyCap)} USDG</span></div>
                <div style={{ display: "grid", gap: 8 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", color: "var(--vk-muted)" }}>
                    <span>Spent today</span><span className="vk-mono" style={{ color: "var(--vk-ink)" }}>{formatUsdg(account.spentToday)}</span>
                  </span>
                  <span className="vk-bar"><i style={{ width: `${Math.min(spentPct, 100)}%` }} /></span>
                </div>
                <div><span>Recipients</span><span className="vk-mono">{account.allowlistEnabled ? "allowlist only" : "anyone"}</span></div>
              </div>
            </div>

            <div className="vk-panel">
              <div className="vk-panel-head"><span>Schedule a change</span><span>one passkey approval each</span></div>
              <div className="vk-panel-body vk-form">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
                  <label className="vk-field"><span>Per payment</span><input className="vk-input" inputMode="decimal" placeholder={formatUsdg(account.perTxCap)} value={perTx} onChange={e => setPerTx(e.target.value)} /></label>
                  <label className="vk-field"><span>Per day</span><input className="vk-input" inputMode="decimal" placeholder={formatUsdg(account.dailyCap)} value={daily} onChange={e => setDaily(e.target.value)} /></label>
                  <button
                    className="vk-btn vk-btn-primary"
                    style={{ minHeight: 44 }}
                    disabled={action.busy || !perTxUnits || !dailyUnits || perTxUnits > dailyUnits}
                    onClick={() => schedule("Set caps", changePayload.setLimits(perTxUnits!, dailyUnits!))}
                  >
                    Set caps
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                  <label className="vk-field"><span>Allow a recipient</span><input className="vk-input is-mono" placeholder="0x…" value={recipient} onChange={e => setRecipient(e.target.value.trim())} spellCheck={false} /></label>
                  <button
                    className="vk-btn vk-btn-ghost"
                    style={{ minHeight: 44 }}
                    disabled={action.busy || !isAddress(recipient)}
                    onClick={() => schedule("Allow recipient", changePayload.setRecipient(recipient as Address, true))}
                  >
                    Allow
                  </button>
                </div>
                <button
                  className="vk-btn vk-btn-ghost"
                  disabled={action.busy}
                  onClick={() => schedule(account.allowlistEnabled ? "Allow any recipient" : "Require allowlist", changePayload.setAllowlist(!account.allowlistEnabled))}
                >
                  <ShieldCheck size={14} /> {account.allowlistEnabled ? "Allow payments to anyone" : "Only pay allowlisted recipients"}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="vk-stack" style={{ position: "sticky", top: 98 }}>
        <PendingChanges appKey={appKey} action={action} />
        {action.state.status !== "idle" && (
          <div className="vk-panel">
            <div className="vk-panel-head"><span>{action.label}</span><span>{action.state.status}</span></div>
            <div className="vk-panel-body">
              <ProofTimeline state={action.state} />
              {action.state.status === "rejected" && <div style={{ marginTop: 14 }}><RejectionNote state={action.state} /></div>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
