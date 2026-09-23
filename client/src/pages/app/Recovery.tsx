import { changePayload } from "@verakey/sdk/action";
import { toFieldHex } from "@verakey/sdk/bytes";
import { KeyRound, LifeBuoy, ShieldAlert, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { isAddress, type Address } from "viem";
import { appByKey } from "@/lib/apps";
import { formatDuration, shortHex } from "@/lib/format";
import { trackedChanges } from "@/lib/history";
import { useVeraKey } from "@/state/VeraKeyProvider";
import { Kicker, ProofTimeline, RejectionNote, useNow } from "./components";
import { AppSwitch, PendingChanges } from "./Policy";
import { useAuthorizedAction } from "./useAuthorizedAction";

const ZERO = "0x0000000000000000000000000000000000000000";

export function Recovery() {
  const { client, accounts, refreshAccounts, refreshPasskeys, passkeys, session } = useVeraKey();
  const [appKey, setAppKey] = useState("pay");
  const app = appByKey(appKey);
  const account = accounts[app.key];
  const action = useAuthorizedAction();
  const [guardian, setGuardian] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const now = useNow(!!account?.recovery, 1000);

  /**
   * A backup passkey is a second owner. It is created (and unlocked once to learn its PRF-salted
   * nullifier) without replacing the current session; the current owner then schedules it.
   */
  const addBackup = async (existing?: (typeof passkeys)[number]) => {
    if (!client) return;
    setBackupBusy(true);
    try {
      let backupSession = null;
      if (existing) {
        backupSession = await client.authenticate(existing);
      } else {
        const created = await client.register("Backup passkey", { activate: false });
        backupSession = created.session ?? (await client.authenticate(created.passkey));
        refreshPasskeys();
      }
      if (backupSession.passkey.credentialId === session?.passkey.credentialId) {
        toast.error("Choose a different passkey than the one that is unlocked.");
        return;
      }
      const nullifier = await client.nullifier(app.appId, backupSession);
      setBackupBusy(false);
      await action.run("Add backup passkey", async emit => {
        const tracked = await client.scheduleChange(app.appId, changePayload.addOwner(toFieldHex(nullifier)), emit);
        trackedChanges.add(tracked);
        await refreshAccounts();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const recoveryLeft = account?.recovery ? Number(account.recovery.eta) - Math.floor(now / 1000) : 0;
  const others = passkeys.filter(p => p.credentialId !== session?.passkey.credentialId);

  return (
    <div className={`vk-grid-2 vk-tone-${app.tone}`}>
      <section className="vk-stack">
        <div>
          <Kicker>Recovery</Kicker>
          <h1 className="vk-title">Lose a phone.<br /><em>Keep the account.</em></h1>
          <p className="vk-lede">
            Synced passkeys (iCloud Keychain, Google Password Manager) already survive a lost device. For
            everything else, add a backup passkey as a second owner, or name a guardian who can rotate the
            owners after a delay that any owner can veto.
          </p>
        </div>
        <AppSwitch value={appKey} onChange={setAppKey} disabled={action.busy || backupBusy} />
        {!account?.deployed ? (
          <div className="vk-note">Deploy the {app.name} account from the Accounts page first.</div>
        ) : (
          <>
            <div className="vk-panel">
              <div className="vk-panel-head"><span>Owners · {app.name}</span><span>{account.ownerCount.toString()} passkey{account.ownerCount === 1n ? "" : "s"}</span></div>
              <div className="vk-panel-body vk-form">
                <p style={{ margin: 0, color: "var(--vk-muted)", fontSize: 12, lineHeight: 1.6 }}>
                  The backup gets its own nullifier in this app, so the chain cannot tell that both passkeys
                  belong to the same person across apps either.
                </p>
                <button className="vk-btn vk-btn-primary" disabled={action.busy || backupBusy} onClick={() => addBackup()}>
                  {backupBusy ? <span className="vk-spinner" /> : <UserPlus size={15} />} Create a backup passkey and add it
                </button>
                {others.map(p => (
                  <button key={p.credentialId} className="vk-btn vk-btn-ghost" disabled={action.busy || backupBusy} onClick={() => addBackup(p)}>
                    <KeyRound size={14} /> Add “{p.label}” ({p.credentialId.slice(0, 6)}) as owner
                  </button>
                ))}
              </div>
            </div>

            <div className="vk-panel">
              <div className="vk-panel-head"><span>Guardian</span><span>{account.guardian === ZERO ? "none" : shortHex(account.guardian)}</span></div>
              <div className="vk-panel-body vk-form">
                <p style={{ margin: 0, color: "var(--vk-muted)", fontSize: 12, lineHeight: 1.6 }}>
                  A guardian (a friend's wallet, a multisig, another account) can start replacing the owners.
                  The change waits {formatDuration(Number(account.recoveryDelay))}; any owner passkey can cancel
                  it. The guardian address is public, so reusing one guardian across apps links those accounts.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                  <label className="vk-field"><span>Guardian address</span><input className="vk-input is-mono" placeholder="0x…" value={guardian} onChange={e => setGuardian(e.target.value.trim())} spellCheck={false} /></label>
                  <button
                    className="vk-btn vk-btn-ghost"
                    style={{ minHeight: 44 }}
                    disabled={action.busy || !isAddress(guardian)}
                    onClick={() => action.run("Set guardian", async emit => {
                      const tracked = await client!.scheduleChange(app.appId, changePayload.setGuardian(guardian as Address), emit);
                      trackedChanges.add(tracked);
                      await refreshAccounts();
                    })}
                  >
                    <LifeBuoy size={14} /> Set
                  </button>
                </div>
              </div>
            </div>

            {account.recovery && (
              <div className="vk-panel" style={{ borderColor: "rgba(255,174,120,.5)" }}>
                <div className="vk-panel-head"><span style={{ color: "var(--vk-orange)" }}>Recovery in progress</span><span>{recoveryLeft > 0 ? formatDuration(recoveryLeft) : "ready"}</span></div>
                <div className="vk-panel-body vk-form">
                  <div className="vk-note is-error"><ShieldAlert size={15} /> The guardian is replacing every owner with {shortHex(account.recovery.nullifier, 8, 6)}. If you did not ask for this, cancel it now.</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      className="vk-btn vk-btn-primary"
                      disabled={action.busy}
                      onClick={() => action.run("Cancel recovery", async emit => {
                        await client!.cancelRecovery(app.appId, account.recovery!.nullifier, emit);
                        await refreshAccounts();
                      })}
                    >
                      Cancel with my passkey
                    </button>
                    {recoveryLeft <= 0 && (
                      <button className="vk-btn vk-btn-ghost" disabled={action.busy} onClick={async () => {
                        await client!.executeRecovery(account.address);
                        await refreshAccounts();
                      }}>
                        Complete recovery
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
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
