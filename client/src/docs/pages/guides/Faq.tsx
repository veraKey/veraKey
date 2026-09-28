import { A, H2 } from "../../components";

export default function FaqGuide() {
  return (
    <>
      <H2>My passkey provider is not supported</H2>
      <p>
        VeraKey needs a passkey that supports the WebAuthn PRF extension: iCloud Keychain on iOS 18.4+ or macOS 15.4+,
        or Google Password Manager in Chrome. Older systems and some providers do not support PRF, and VeraKey refuses to
        create accounts without it, because PRF is what keeps them unlinkable. See{" "}
        <A href="/docs/guides/create-account#what-you-need">What you need</A>.
      </p>

      <H2>I lost my phone</H2>
      <p>
        If your passkey is synced (iCloud Keychain, Google Password Manager), sign in to your provider on another device
        and unlock VeraKey there: your accounts are derived again. If you think someone else has your unlocked phone,{" "}
        <A href="/docs/guides/protect#freeze">freeze the account</A> from another device, or ask your guardian to. If the
        passkey itself is gone, see <A href="/docs/guides/recovery">Recovery and guardians</A>.
      </p>

      <H2>My passkey opens a different wallet</H2>
      <p>
        Your accounts are derived from your passkey and a secret it returns for VeraKey (PRF). Some password managers
        return a different secret for the same passkey through another route, for example through a phone's QR code
        instead of the password manager on this device, and a different secret opens different accounts. VeraKey
        remembers the secret each passkey returned in this browser and refuses an unlock that returns another one, so
        unlock the way you did before. In a browser that has never seen the passkey, use the route you used first.
      </p>

      <H2>The faucet is out of USDG</H2>
      <p>
        The demo faucet pays from a shared treasury that is refilled by hand. Try again later, or claim test USDG at{" "}
        <A href="https://faucet.paxos.com">faucet.paxos.com</A> and send it to your account. See{" "}
        <A href="/docs/guides/fund">Fund and receive</A>.
      </p>

      <H2>Authenticated, not authorized</H2>
      <p>
        Your passkey approved, but the account's policy refused: the amount is above a cap, the recipient is new or not
        allowlisted, or the account is frozen. The message names the reason. See{" "}
        <A href="/docs/guides/pay#when-a-payment-is-refused">When a payment is refused</A>.
      </p>

      <H2>The payment sheet does not appear</H2>
      <p>
        The payment sheet (Secure Payment Confirmation) appears only in Chrome on macOS and Android, with a passkey
        enrolled for it in that browser profile: the app enrolls passkeys for it only there, where the platform's passkeys
        support PRF. Elsewhere the app uses the ordinary passkey prompt. If your
        account requires the sheet, pay from a browser that can show it, or schedule{" "}
        <A href="/docs/guides/protect#require-the-payment-sheet">Stop requiring it</A>.
      </p>

      <H2>Is this real money?</H2>
      <p>
        No. VeraKey runs on Arbitrum Sepolia, a test network, with Paxos USDG test tokens. The circuits and contracts have
        not had an independent audit; do not use them with real funds. See the{" "}
        <A href="/docs/security/review">audit status</A>.
      </p>

      <H2>Where can I see my transactions?</H2>
      <p>
        Every receipt links to the transaction on <A href="https://sepolia.arbiscan.io">Arbiscan</A>, and every account
        card links to the account's address there. Look for the proof in the calldata; you will not find your passkey's
        public key.
      </p>
    </>
  );
}
