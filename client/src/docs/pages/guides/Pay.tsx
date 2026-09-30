import { A, Callout, H2, Step, Steps, Table } from "../../components";

export default function PayGuide() {
  return (
    <>
      <H2>Make a payment</H2>
      <Steps>
        <Step title="Open Pay">
          <p>
            Select <strong>Pay</strong> in the app. The recipient defaults to the demo merchant; on a phone, select{" "}
            <strong>Pay someone else</strong> to enter another address.
          </p>
        </Step>
        <Step title="Enter the amount">
          <p>
            Amounts are in USDG, with up to 6 decimals. The page shows your balance and, on a wide screen, how much you
            can still spend today.
          </p>
        </Step>
        <Step title="Approve with passkey">
          <p>
            Select <strong>Approve with passkey</strong> and confirm with Face ID, Touch ID or your PIN. That single
            approval covers the amount, the recipient and the fee.
          </p>
        </Step>
      </Steps>

      <H2>What happens when you approve</H2>
      <p>The page shows each stage as it happens:</p>
      <Table
        head={["On a wide screen", "On a phone", "What happens"]}
        rows={[
          ["Passkey", "Approve with your passkey", "Your passkey signs the exact payment."],
          ["Zero-knowledge proof", "Proving on this device", "Your browser proves the signature in zero knowledge: about 2 seconds in desktop Chrome with 8 threads; browsers that prove on one thread take a few seconds longer."],
          ["Gasless relay", "Sending the proof", "The relayer simulates the payment, then submits it."],
          ["Arbitrum", "Confirming on Arbitrum", "Arbitrum includes the transaction: the account checks the proof and the policy, and pays."],
        ]}
      />
      <p>When the payment is confirmed, the page shows a receipt, <strong>Paid</strong>, with a link to the transaction.</p>
      <p>
        If any stage fails, the page says which one and why. See <A href="#when-a-payment-is-refused">When a payment is
        refused</A>.
      </p>

      <H2>Fees</H2>
      <p>
        You never need ETH. The relayer pays the gas, and your account pays it a fee of 0.02 USDG. The fee is part of
        what your passkey approves, so it cannot be changed afterwards. The amount plus the relayer fee must fit the
        per-payment and daily caps; the new-recipient cap looks at the amount alone.
      </p>
      <p>
        Accounts refuse any fee above 0.25 USDG and pay fees only to the relayer address fixed when the account was
        created, so nobody else can collect them.
      </p>

      <H2>Confirm in the payment sheet</H2>
      <p>
        In Chrome on macOS and Android, the browser can show its own payment sheet instead of the plain passkey
        prompt. The sheet shows the payee (the recipient's address, in lowercase) and the total (the amount plus the
        fee). The account checks that the payee and total you confirmed are exactly the ones in the payment.
      </p>
      <p>
        When it is available, the Pay page shows <strong>Confirm in the browser's payment sheet</strong>. If you close
        the sheet, the payment is cancelled and nothing is paid; the app does not ask again with the plain prompt. You can
        also <A href="/docs/guides/protect#require-the-payment-sheet">require the sheet</A> for every payment.
      </p>

      <H2>Your receipt</H2>
      <p>On a wide screen, a verified payment shows a receipt with:</p>
      <ul>
        <li>the amount, the account it came from, the recipient and the relayer fee;</li>
        <li>the transaction, linked to Arbiscan;</li>
        <li>the gas used and the time the proof took;</li>
        <li>the size of the proof (8,768 bytes);</li>
        <li>how many times your passkey's public key appears in the transaction: 0.</li>
      </ul>
      <p>
        On a phone, the <strong>Paid</strong> screen shows the amount, the recipient, the time the proof took, the
        relayer fee, how many times your passkey's public key appears in the transaction (0) and a link to Arbiscan.
      </p>

      <H2>When a payment is refused</H2>
      <p>
        A valid approval only proves that you signed. Your account's policy decides whether the payment may happen. When
        it says no, the page shows "Authenticated, not authorized." and the reason, or "Authenticated, not funded." when
        the account cannot cover the amount and the fee:
      </p>
      <Table
        head={["Reason", "What it means", "What to do"]}
        rows={[
          [<code key="a">PerTxCapExceeded</code>, "The amount plus the fee is above the per-payment cap.", "Pay less, or raise the cap (timelocked)."],
          [<code key="b">DailyCapExceeded</code>, "The payment would pass today's cap.", "Wait until the next UTC day, or raise the cap (timelocked)."],
          [<code key="c">NewPayeeCapExceeded</code>, "It is the first payment to this address, and it is above the new-recipient cap.", "Pay a smaller amount first, or allowlist the recipient (timelocked)."],
          [<code key="d">RecipientNotAllowed</code>, "The allowlist is on and the recipient is not on it.", "Add the recipient (timelocked)."],
          [<code key="e">AccountFrozen</code>, "The account is frozen.", "Schedule an unfreeze on the Policy page."],
          [<code key="f">PaymentSheetRequired</code>, "The account only pays through the payment sheet.", "Pay from a browser that can show it, or stop requiring it (timelocked)."],
          [<code key="g">FeeTooHigh</code>, "The relayer asked more than the account's fee limit.", "Nothing to do on your side: the relayer must lower its fee."],
          [<code key="h">TokenTransferFailed</code>, "The account holds less USDG than the amount plus the fee.", "Fund the account."],
        ]}
      />
      <Callout kind="note">
        Every reason is enforced by the account on Arbitrum, not by the app. The{" "}
        <A href="/docs/reference/errors">errors reference</A> lists every error.
      </Callout>
    </>
  );
}
