import { A, Callout, Code, H2, Table } from "../../components";

export default function ValidatorPage() {
  return (
    <>
      <H2>What the module does</H2>
      <p>
        <code>VeraKeyValidator</code> is an ERC-7579 validator
        module (type 1). It lets a modular smart account accept VeraKey proofs, so a passkey can control it through a
        per-app nullifier, without its public key ever reaching the chain.
      </p>
      <p>
        One deployment serves one relying party: the verifier, the rpId hash and the origin are fixed in its constructor.
        Each account that installs it stores its own <code>appId</code> and <code>nullifier</code>.
      </p>
      <Callout kind="note" title="What is tested">
        The module is tested with real proofs (36 tests), and it runs in a ZeroDev Kernel v3.3 account on
        Arbitrum Sepolia: that account was created with <code>VeraKeyValidator</code> as its root validator, and its first
        user operation, a 1 USDG payment, was authorized by a proof (<A href="https://arbitrum-sepolia.blockscout.com/tx/0x0f617b9b889c61f9322206631cdab1c5d207fc1a95b1f97a0bfc54c8ddf92fc3">transaction</A>). It has not
        been tried in a Nexus account yet.
      </Callout>

      <H2>Install it</H2>
      <Code lang="ts">{`
import { validatorInstallData } from "@verakey/sdk/validator";

const initData = validatorInstallData(appIdHex, nullifierHex); // abi.encode(bytes32 appId, bytes32 nullifier)
// then, from the account: installModule(1, validatorAddress, initData)
`}</Code>
      <p>
        <code>onInstall</code> refuses a second install, and values that are not BN254 field elements or a zero nullifier.{" "}
        <code>onUninstall</code> never reverts, so the module can never block its own removal.
      </p>

      <H2>Sign a user operation</H2>
      <p>The passkey signs the userOpHash; the browser proves the assertion; the signature carries the proof and the client data:</p>
      <Code lang="ts">{`
import { bytesToHex, hexToBytes } from "@verakey/sdk/bytes";
import { credentialIdBytes } from "@verakey/sdk/store";
import { validatorSignature, VALIDATOR_VERIFICATION_GAS } from "@verakey/sdk/validator";
import { getAssertion } from "@verakey/sdk/webauthn";

userOp.verificationGasLimit = VALIDATOR_VERIFICATION_GAS + accountOverhead; // set the gas limits first: they are part of the userOpHash
const assertion = await getAssertion({ rpId, challenge: hexToBytes(userOpHash), credentialIds: [credentialIdBytes(passkey)] });
const { proof } = await prover.prove({
  publicKey, prfSecret, appId, nullifier, rpIdHash: hexToBytes(rpIdHash),
  signature: assertion.signature, authenticatorData: assertion.authenticatorData, clientDataJSON: assertion.clientDataJSON,
});
userOp.signature = validatorSignature(proof, bytesToHex(assertion.clientDataJSON)); // abi.encode(bytes proof, bytes clientDataJSON)
`}</Code>
      <p>
        <code>validateUserOp</code> returns 0 when the proof authorizes the userOpHash for the calling account, and 1
        (<code>SIG_VALIDATION_FAILED</code>) otherwise. It never reverts on a bad signature, and it refuses a user operation
        whose sender is not the calling account.
      </p>

      <H2>ZeroDev Kernel</H2>
      <p>
        With ZeroDev's SDK, VeraKey's plugin becomes a Kernel account's sudo validator: <code>createKernelAccount</code>{" "}
        sets up the account so that its first user operation deploys it with <code>VeraKeyValidator</code> installed for
        the owner's nullifier, and every user operation the account signs asks the passkey to sign its userOpHash and the
        browser to prove it.
      </p>
      <Code lang="ts">{`
import { createKernelAccount } from "@zerodev/sdk";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import { toVeraKeyKernelValidator } from "@verakey/sdk/kernel";

const sudo = toVeraKeyKernelValidator({
  validator: VERAKEY_VALIDATOR, // see Deployments
  chainId: 421614,
  appId,                        // the app's id and the owner's nullifier in it (32-byte hex)
  nullifier,
  prove: async (userOpHash) => {
    const assertion = await getAssertion({ rpId, challenge: hexToBytes(userOpHash), credentialIds: [credentialIdBytes(passkey)] });
    const { proof } = await prover.prove({ /* as above, with appId: BigInt(appId), nullifier: BigInt(nullifier) */ });
    return { proof, clientDataJSON: bytesToHex(assertion.clientDataJSON) };
  },
});
const account = await createKernelAccount(publicClient, {
  entryPoint: getEntryPoint("0.7"),
  kernelVersion: KERNEL_V3_3,
  plugins: { sudo },
});
`}</Code>
      <p>
        Send the account's user operations through any ERC-4337 bundler for EntryPoint v0.7. On Arbitrum Sepolia,
        VeraKey's relayer bundled the first one itself (<code>EntryPoint.handleOps</code>): it deployed the account and
        paid 1 USDG. The plugin signs user operations only; it refuses ERC-1271 messages for now.
      </p>

      <H2>ERC-1271 signatures</H2>
      <p>
        For <code>isValidSignatureWithSender</code>, the passkey never signs the raw hash. It signs a challenge that binds
        the chain and the account:
      </p>
      <Code lang="ts">{`
import { validatorErc1271Challenge } from "@verakey/sdk/validator";

const challenge = validatorErc1271Challenge(account, hash, chainId);
// = keccak256(abi.encode(keccak256("VeraKeyERC1271(uint256 chainId,address account,bytes32 hash)"), chainId, account, hash))
`}</Code>
      <p>
        A nullifier is public, so two accounts could install the same one. Binding the account means a signature made for
        one cannot be replayed to the other. The function returns <code>0x1626ba7e</code> for a valid proof and{" "}
        <code>0xffffffff</code> otherwise.
      </p>

      <H2>Gas</H2>
      <Table
        head={["", "Gas"]}
        rows={[
          ["Verifying a valid proof inside the module", "about 732,000"],
          [<code key="1">VALIDATOR_VERIFICATION_GAS</code>, "850,000, to set as the module's share of verificationGasLimit"],
          ["A Kernel v3.3 account's first user operation on Arbitrum Sepolia (deploys it, pays 1 USDG)", "1,218,222 used, with verificationGasLimit 1,700,000"],
        ]}
      />
      <p>
        Set <code>verificationGasLimit</code> yourself. With too little gas, the module returns{" "}
        <code>SIG_VALIDATION_FAILED</code> instead of running out of gas, so bundler estimates made with a dummy signature
        come out far too low.
      </p>

      <H2>Limits</H2>
      <ul>
        <li>The module checks who approved, not what: it enforces no caps. Pair it with a policy or hook module.</li>
        <li>One deployment accepts one origin and rpId. Other relying parties deploy their own.</li>
        <li>
          The Arbitrum Sepolia deployment is listed in <A href="/docs/reference/deployments">Deployments</A>, and its
          source is verified on Sourcify.
        </li>
      </ul>
    </>
  );
}
