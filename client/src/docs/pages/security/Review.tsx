import { A, Badge, Callout, Contact, H2, Table } from "../../components";

export default function ReviewPage() {
  return (
    <>
      <H2>Audit status</H2>
      <ul>
        <li>VeraKey is a testnet preview on Arbitrum Sepolia.</li>
        <li>The circuits and contracts have <strong>not had an independent audit</strong>, and UltraHonk itself has not been independently audited.</li>
        <li>
          Three internal reviews were done: two on 2026-09-24, the second a Nemesis audit of the contracts and circuits, and
          a Nemesis audit of the whole system on 2026-09-29. Their findings are fixed. They do not replace an audit.
        </li>
      </ul>
      <Callout kind="warning">Do not use VeraKey with real funds until it has been audited.</Callout>
      <p>What is tested instead:</p>
      <ul>
        <li>18 circuit tests: 11 for the authorization circuit, 7 for the link circuit;</li>
        <li>47 unit tests and 10 property tests of 2,000 cases each for the account's logic;</li>
        <li>36 tests for the ERC-7579 validator, with real proofs;</li>
        <li>130 unit tests for the SDK, the integration kit among them;</li>
        <li>
          85 end-to-end tests that deploy the real contracts to a local Arbitrum Nitro node and use real proofs: 44 for the
          account, 11 that replay the audits' attacks, 10 for disclosures, 5 for Sign in with VeraKey and 15 that drive the
          relayer over HTTP;
        </li>
        <li>
          an automated browser workflow that drives the app in headless Chrome with a virtual
          passkey, on desktop, on mobile and through the payment sheet.
        </li>
      </ul>
      <p>
        Every change rebuilds the circuits, the verifiers and the contracts, and runs all of these tests except the browser
        workflow.
      </p>

      <H2>Internal review</H2>
      <p>
        On 2026-09-24 an adversarial review covered every change since the Barretenberg 5.2.0 upgrade: the Stylus account
        and core, both circuits, disclosure verification, the SDK client, the ERC-7579 validator and the relayer. Each fix
        below has a regression test; the numbers refer to the <A href="/docs/security#invariants">invariants</A>.
      </p>
      <Table
        head={["Severity", "Finding", "Fix"]}
        rows={[
          [
            <Badge key="s" tone="orange">High</Badge>,
            "Fees went to whoever submitted the transaction. A signed fee, from any action and even from a frozen account, could pay an attacker, bypassing the freeze, the allowlist and the new-recipient cap.",
            "Fees go only to the factory's fee recipient, capped by maxFee (3).",
          ],
          [
            <Badge key="s" tone="orange">Medium</Badge>,
            "The payment sheet was optional, and the SDK fell back to the plain prompt after the sheet was closed.",
            "Owners can require the sheet; there is no fallback once the sheet was shown (11).",
          ],
          [
            <Badge key="s" tone="orange">Medium</Badge>,
            "A guardian could freeze and then veto every unfreeze and every attempt to remove it, forever.",
            "The guardian cannot veto changes to the guardian; they wait longer (10).",
          ],
          [
            <Badge key="s" tone="orange">Medium</Badge>,
            "A freeze left changes a thief had scheduled alive, and the app listed only changes made in the same browser.",
            "Freezing cancels scheduled changes, and the list is on-chain (5, 7).",
          ],
          [
            <Badge key="s">Low–medium</Badge>,
            "The disclosure verifier did not enforce the audience and the nonce.",
            "verifyDisclosure requires the audience, checks the nonce and bounds the lifetime (13).",
          ],
          [
            <Badge key="s">Low</Badge>,
            "The relayer trusted a contract's own config() answer and allowed 12M gas.",
            "A clone-code check, a 2.5M gas cap and a per-visitor limit on new accounts.",
          ],
        ]}
      />
      <p>
        A second internal audit the same day ran Nemesis over the Stylus contracts, the ERC-7579 validator and both circuits:
        alternating passes that question every line and map every piece of state that must change together, until nothing
        new surfaces. Every finding but the last was reproduced on a local Arbitrum Nitro node with real proofs, and its
        fix has a regression test that replays the attack. The last one, the factory's bounds, was confirmed by reading
        the code, and its fix has unit tests.
      </p>
      <Table
        head={["Severity", "Finding", "Fix"]}
        rows={[
          [
            <Badge key="s" tone="orange">High</Badge>,
            "Freezing, restricting and cancelling paid their fee within the same caps as payments. A thief who spent the day's cap stopped the owners from freezing or vetoing until the next UTC day, so a change the thief scheduled applied unopposed; a per-payment cap below the fee locked every relayed action.",
            "These actions are never refused because of the caps, and their fee still counts toward the day's spending. The per-payment cap never drops below maxFee (2).",
          ],
          [
            <Badge key="s" tone="orange">Medium</Badge>,
            "A recovery survived a change to the guardian, so a guardian the owners removed could still take the account with a recovery it started just before.",
            "A change to the guardian cancels a pending recovery (10).",
          ],
          [
            <Badge key="s">Low</Badge>,
            "The longer delay for replacing a guardian was decided when the change was scheduled, so a replacement queued before a guardian existed skipped it.",
            "Every change to the guardian waits the change delay plus the recovery delay (10).",
          ],
          [
            <Badge key="s">Low</Badge>,
            "A freeze scheduled through the timelock did not cancel the scheduled changes.",
            "A freeze cannot be scheduled; it is always instant (5).",
          ],
          [
            <Badge key="s">Low</Badge>,
            "Owner changes that could never apply kept one of the eight pending slots.",
            "They are refused when they are scheduled (6).",
          ],
          [
            <Badge key="s">Low</Badge>,
            "The factory accepted a configuration that every account then rejected.",
            "The factory and the accounts check the same bounds.",
          ],
        ]}
      />
      <p>
        A third internal review on 2026-09-29 ran Nemesis over the whole system: the contracts and circuits again, and for
        the first time the relayer, the SDK's sign-in and payment checks, the integration kit, the popup and the app. It
        also regenerated both verifiers from the circuits (byte-identical) and compared the deployed code with the audited
        build. The first three findings were reproduced, on a local Arbitrum Nitro node with real proofs or against the
        relayer, and every fix has a regression test. The contract fixes shipped in a new deployment on 2026-09-29.
      </p>
      <Table
        head={["Severity", "Finding", "Fix"]}
        rows={[
          [
            <Badge key="s" tone="orange">Medium</Badge>,
            "Freezing, restricting and cancelling are never refused because of the caps, and each paid up to maxFee, so a stolen passkey could burn the whole balance on fees.",
            "Past the day's cap their fee is waived: a day never spends more than its cap (2).",
          ],
          [
            <Badge key="s" tone="orange">Medium</Badge>,
            "The relayer counted visitors by their full address, so rotating IPv6 addresses gave unlimited new accounts, faucet grants and RPC calls.",
            "Visitors are counted by /64, new accounts and faucet grants have a daily budget for everyone, and the RPC proxy refuses large batches and unbounded log queries.",
          ],
          [
            <Badge key="s">Low</Badge>,
            "Concurrent faucet requests for one account were each paid.",
            "The faucet reserves the account before it sends.",
          ],
          [
            <Badge key="s">Low</Badge>,
            "A kit session could not be revoked: signing out only cleared the cookie in that browser, and a passkey a recovery removed stayed signed in for up to seven days.",
            "Signing out ends every copy of the session, and a session checks every 10 minutes that its passkey still owns the account.",
          ],
          [
            <Badge key="s">Low</Badge>,
            "A crafted sign-in made the site's server run the on-chain proof check, and one player could pile up slow payment checks.",
            "verifySignIn stops before any RPC call once a local check fails; one payment check runs at a time per player.",
          ],
          [
            <Badge key="s">Low</Badge>,
            "The same owner change twice, or removals that together would leave no owner, could be scheduled; the extra one could never apply and kept a pending slot.",
            "They are refused when they are scheduled (6).",
          ],
        ]}
      />

      <H2>Accepted risks</H2>
      <ul>
        <li>
          <strong>A stolen, unlocked passkey can fight the owner.</strong> Whoever holds it can approve anything the owner
          can, within the caps, the new-recipient cap and the timelocks. Each side can cancel the other's scheduled changes
          and a recovery. The guardian can veto a thief's changes, and a freeze wipes them. A thief cannot lift the caps or
          unfreeze while the owner or the guardian keeps cancelling within the change delay.
        </li>
        <li>
          <strong>A guardian can take over.</strong> A recovery that no owner cancels within the recovery delay makes the
          guardian's chosen passkey the only owner. The Recovery page shows <strong>Recovery in progress</strong>, but
          nothing notifies you, so name only a guardian you would trust with the account.
        </li>
        <li>
          <strong>Fees while frozen.</strong> A thief who can make the passkey sign can still spend the account's funds on
          fees: up to <code>maxFee</code> per approval, paid only to the relayer, and never past the day's cap, beyond which
          these fees are waived. That is griefing, not theft. The relayer sends a few such fee-free actions per account and
          day; anyone can submit more themselves.
        </li>
        <li>
          <strong>After a recovery the owner cannot rebuild the old guardian card.</strong> The guardian salt comes from the
          old passkey's PRF, so the guardian must keep its card, and the owner should name a guardian again after
          recovering.
        </li>
        <li>
          <strong>Backup and recovered passkeys cannot use the app yet.</strong> The app and the SDK open the account derived
          from the passkey you unlock with, so a backup owner, or the new owner after a recovery, cannot operate the
          original account from the app, although the account accepts it. See{" "}
          <A href="/docs/guides/recovery">Recovery and guardians</A>.
        </li>
        <li>
          <strong>A passkey can return a different PRF secret through another route.</strong> Some password managers
          answer the same passkey with another secret through a phone's QR code than on the device itself, and another
          secret opens other accounts. The app remembers the secret each passkey returned in a browser and refuses a
          different one there, but a browser that has never seen the passkey cannot tell. Use the same route every time.
        </li>
        <li>
          <strong>Secure Payment Confirmation</strong> works only in Chromium (macOS, Windows, Android), and its enrollment
          belongs to one browser profile. Requiring the sheet therefore limits payments to the browsers where the passkey is
          enrolled for it. Elsewhere the app uses the ordinary passkey prompt.
        </li>
        <li>
          <strong>The ERC-7579 validator enforces no spending policy.</strong> Pair it with a policy or hook module.
        </li>
        <li>
          <strong>Validator gas.</strong> A valid proof needs about 732k gas inside the module and bundler estimates are too
          low, so set <code>verificationGasLimit</code> yourself; the SDK exports <code>VALIDATOR_VERIFICATION_GAS</code>.
        </li>
        <li>
          <strong>Proving on iPhone has not been measured yet.</strong> Desktop Chrome takes 1.85 s.
        </li>
      </ul>

      <H2>Dependencies</H2>
      <Table
        head={["Component", "Version", "Note"]}
        rows={[
          ["Noir", "1.0.0-beta.25", "The circuits and witness generation"],
          ["Barretenberg (bb, bb.js)", "5.2.0", "UltraHonk proving and the generated verifiers"],
          ["stylus-sdk", "0.9.0 (pinned)", "The Stylus account and factory"],
          ["openzeppelin-stylus", "0.3.0 (pinned)", "SafeErc20 for USDG transfers"],
          ["ruint", "1.16.0 (pinned)", "Two advisories, see below"],
        ]}
      />
      <p>
        <code>ruint</code> 1.16.0 has two advisories: RUSTSEC-2026-0220 (shift operations with incorrect overflow flags) and
        RUSTSEC-2025-0137 (an unsound <code>reciprocal_mg10</code>). VeraKey pins 1.16.0 because stylus-sdk 0.9.0 fails
        const evaluation with ruint 1.17 or later. VeraKey's code uses no <code>Uint</code> shifts and no <code>U256</code>{" "}
        division; the shifts it does use are on <code>u8</code> and <code>u32</code>. The fix is the migration to stylus-sdk
        0.10, on the roadmap.
      </p>
      <p>
        A dependency audit also lists four unmaintained Rust macro crates, used only when building. The JavaScript
        dependencies had no known vulnerabilities on 2026-09-29.
      </p>

      <H2>Report a vulnerability</H2>
      <p>
        Please report vulnerabilities privately to <Contact />, and do not disclose them publicly before they are fixed.
      </p>
      <p>A useful report includes:</p>
      <ul>
        <li>the component: a circuit, a contract, the SDK, the relayer or the app;</li>
        <li>the network and the contract addresses involved;</li>
        <li>the steps to reproduce it, and what an attacker gains.</li>
      </ul>
    </>
  );
}
