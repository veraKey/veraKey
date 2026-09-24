import { A, Address, Callout, Code, H2 } from "../../components";

export default function FundGuide() {
  return (
    <>
      <H2>Demo USDG</H2>
      <p>
        On the Accounts page, select <strong>Demo USDG</strong> on an account card. The demo faucet sends 5 USDG to that
        account, once per account, for up to 3 accounts per visitor per day. If the account is not deployed yet, it is
        deployed first.
      </p>
      <p>
        The faucet pays from the relayer's treasury of Paxos USDG test tokens on Arbitrum Sepolia (
        <Address value="0xFFC95faa3d63Cde504a05B567C600B78C0b41892" />). When the treasury runs out, the app says "The
        demo faucet is out of USDG. Try again later."
      </p>
      <Callout kind="tip" title="Faucet empty?">
        Claim test USDG at <A href="https://faucet.paxos.com">faucet.paxos.com</A> for Arbitrum Sepolia and send it to
        your account's address. Payments to the demo merchant go back to the faucet treasury for the next visitor.
      </Callout>

      <H2>Receive a payment</H2>
      <p>
        Select <strong>Receive</strong> on an account card. The Receive panel shows the account's address, a{" "}
        <strong>Copy address</strong> button and a QR code. The QR code is an EIP-681 payment link, which wallets that
        support it open as a USDG transfer to your account:
      </p>
      <Code lang="text" title="EIP-681 link">{`
ethereum:<USDG token>@<chain id>/transfer?address=<your account>
`}</Code>
      <p>
        Only send USDG on Arbitrum Sepolia to a VeraKey demo account. Tokens sent on another network, or other tokens,
        cannot be spent by the account.
      </p>

      <H2>Fund without linking your accounts</H2>
      <p>
        Your accounts share nothing on-chain, but money can still connect them. If you top up your Pay account and your
        Shop account from the same wallet, anyone can see that one wallet funded both.
      </p>
      <ul>
        <li>Receive income directly into the account that will spend it: ask the payer to send to that account.</li>
        <li>Do not move funds between your own accounts in different apps.</li>
        <li>
          On mainnet, top up through a privacy pool with association sets, such as 0xbow Privacy Pools or Railgun on
          Arbitrum One. Neither runs on Arbitrum Sepolia, so the demo cannot show this.
        </li>
      </ul>
      <Callout kind="note">
        VeraKey is unlinkable, not anonymous: each account's own history is public. See{" "}
        <A href="/docs/problem#unlinkable-not-anonymous">what stays public</A>.
      </Callout>
    </>
  );
}
