import { A, Callout, H2, Table } from "../../components";

export default function ProtectGuide() {
  return (
    <>
      <H2>Your policy at a glance</H2>
      <p>
        The Policy page shows what your account enforces, all of it on-chain. New accounts on Arbitrum Sepolia start
        with these values:
      </p>
      <Table
        head={["Setting", "Arbitrum Sepolia", "What it limits"]}
        rows={[
          ["Per-payment cap", "10 USDG", "The largest single payment, fee included."],
          ["Daily cap", "25 USDG", "The total spent per UTC day, fees included."],
          ["New-recipient cap", "2 USDG", "The largest first payment to an address the account has never paid."],
          ["Change delay", "2 minutes", "How long a loosening change waits. The production default is 1 day."],
          ["Recovery delay", "5 minutes", "How long a guardian recovery waits. The production default is 3 days."],
        ]}
      />
      <p>
        The rule behind every setting: changes that tighten the policy apply at once, and changes that loosen it are
        scheduled and wait out the change delay. A stolen, unlocked phone can make your account safer instantly, but it
        cannot quietly make it riskier.
      </p>

      <H2>Caps</H2>
      <p>
        Enter a new per-payment and daily cap under <strong>Change the policy</strong>. If both are lower than or equal
        to the current caps, the button says <strong>Lower now</strong> and they apply immediately. Otherwise it says{" "}
        <strong>Set caps</strong>, and the change is scheduled. The per-payment cap cannot go below the largest fee (0.25
        USDG on Arbitrum Sepolia). And a spent cap never stops you: freezing and cancelling work even when today's cap is
        used up.
      </p>

      <H2>The new-recipient cap</H2>
      <p>
        The first payment to an address the account has never paid is capped separately, even when it fits your other
        caps. It limits what a look-alike address, a poisoned transaction history or a tampered page can take in one
        approval. Once you have paid an address, the ordinary caps apply to it. Allowlisted recipients are exempt.
      </p>
      <p>
        Lowering this cap applies at once; raising it is scheduled. Set it under{" "}
        <strong>First payment to a new recipient, at most</strong>.
      </p>

      <H2>The allowlist</H2>
      <p>
        Add recipients under <strong>Allow a recipient</strong>; each addition is scheduled. Select{" "}
        <strong>Only pay allowlisted recipients</strong> to turn the allowlist on at once. Turning it off again,{" "}
        <strong>Allow payments to anyone</strong>, is scheduled.
      </p>

      <H2>Freeze</H2>
      <p>
        Lost a device, or saw a payment you did not make? Select <strong>Freeze payments now</strong>. One approval stops
        every payment immediately and cancels every scheduled change, so nothing someone else scheduled survives. Your
        guardian can freeze the account too.
      </p>
      <p>
        To unfreeze, select <strong>Schedule unfreeze</strong>. Like any loosening change it waits out the change delay,
        and you or your guardian can cancel it.
      </p>
      <Callout kind="security">
        A frozen account still pays the relayer's fee for actions you approve, such as scheduling the unfreeze, but only
        to the relayer and never more than 0.25 USDG. Someone who tricks you into approving cannot collect it.
      </Callout>

      <H2>Scheduled changes</H2>
      <p>
        The <strong>Scheduled changes</strong> panel lists every change waiting on the account, read from the chain, with
        a countdown. At most 8 changes can wait at once. A change scheduled from another device, or by someone else, is
        marked "Not scheduled from this browser. Cancel it if it was not you."
      </p>
      <ul>
        <li>
          <strong>Apply</strong> appears when the countdown ends. A scheduled change does nothing until someone applies it,
          so select <strong>Apply</strong>. Applying needs no passkey approval, and anyone may do it.
        </li>
        <li>
          The <strong>×</strong> button cancels a change with a passkey approval.
        </li>
      </ul>

      <H2>Require the payment sheet</H2>
      <p>
        In Chrome on macOS, Windows and Android, you can make the browser's own payment sheet mandatory: select{" "}
        <strong>Require the payment sheet now</strong>. From then on, the account refuses any payment that was not
        confirmed in the sheet, so a tampered page cannot pay without the browser showing you the payee and the total.
      </p>
      <p>
        Requiring it applies at once; <strong>Stop requiring it</strong> is scheduled. In browsers that cannot show the
        sheet, the option says <strong>Not available in this browser</strong>. Only turn it on if you pay from a browser
        where your passkey is enrolled for the sheet. See <A href="/docs/guides/pay#confirm-in-the-payment-sheet">Confirm
        in the payment sheet</A>.
      </p>
    </>
  );
}
