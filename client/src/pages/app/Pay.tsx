import type { ProofState } from "@verakey/sdk/client";
import { useEffect, useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { useSearch } from "wouter";
import { COMPACT_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { appByKey } from "@/lib/apps";
import { formatUsdg, parseUsdg, shortHex } from "@/lib/format";
import { activity } from "@/lib/history";
import { useVeraKey } from "@/state/VeraKeyProvider";
import type { ReceiptData } from "./components";
import { PROOF_BYTES, PayDesktop, PayMobile, type PayViewProps } from "./PayView";

export function Pay() {
  const { client, config, accounts, refreshAccounts, session } = useVeraKey();
  const search = useSearch();
  const app = appByKey(new URLSearchParams(search).get("from") ?? undefined);
  const account = accounts[app.key];
  const merchant = config?.relayer.address as Address | undefined;
  const [recipient, setRecipient] = useState<string>("");
  const [amount, setAmount] = useState("2");
  const [state, setState] = useState<ProofState>({ status: "idle" });
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const compact = useMediaQuery(COMPACT_QUERY);
  const [sheetAvailable, setSheetAvailable] = useState(false);
  const [useSheet, setUseSheet] = useState(true);
  useEffect(() => {
    let live = true;
    client?.canConfirmPayments().then(ok => live && setSheetAvailable(ok));
    return () => {
      live = false;
    };
  }, [client, session]);

  const sheetRequired = !!account?.deployed && account.paymentSheetRequired;
  const to = (recipient || merchant || "") as Address;
  const units = parseUsdg(amount);
  const fee = config ? BigInt(config.relayer.fee) : 0n;
  const remainingToday = account && account.deployed ? account.dailyCap - account.spentToday : null;
  const perTxCap = account?.deployed ? account.perTxCap : config ? BigInt(config.policy.perTxCap) : 0n;

  const problem = useMemo(() => {
    if (!isAddress(to)) return "Enter a valid recipient address.";
    if (units === null || units === 0n) return "Enter an amount.";
    if (!account) return "Loading this account's balance…";
    if (sheetRequired && !sheetAvailable) {
      return "This account only pays through the browser's payment sheet, which is not available here (Chrome on macOS, Windows or Android, with this passkey enrolled for it).";
    }
    // Above the cap the contract refuses before it looks at the balance, which is the point of the
    // "try over the cap" demo; within the cap, an unaffordable payment is blocked here.
    if (units + fee > account.balance && units + fee <= perTxCap) return "Not enough USDG in this account (amount + relayer fee).";
    return null;
  }, [to, units, fee, account, perTxCap, sheetRequired, sheetAvailable]);
  const overCap = units !== null && units + fee > perTxCap;

  const submit = async () => {
    if (!client || !config || units === null || problem) return;
    setReceipt(null);
    try {
      let verified: Extract<ProofState, { status: "verified" }> | null = null;
      const tx = await client.pay(
        app.appId,
        to,
        units,
        next => {
          setState(next);
          if (next.status === "verified") verified = next;
        },
        { secureConfirmation: sheetRequired || (sheetAvailable && useSheet) }
      );
      const final = verified as Extract<ProofState, { status: "verified" }> | null;
      if (!final) return;
      setReceipt({
        title: `Paid ${formatUsdg(units)} USDG`,
        hash: tx.transactionHash,
        gasUsed: tx.gasUsed,
        provingMs: final.provingMs,
        publicKeyOccurrences: final.publicKeyOccurrences,
        proofBytes: PROOF_BYTES,
        rows: [
          ["From", <code key="f">{app.name} · {shortHex(account?.address ?? "")}</code>],
          ["To", <code key="t">{shortHex(to)}{to === merchant ? " · demo merchant" : ""}</code>],
          ["Relayer fee", <code key="fee">{formatUsdg(fee, 2)} USDG, signed into the approval</code>],
        ],
      });
      activity.add({
        hash: tx.transactionHash, appKey: app.key, kind: "pay", label: `${formatUsdg(units)} USDG from ${app.name}`,
        gasUsed: tx.gasUsed.toString(), provingMs: final.provingMs, publicKeyOccurrences: final.publicKeyOccurrences, at: Date.now(),
      });
      refreshAccounts();
    } catch {
      // The view shows the rejection.
    }
  };

  const view: PayViewProps = {
    accountName: app.name,
    tone: app.tone,
    balance: account ? account.balance : null,
    merchant: merchant ?? null,
    recipient,
    amount,
    fee,
    perTxCap,
    remainingToday,
    chainName: config?.chainName ?? "",
    state,
    receipt,
    explorer: config ?? { explorerUrl: null },
    problem,
    overCap,
    onRecipient: setRecipient,
    onAmount: setAmount,
    onSubmit: submit,
    onTryOverCap: () => setAmount(formatUsdg(perTxCap + 1_000_000n).replace(/,/g, "")),
    onDone: () => setState({ status: "idle" }),
    paymentSheet: sheetAvailable
      ? { enabled: sheetRequired || useSheet, onToggle: setUseSheet, required: sheetRequired }
      : undefined,
  };
  return compact ? <PayMobile {...view} /> : <PayDesktop {...view} />;
}
