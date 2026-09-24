import { A, H2 } from "../../components";

export default function ChangelogPage() {
  return (
    <>
      <p>Newest first. Each entry is one step of the build.</p>

      <H2>2026-09-24</H2>
      <ul>
        <li>
          <strong>Sign in with VeraKey</strong> (developer preview): a game or an app on its own domain signs players in
          through VeraKey's popup, gets a player ID that only it knows, and takes USDG payments. See{" "}
          <A href="/docs/build/sign-in">Sign in with VeraKey</A>.
        </li>
        <li>
          <strong>Documentation.</strong> This site: 30 pages for people who use VeraKey and developers who build on it, with
          search, an outline on every page and examples you can copy.
        </li>
        <li>The landing page and the docs compare the same payment before and after, and state what the validator tests cover.</li>
        <li>
          <strong>Redeployed to Arbitrum Sepolia</strong> with the new verifiers and protections, so account addresses
          changed. The protections, disclosures and the validator are documented. See{" "}
          <A href="/docs/reference/deployments">Deployments</A>.
        </li>
        <li>
          <strong>Fixed the internal security review's findings:</strong> fees go only to the fee recipient, owners can
          require the payment sheet, a guardian cannot veto changes to the guardian, a freeze cancels scheduled changes,
          disclosures enforce their audience and nonce, and the relayer checks account code. See{" "}
          <A href="/docs/security/review">Review and accepted risks</A>.
        </li>
        <li>Hardening: property tests for the account's logic, a dependency audit, and a relayer that keeps no raw IP addresses.</li>
        <li>
          <strong>ERC-7579 validator:</strong> VeraKey proofs for Kernel and Nexus smart accounts. See{" "}
          <A href="/docs/build/erc-7579">ERC-7579 validator</A>.
        </li>
        <li>The app can disclose and verify a link, freeze in an emergency, require the payment sheet, receive with an address and a QR code, and show a second app's account.</li>
        <li>
          <strong>Linkable by consent:</strong> a second circuit proves that one passkey owns two app accounts. See{" "}
          <A href="/docs/guides/disclosures">Prove two accounts are yours</A>.
        </li>
        <li>
          <strong>Payment sheet:</strong> with Secure Payment Confirmation, the browser's own sheet shows the payee and total,
          and the account checks them.
        </li>
        <li>
          <strong>Account protections:</strong> an instant freeze, a cap on first payments to new recipients, a private
          guardian, and packed storage.
        </li>
        <li>
          <strong>Barretenberg 5.2.0</strong> and its optimized verifier: a payment drops from 4.17M to 1.07M gas. See{" "}
          <A href="/docs/architecture/gas">Gas and performance</A>.
        </li>
        <li>The landing page names wallets shared across apps as the problem, and prices a payment on Arbitrum One.</li>
        <li>The landing page tells the VeraKey story and claims only what holds.</li>
        <li>The landing page and /app/pay show the same views of a payment.</li>
        <li>A landing page hero that follows one payment on a phone and in the dashboard.</li>
      </ul>

      <H2>2026-09-23</H2>
      <ul>
        <li>The demo focuses on one app, Pay.</li>
        <li>An account without funds gets an explanation instead of a bare revert.</li>
        <li><strong>First deployment to Arbitrum Sepolia</strong>, for https://verakey.mdloglabs.org.</li>
        <li>
          <strong>First release:</strong> zero-knowledge passkey accounts with USDG payments on Arbitrum.
        </li>
      </ul>
    </>
  );
}
