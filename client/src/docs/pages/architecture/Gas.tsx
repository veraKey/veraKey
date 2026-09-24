import { Callout, H2, Repository, Table } from "../../components";

export default function GasPage() {
  return (
    <>
      <H2>Measured costs</H2>
      <p>
        Measured on 2026-09-24 on a local nitro devnode (nitro-node v3.11.4, ArbOS 61), with both Stylus programs cached
        and real proofs.
      </p>
      <Table
        head={["Operation", "Gas"]}
        rows={[
          [<code key="1">pay</code>, "1,043,768 for a first payment to a new recipient"],
          [<code key="2">pay</code>, "988,934 to a recipient paid before"],
          [<code key="3">pay</code>, "994,246 through the payment sheet, to a recipient paid before (256 more bytes of client data)"],
          [<code key="4">pay</code>, "1,021,759 from the app in Chrome, through the relayer, to the demo merchant"],
          [<code key="5">restrict</code>, "979,007 to lower the caps"],
          [<code key="6">restrict</code>, "1,021,974 for a freeze that cancels 8 scheduled changes"],
          [<code key="7">createAccount</code>, "383,296 (EIP-1167 clone and storage initialization)"],
          ["P256VERIFY precompile, for comparison (no privacy)", "3,450"],
        ]}
      />
      <p>
        On Arbitrum One, at a gas price of 0.02 gwei and ETH at $2,668 (both read on 2026-09-24), a payment costs about
        $0.05 to $0.06. The proof's calldata adds about $0.002 of L1 data fee.
      </p>

      <H2>Where a payment spends its gas</H2>
      <p>A first payment to a new recipient, traced with <code>debug_traceTransaction</code>:</p>
      <Table
        head={["Part", "Gas"]}
        rows={[
          ["Transaction total (9,220 bytes of calldata)", "1,043,768"],
          ["Intrinsic, calldata and the EIP-1167 proxy", "about 166,294"],
          ["HonkVerifier.verify (Solidity, optimized)", "712,554"],
          ["USDG transfer to the recipient (a new balance slot)", "30,174"],
          ["USDG transfer of the fee", "8,274"],
          ["Account logic: client data checks, nonce, caps, events", "about 126,352"],
          ["SHA-256 of the client data (precompile)", "120"],
        ]}
      />
      <p>
        Inside the verifier, the elliptic-curve precompiles take about 463,550 gas: 57 <code>ecMul</code>, 57{" "}
        <code>ecAdd</code> and one 2-pair <code>ecPairing</code>. Field arithmetic and the keccak transcript take about
        237k, and three batched <code>modexp</code> inversions take 12,144.
      </p>

      <H2>Before and after</H2>
      <Table
        head={["", "bb default verifier", "bb 5.2.0 optimized", "+ packed storage, cached programs"]}
        rows={[
          ["Circuit", "81,605 gates (2^17)", "56,528 gates (2^16)", "same"],
          ["Proof", "9,152 bytes", "8,768 bytes", "same"],
          ["HonkVerifier.verify", "3,781,398", "712,554", "712,554"],
          ["pay from the app to the demo merchant", "4,171,302", "1,073,882", "1,021,759"],
          ["That payment on Arbitrum One", "≈ $0.22", "≈ $0.06", "≈ $0.05"],
          ["createAccount", "about 479,000", "about 479,000", "383,296"],
        ]}
      />
      <p>
        The last column also adds the new-recipient cap, the fee limit, the payment sheet check and the on-chain list of
        scheduled changes, and is still cheaper.
      </p>

      <H2>Proving time</H2>
      <ul>
        <li>1.85 s (median of 3) in headless desktop Chrome with 8 threads.</li>
        <li>Multithreading needs cross-origin isolation; the app serves the COOP and COEP headers.</li>
        <li>The first proof also downloads bb.js and two 4 MiB CRS files, which the app serves from its own origin.</li>
        <li>Proving on iPhone has not been measured yet.</li>
      </ul>

      <H2>What is left</H2>
      <ul>
        <li>The elliptic-curve precompiles (65% of verification) have fixed prices: a Stylus verifier could not make them cheaper.</li>
        <li>Field arithmetic and the keccak transcript (about 237k gas) are the part a Stylus verifier could still reduce.</li>
        <li>Calldata costs about 144k gas for the proof and the client data.</li>
        <li>A clone with immutable arguments would remove most of <code>createAccount</code>'s storage writes.</li>
      </ul>
      <Callout kind="note">
        The full analysis, with the call trace, is in <code>docs/GAS.md</code> in <Repository />.
      </Callout>
    </>
  );
}
