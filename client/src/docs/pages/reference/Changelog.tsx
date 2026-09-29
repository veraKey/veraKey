import { A, H2 } from "../../components";
import { SDK_NPM_URL } from "../../site";

export default function ChangelogPage() {
  return (
    <>
      <p>Newest first. Each entry is one step of the build.</p>

      <H2>2026-09-29</H2>
      <ul>
        <li>
          <strong>A third internal review, and a new deployment:</strong> the review found six issues, all fixed the same
          day (see <A href="/docs/security/review">Review and accepted risks</A>). An account no longer lets the fees of
          freezing and cancelling push a day past its daily cap: past the cap, their fee is waived. And it refuses a change
          identical to one already waiting (<code>ChangeAlreadyPending</code>), and a removal that, with the removals
          already scheduled, would leave no owner (<code>LastOwner</code>). These are contract changes, so Arbitrum
          Sepolia has a new factory and account implementation (see <A href="/docs/reference/deployments">Deployments</A>),
          and <code>ARBITRUM_SEPOLIA</code> in SDK 0.2.3 points to them; 0.2.1 and 0.2.2 are deprecated. Accounts made
          before 29 September stay on the previous deployment: the same passkey now opens a new, empty account, which
          the demo faucet funds again.
        </li>
        <li>
          <strong>The relayer spends less on attackers:</strong> a visitor on IPv6 is counted by its /64, which one
          machine usually holds whole; new accounts and faucet grants have daily budgets for everyone; the RPC proxy
          takes batches of at most 10 calls and only bounded log queries; each account has one transaction in flight at a
          time; and safety actions whose fee the account waives are relayed at most 10 times a day per account. See{" "}
          <A href="/docs/build/relayer-api#rate-limits">Relayer API</A>.
        </li>
        <li>
          <strong>SDK 0.2.3, sessions the kit can end:</strong> signing out ends every copy of the session cookie, a
          session checks every 10 minutes that its passkey still owns the account (<code>ownerCheckSeconds</code>), the
          payment route checks one payment per player at a time, <code>verifySignIn</code> no longer reads the chain once
          a check that needs no chain has failed, and <code>ChangeAlreadyPending</code> is a <code>policy</code> error.
          See <A href="/docs/build/sign-in#use-the-kit">Use the kit</A>.
        </li>
        <li>
          <strong>Translated pages keep working:</strong> with Chrome's page translation on, the app stopped on an error
          screen as soon as a button showed its spinner, and the landing page did within seconds, as its payment preview
          plays by itself. Button labels now sit apart from their spinners, the preview is left untranslated, and a page
          no longer stops when the translator has swapped out text the page still changes.
        </li>
      </ul>

      <H2>2026-09-28</H2>
      <ul>
        <li>
          <strong>SDK 0.2.2, one passkey keeps one identity:</strong> some password managers return a different PRF secret
          for the same passkey through another route, such as a phone's QR code instead of the manager on the device, and a
          different secret opens different accounts. VeraKey now remembers a one-way check of the secret each passkey
          returned in a browser, and refuses an unlock that returns another one. See{" "}
          <A href="/docs/guides/faq#my-passkey-opens-a-different-wallet">My passkey opens a different wallet</A>.
        </li>
        <li>
          <strong>The docs were checked against the code and the live deployment.</strong> The payment sample in{" "}
          <A href="/docs/build/sign-in">Sign in with VeraKey</A> treated any <code>verifyPayment</code> result as paid; it
          now accepts a payment only when <code>valid</code> is true.
        </li>
      </ul>

      <H2>2026-09-27</H2>
      <ul>
        <li>
          <strong>VeraKey moves to verakey.xyz:</strong> accounts are bound to their domain for good, so Arbitrum Sepolia
          has a new deployment for https://verakey.xyz (see <A href="/docs/reference/deployments">Deployments</A>), and{" "}
          <code>ARBITRUM_SEPOLIA</code> in SDK 0.2.1 points to it; 0.2.0, which pinned the previous deployment, is
          deprecated. Accounts made on verakey.mdloglabs.org stay on the previous deployment, and their passkeys do not
          work on verakey.xyz: create a new passkey there. A Kernel v3.3 account runs on the new validator (
          <A href="https://arbitrum-sepolia.blockscout.com/tx/0x0f617b9b889c61f9322206631cdab1c5d207fc1a95b1f97a0bfc54c8ddf92fc3">transaction</A>),
          and the integration kit's end-to-end test paid 1 USDG through the live popup (
          <A href="https://arbitrum-sepolia.blockscout.com/tx/0xea54a309445e3c58d38463555080e40cd8ada19099a0520cd73d411d3b18a855">transaction</A>).
        </li>
        <li>
          <strong>SDK 0.2.0, the integration kit:</strong> <code>createVeraKeyServer</code> from{" "}
          <code>@verakey/sdk/server</code>, and <code>SignInWithVeraKey</code> and <code>useVeraKey</code> from{" "}
          <code>@verakey/sdk/react</code>, add Sign in with VeraKey and payments to a React site with a Node server in
          about ten lines: nonces bound to the browser, sessions in a signed cookie, and payments verified on-chain and
          accepted once. <code>ARBITRUM_SEPOLIA</code> pins the deployment. See{" "}
          <A href="/docs/build/sign-in#use-the-kit">Use the kit</A>.
        </li>
        <li>
          <strong>SDK 0.1.2, VeraKey passkeys own ZeroDev Kernel accounts:</strong>{" "}
          <code>toVeraKeyKernelValidator</code> from <code>@verakey/sdk/kernel</code> makes the ERC-7579 validator a
          Kernel plugin. On Arbitrum Sepolia, on the previous deployment, a Kernel v3.3 account deployed and paid 1 USDG with a passkey proof (
          <A href="https://arbitrum-sepolia.blockscout.com/tx/0x66dbf2ed7552d9e0d563bdf9a8aee30656d1e99cfab4c9e8bade961c0d0cfc2f">transaction</A>). See <A href="/docs/build/erc-7579">ERC-7579 validator</A>.
        </li>
        <li>
          <strong>Payments on Arbitrum Sepolia:</strong> test USDG arrived from Paxos, and the first payment was approved
          with a passkey on an iPhone, on the previous deployment (
          <A href="https://arbitrum-sepolia.blockscout.com/tx/0x81c5d7e446873a656deefe7910dd65719a5c3dac4cc2c95719d9f8173c5ff797">transaction</A>).
        </li>
      </ul>

      <H2>2026-09-24</H2>
      <ul>
        <li>
          <strong>SDK 0.1.1 and the popup:</strong> when a site's own nonce callback fails, the popup closes and{" "}
          <code>error.cause</code> keeps what the callback threw. <code>verifySignIn</code> words each check for its
          outcome, names both origins when a sign-in was made for another site, and always says whether the player still
          owns the account. The popup has stable test ids, and says so when a site's request never arrives. See{" "}
          <A href="/docs/build/sign-in">Sign in with VeraKey</A>, which now covers local development and testing.
        </li>
        <li>
          <strong>The docs read without JavaScript:</strong> every page is served as HTML, and as Markdown at its address
          plus <code>.md</code>. <code>/llms.txt</code> lists the pages, and <code>/llms-full.txt</code> holds all of them.
        </li>
        <li>
          <strong>The SDK is public</strong> on <A href={SDK_NPM_URL}>npm</A>: <code>npm install @verakey/sdk</code>.
          Sign in with VeraKey works on any https site today; accounts and payments on your own domain still need a
          deployment for it. See{" "}
          <A href="/docs/build/quickstart">Quickstart</A>.
        </li>
        <li>
          <strong>Fixed the internal audit's findings:</strong> the caps can no longer stop owners from freezing or vetoing,
          a change to the guardian cancels the old guardian's recovery and always waits the recovery delay, a freeze is
          always instant, and owner changes that could never apply are refused. Redeployed to Arbitrum Sepolia, so account
          addresses changed. See <A href="/docs/security/review">Review and accepted risks</A>.
        </li>
        <li>
          <strong>Sign in with VeraKey</strong> (developer preview): a game or an app on its own domain signs players in
          through VeraKey's popup, gets its own ID for each player, and takes USDG payments. See{" "}
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
