import { A, Callout, Code, H2, Table } from "../../components";

export default function PaymentSheetPage() {
  return (
    <>
      <H2>Browser support</H2>
      <p>
        Secure Payment Confirmation (SPC) is a W3C standard: the browser, not your page, shows the payee and the total in
        its own sheet, and the passkey signs them. Only Chromium ships it: Chrome on macOS, Windows and Android. On
        Linux it needs a browser flag, and Safari and Firefox do not support it.
      </p>
      <Code lang="ts">{`
import { spcAvailability } from "@verakey/sdk/webauthn";

await spcAvailability(); // "available", or the reason it is not (e.g. "unavailable-no-api")
`}</Code>

      <H2>Enroll a passkey</H2>
      <p>
        The passkey has to be enrolled for payments when it is created, as a platform passkey (on this device), in the
        same browser profile that will show the sheet. Configure the instrument the sheet displays:
      </p>
      <Code lang="ts">{`
const vera = new VeraKeyClient({
  // …the rest of the configuration
  paymentInstrument: { displayName: "My app · USDG", icon: \`\${location.origin}/icon.png\` },
});

const payment = (await spcAvailability()) === "available";
await vera.register("Alice", { payment });
`}</Code>
      <p>
        <code>vera.canConfirmPayments()</code> tells you whether the current session can use the sheet: the passkey is
        enrolled in this browser, an instrument is configured, and the browser reports SPC as available.
      </p>

      <H2>Pay through the sheet</H2>
      <Code lang="ts">{`
const secureConfirmation = await vera.canConfirmPayments();
await vera.pay(APP_ID, merchant, 2_000_000n, render, { secureConfirmation });
`}</Code>
      <p>
        Once the sheet has been shown, the SDK never falls back to the plain passkey prompt. If the user closes the sheet,
        perhaps because the payee looked wrong, the payment stops with a <code>VeraKeyError</code> in the{" "}
        <code>authentication</code> stage: "The payment sheet was closed or timed out. Nothing was paid."
      </p>

      <H2>Require the sheet</H2>
      <p>
        Optional confirmation protects users only when the page is honest. To protect them from a tampered page, make the
        sheet mandatory for the account:
      </p>
      <Code lang="ts">{`
await vera.restrict(APP_ID, changePayload.setPaymentSheet(true));  // instant
await vera.scheduleChange(APP_ID, changePayload.setPaymentSheet(false)); // dropping it waits out the change delay
`}</Code>
      <p>
        From then on the account refuses plain passkey assertions for payments (<code>PaymentSheetRequired</code>), and{" "}
        <code>vera.pay</code> always uses the sheet. Where the sheet is not available, <code>pay</code> fails with a{" "}
        <code>policy</code> error before prompting.
      </p>
      <Callout kind="warning">
        An SPC enrollment belongs to one browser profile. Only require the sheet when the user always pays from a browser
        where their passkey is enrolled for it; elsewhere they cannot pay until the requirement is dropped.
      </Callout>

      <H2>What the account checks</H2>
      <p>
        The browser's client data for a payment confirmed in the sheet has type <code>payment.get</code>. The account
        accepts it only for <code>pay</code>, and only if it matches byte for byte:
      </p>
      <Code lang="json" title="clientDataJSON (shape)">{`
{"type":"payment.get","challenge":"<the action hash, base64url>","origin":"https://verakey.mdloglabs.org",
 "crossOrigin":false,"payment":{"rpId":"verakey.mdloglabs.org","topOrigin":"https://verakey.mdloglabs.org",
 "payeeName":"0x<the recipient, lowercase hex>","total":{"value":"2.02","currency":"USD"},"instrument":{…}}}
`}</Code>
      <Table
        head={["Field", "Must be"]}
        rows={[
          [<code key="1">challenge</code>, "The action hash of this payment."],
          [<code key="2">origin, topOrigin</code>, "The account's origin, exactly; crossOrigin is false."],
          [<code key="3">payeeName</code>, "The recipient's address in lowercase hex."],
          [<code key="4">total.value</code>, "The amount plus the fee, with six decimals trimmed to at least two (formatSpcTotal)."],
          [<code key="5">payment.rpId</code>, "A string whose sha256 is the account's rpIdHash."],
        ]}
      />
      <p>
        Because the fee is at most <code>maxFee</code> and goes only to the fee recipient, the payee receives at least the
        total shown minus the fee limit. The rules are pinned by tests: see <A href="/docs/security#invariants">invariant
        11</A>.
      </p>
    </>
  );
}
