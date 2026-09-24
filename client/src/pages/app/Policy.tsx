import { ZERO_HASH, changePayload } from "@verakey/sdk/action";
import { ChangeKind } from "@verakey/sdk/constants";
import type { TrackedChange } from "@verakey/sdk/client";
import { CalendarClock, Lock, ReceiptText, ShieldAlert, ShieldCheck, Snowflake, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { decodeAbiParameters, isAddress, type Address } from "viem";
import { DEMO_APPS, appByKey } from "@/lib/apps";
import { formatDuration, formatUsdg, parseUsdg, shortHex } from "@/lib/format";
import { trackedChanges } from "@/lib/history";
import { useVeraKey } from "@/state/VeraKeyProvider";
import { Kicker, ProofTimeline, RejectionNote, useNow } from "./components";
import { useAuthorizedAction } from "./useAuthorizedAction";

const KIND_NAMES: Record<number, string> = {
  [ChangeKind.AddOwner]: "Add an owner",
  [ChangeKind.RemoveOwner]: "Remove an owner",
  [ChangeKind.SetLimits]: "Change the caps",
  [ChangeKind.SetRecipient]: "Change an allowed recipient",
  [ChangeKind.SetAllowlist]: "Change the allowlist setting",
  [ChangeKind.SetGuardian]: "Change the guardian",
  [ChangeKind.SetNewPayeeCap]: "Change the new-recipient cap",
  [ChangeKind.Freeze]: "Freeze all payments",
  [ChangeKind.Unfreeze]: "Unfreeze payments",
  [ChangeKind.SetPaymentSheet]: "Change the payment sheet setting",
};

export function describeChange(change: { kind: number; payload: `0x${string}` | null }): string {
  if (change.payload === null) return `${KIND_NAMES[change.kind] ?? "Unknown change"} (details not found)`;
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
    case ChangeKind.SetGuardian:
      return change.payload === ZERO_HASH ? "Remove guardian" : "Set a private guardian (commitment)";
    case ChangeKind.SetNewPayeeCap: {
      const [cap] = decodeAbiParameters([{ type: "uint256" }], change.payload);
      return `First payment to a new recipient → at most ${formatUsdg(cap)} USDG`;
    }
    case ChangeKind.Freeze:
      return "Freeze all payments";
    case ChangeKind.Unfreeze:
      return "Unfreeze payments";
    case ChangeKind.SetPaymentSheet: {
      const [required] = decodeAbiParameters([{ type: "bool" }], change.payload);
      return required ? "Require the payment sheet for payments" : "Stop requiring the payment sheet";
    }
    case ChangeKind.AddOwner:
      return `Add owner ${shortHex(change.payload, 8, 6)}`;
    case ChangeKind.RemoveOwner:
      return `Remove owner ${shortHex(change.payload, 8, 6)}`;
    default:
      return "Unknown change";
  }
}

type PendingItem = Omit<TrackedChange, "payload"> & { payload: `0x${string}` | null; fromThisBrowser: boolean };

/**
 * Scheduled changes for one account, read from the chain so that a change scheduled on another
 * device (or by someone holding an unlocked device) shows up here too, with countdowns, apply and cancel.
 */
export function PendingChanges({ appKey, action }: { appKey: string; action: ReturnType<typeof useAuthorizedAction> }) {
  const { client, accounts, refreshAccounts } = useVeraKey();
  const app = appByKey(appKey);
  const account = accounts[app.key];
  const [items, setItems] = useState<PendingItem[]>([]);
  const now = useNow(items.length > 0, 1000);

  const reload = useCallback(async () => {
    if (!client || !account?.deployed) return setItems([]);
    const onChain = await client.pendingChanges(account.address);
    const local = new Map(trackedChanges.list(account.address).map(c => [c.changeId, c]));
    for (const id of local.keys()) if (!onChain.some(c => c.changeId === id)) trackedChanges.remove(id);
    setItems(
      await Promise.all(
        onChain.map(async (c): Promise<PendingItem> => {
          const known = local.get(c.changeId);
          if (known) return { ...known, fromThisBrowser: true };
          const payload = await client.scheduledPayload(account.address, c.changeId);
          return { account: account.address, changeId: c.changeId, kind: c.kind, payload, eta: c.eta, fromThisBrowser: false };
        })
      )
    );
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
                  {!change.fromThisBrowser && (
                    <small style={{ color: "var(--vk-orange)" }}>
                      <ShieldAlert size={11} style={{ verticalAlign: "-2px" }} /> Not scheduled from this browser. Cancel it if it was not you.
                    </small>
                  )}
                </span>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {left > 0 ? (
                    <span className="vk-countdown"><CalendarClock size={12} /> {formatDuration(left)}</span>
                  ) : change.payload === null ? null : (
                    <button
                      className="vk-btn vk-btn-primary"
                      style={{ minHeight: 32 }}
                      disabled={action.busy}
                      onClick={async () => {
                        try {
                          await client!.applyChange(account.address, { ...change, payload: change.payload! });
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
  if (DEMO_APPS.length < 2) return null;
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
  const [newPayee, setNewPayee] = useState("");
  const [canUseSheet, setCanUseSheet] = useState(false);

  useEffect(() => {
    let live = true;
    client?.canConfirmPayments().then(ok => live && setCanUseSheet(ok), () => {});
    return () => {
      live = false;
    };
  }, [client, client?.session]);

  const schedule = (name: string, change: { kind: ChangeKind; payload: `0x${string}` }) =>
    action.run(name, async emit => {
      const tracked = await client!.scheduleChange(app.appId, change, emit);
      trackedChanges.add(tracked);
      await refreshAccounts();
    });
  /** Tightening applies at once (`restrict`); the account refuses anything that loosens it. */
  const restrict = (name: string, change: { kind: ChangeKind; payload: `0x${string}` }) =>
    action.run(name, async emit => {
      await client!.restrict(app.appId, change, emit);
      toast.success(`${name}: applied now`);
      await refreshAccounts();
    });
  const tightenOrSchedule = (name: string, change: { kind: ChangeKind; payload: `0x${string}` }, tightens: boolean) =>
    tightens ? restrict(name, change) : schedule(name, change);

  const spentPct = account?.deployed && account.dailyCap > 0n ? Number((account.spentToday * 1000n) / account.dailyCap) / 10 : 0;
  const perTxUnits = parseUsdg(perTx);
  const dailyUnits = parseUsdg(daily);
  const newPayeeUnits = parseUsdg(newPayee);
  const capsTighten = !!account?.deployed && perTxUnits !== null && dailyUnits !== null && perTxUnits <= account.perTxCap && dailyUnits <= account.dailyCap;
  const newPayeeTightens = !!account?.deployed && newPayeeUnits !== null && newPayeeUnits <= account.newPayeeCap;

  return (
    <div className={`vk-grid-2 vk-tone-${app.tone}`}>
      <section className="vk-stack">
        <div>
          <Kicker>Spending policy</Kicker>
          <h1 className="vk-title">Authentication<br /><em>is not authorization.</em></h1>
          <p className="vk-lede">
            A valid proof only says "an owner's passkey approved this". The account's own rules decide
            whether it may happen. Tightening applies at once; loosening (raising a limit, adding an owner,
            unfreezing) waits for the timelock, so a stolen, unlocked phone cannot quietly lift the caps.
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
                <div style={{ display: "grid", gap: 8, width: "100%" }}>
                  <span style={{ display: "flex", justifyContent: "space-between", color: "var(--vk-muted)" }}>
                    <span>Spent today</span><span className="vk-mono" style={{ color: "var(--vk-ink)" }}>{formatUsdg(account.spentToday)}</span>
                  </span>
                  <span className="vk-bar"><i style={{ width: `${Math.min(spentPct, 100)}%` }} /></span>
                </div>
                <div><span>Recipients</span><span className="vk-mono">{account.allowlistEnabled ? "allowlist only" : "anyone"}</span></div>
                <div><span>First payment to a new recipient</span><span className="vk-mono">at most {formatUsdg(account.newPayeeCap)} USDG</span></div>
                <div><span>Payment sheet</span><span className="vk-mono">{account.paymentSheetRequired ? "required" : "optional"}</span></div>
                <div><span>Payments</span><span className="vk-mono" style={{ color: account.frozen ? "var(--vk-orange)" : undefined }}>{account.frozen ? "frozen" : "active"}</span></div>
              </div>
            </div>

            <div className="vk-panel" style={account.frozen ? { borderColor: "rgba(255,174,120,.5)" } : undefined}>
              <div className="vk-panel-head"><span>Emergency</span><span>{account.frozen ? "frozen" : "applies at once"}</span></div>
              <div className="vk-panel-body vk-form">
                <p style={{ margin: 0, color: "var(--vk-muted)", fontSize: 12, lineHeight: 1.6 }}>
                  Lost a device, or saw a payment you did not make? Freezing stops every payment immediately and
                  cancels every scheduled change; your guardian can freeze too. Unfreezing is a timelocked change
                  that you or the guardian can cancel.
                </p>
                {account.frozen ? (
                  <button className="vk-btn vk-btn-ghost" disabled={action.busy} onClick={() => schedule("Unfreeze", changePayload.unfreeze())}>
                    <Lock size={14} /> Schedule unfreeze ({formatDuration(Number(account.changeDelay))})
                  </button>
                ) : (
                  <button className="vk-btn vk-btn-primary" disabled={action.busy} onClick={() => restrict("Freeze payments", changePayload.freeze())}>
                    <Snowflake size={14} /> Freeze payments now
                  </button>
                )}
              </div>
            </div>

            <div className="vk-panel">
              <div className="vk-panel-head"><span>Payment sheet</span><span>{account.paymentSheetRequired ? "required" : "optional"}</span></div>
              <div className="vk-panel-body vk-form">
                <p style={{ margin: 0, color: "var(--vk-muted)", fontSize: 12, lineHeight: 1.6 }}>
                  Require every payment to be confirmed in the browser's own payment sheet, which shows the payee and
                  the total. The account then refuses payments approved through the ordinary passkey prompt, so a
                  tampered page cannot pay without the browser showing you what you pay. Only in Chrome on macOS,
                  Windows and Android, with a passkey enrolled for it in this browser.
                </p>
                {account.paymentSheetRequired ? (
                  <button className="vk-btn vk-btn-ghost" disabled={action.busy} onClick={() => schedule("Stop requiring the payment sheet", changePayload.setPaymentSheet(false))}>
                    <ReceiptText size={14} /> Stop requiring it ({formatDuration(Number(account.changeDelay))})
                  </button>
                ) : (
                  <button className="vk-btn vk-btn-ghost" disabled={action.busy || !canUseSheet} onClick={() => restrict("Require the payment sheet", changePayload.setPaymentSheet(true))}>
                    <ReceiptText size={14} /> {canUseSheet ? "Require the payment sheet now" : "Not available in this browser"}
                  </button>
                )}
              </div>
            </div>

            <div className="vk-panel">
              <div className="vk-panel-head"><span>Change the policy</span><span>tighter: at once · looser: timelocked</span></div>
              <div className="vk-panel-body vk-form">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
                  <label className="vk-field"><span>Per payment</span><input className="vk-input" inputMode="decimal" placeholder={formatUsdg(account.perTxCap)} value={perTx} onChange={e => setPerTx(e.target.value)} /></label>
                  <label className="vk-field"><span>Per day</span><input className="vk-input" inputMode="decimal" placeholder={formatUsdg(account.dailyCap)} value={daily} onChange={e => setDaily(e.target.value)} /></label>
                  <button
                    className="vk-btn vk-btn-primary"
                    style={{ minHeight: 44 }}
                    disabled={action.busy || !perTxUnits || !dailyUnits || perTxUnits > dailyUnits}
                    onClick={() => tightenOrSchedule("Set caps", changePayload.setLimits(perTxUnits!, dailyUnits!), capsTighten)}
                  >
                    {perTxUnits && dailyUnits && capsTighten ? "Lower now" : "Set caps"}
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                  <label className="vk-field"><span>First payment to a new recipient, at most</span><input className="vk-input" inputMode="decimal" placeholder={formatUsdg(account.newPayeeCap)} value={newPayee} onChange={e => setNewPayee(e.target.value)} /></label>
                  <button
                    className="vk-btn vk-btn-ghost"
                    style={{ minHeight: 44 }}
                    disabled={action.busy || newPayeeUnits === null}
                    onClick={() => tightenOrSchedule("Set new-recipient cap", changePayload.setNewPayeeCap(newPayeeUnits!), newPayeeTightens)}
                  >
                    {newPayeeUnits !== null && newPayeeTightens ? "Lower now" : "Set"}
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
                  onClick={() =>
                    account.allowlistEnabled
                      ? schedule("Allow any recipient", changePayload.setAllowlist(false))
                      : restrict("Require allowlist", changePayload.setAllowlist(true))
                  }
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
