// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {HonkVerifier} from "../src/HonkVerifier.sol";
import {IModule, PackedUserOperation, VeraKeyValidator} from "../src/modules/VeraKeyValidator.sol";
import {DeployValidator} from "../script/DeployValidator.s.sol";

/// @dev The Foundry cheatcodes these tests use (the repo does not vendor forge-std).
interface Vm {
    function readFile(string calldata path) external view returns (string memory);
    function parseJsonBytes(string calldata json, string calldata key) external pure returns (bytes memory);
    function parseJsonBytes32(string calldata json, string calldata key) external pure returns (bytes32);
    function parseJsonBytes32Array(string calldata json, string calldata key) external pure returns (bytes32[] memory);
    function parseJsonString(string calldata json, string calldata key) external pure returns (string memory);
    function parseJsonAddress(string calldata json, string calldata key) external pure returns (address);
    function parseJsonUint(string calldata json, string calldata key) external pure returns (uint256);
    function prank(address msgSender) external;
    function cool(address target) external;
    function chainId(uint256 newChainId) external;
}

/// @dev Exposes the validator's internal checks to unit tests.
contract VeraKeyValidatorHarness is VeraKeyValidator {
    constructor(address honkVerifier, bytes32 relyingPartyIdHash, string memory webOrigin)
        VeraKeyValidator(honkVerifier, relyingPartyIdHash, webOrigin)
    {}

    function checkClientData(bytes calldata clientDataJson, bytes32 challenge) external view returns (bool) {
        return _checkClientData(clientDataJson, challenge);
    }

    function base64Url(bytes32 value) external pure returns (bytes memory) {
        (bytes32 head, bytes11 tail) = _base64Url(value);
        return abi.encodePacked(head, tail);
    }

    function decodeSignature(bytes calldata signature)
        external
        pure
        returns (bool ok, bytes memory proof, bytes memory clientDataJson)
    {
        (ok, proof, clientDataJson) = _decodeSignature(signature);
    }

    function publicInputs(bytes calldata clientDataJson, bytes32 appId, bytes32 nullifier)
        external
        view
        returns (bytes32[] memory)
    {
        return _publicInputs(clientDataJson, appId, nullifier);
    }
}

/// @dev A verifier that answers false. The real HonkVerifier reverts instead, but the validator must
/// not rely on that.
contract FalseVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return false;
    }
}

/// @dev A verifier that reverts with a large payload.
contract RevertingVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        revert(string(new bytes(4096)));
    }
}

/// @notice VeraKeyValidator against the repo's HonkVerifier, with real UltraHonk proofs from
/// test/fixtures/validator-proof.json (packages/sdk/scripts/gen-validator-fixture.mts).
contract VeraKeyValidatorTest {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CONSOLE = 0x000000000000000000636F6e736F6c652e6c6f67;
    string private constant FIXTURE = "test/fixtures/validator-proof.json";

    uint256 private constant BN254_R = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
    uint256 private constant VALID = 0;
    uint256 private constant SIG_VALIDATION_FAILED = 1;
    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 private constant ERC1271_INVALID = 0xffffffff;

    address private constant ACCOUNT = address(0xA11CE);
    address private constant OTHER_ACCOUNT = address(0xB0B);

    string private json;
    HonkVerifier private verifier;
    VeraKeyValidator private validator;
    VeraKeyValidatorHarness private harness;

    bytes32 private rpIdHash;
    string private origin;
    bytes32 private appId;
    bytes32 private otherAppId;
    bytes32 private nullifier;
    bytes32 private otherNullifier;
    bytes32 private userOpHash;
    bytes private proof;
    bytes private clientDataJson;
    bytes private signature;
    bytes32 private erc1271Hash;
    bytes private erc1271Proof;
    bytes private erc1271Signature;

    function setUp() public {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        json = VM.readFile(FIXTURE);
        rpIdHash = VM.parseJsonBytes32(json, ".rpIdHash");
        origin = VM.parseJsonString(json, ".origin");
        appId = VM.parseJsonBytes32(json, ".appId");
        otherAppId = VM.parseJsonBytes32(json, ".otherAppId");
        nullifier = VM.parseJsonBytes32(json, ".nullifier");
        otherNullifier = VM.parseJsonBytes32(json, ".otherNullifier");
        userOpHash = VM.parseJsonBytes32(json, ".userOpHash");
        proof = VM.parseJsonBytes(json, ".proof");
        clientDataJson = VM.parseJsonBytes(json, ".clientDataJSON");
        signature = abi.encode(proof, clientDataJson);
        // The ERC-1271 proof signs erc1271Challenge(ACCOUNT, erc1271Hash) on the fixture's chain id.
        require(VM.parseJsonAddress(json, ".erc1271.account") == ACCOUNT, "fixture account");
        VM.chainId(VM.parseJsonUint(json, ".erc1271.chainId"));
        erc1271Hash = VM.parseJsonBytes32(json, ".erc1271.hash");
        erc1271Proof = VM.parseJsonBytes(json, ".erc1271.proof");
        erc1271Signature = abi.encode(erc1271Proof, VM.parseJsonBytes(json, ".erc1271.clientDataJSON"));

        verifier = new HonkVerifier();
        validator = new VeraKeyValidator(address(verifier), rpIdHash, origin);
        harness = new VeraKeyValidatorHarness(address(verifier), rpIdHash, origin);
    }

    // ---------------------------------------------------------------------------------------------
    // Module lifecycle
    // ---------------------------------------------------------------------------------------------

    function test_IsModuleTypeValidatorOnly() public view {
        require(validator.isModuleType(1), "validator type");
        for (uint256 moduleType; moduleType < 8; ++moduleType) {
            if (moduleType != 1) require(!validator.isModuleType(moduleType), "only type 1");
        }
    }

    function test_Views() public view {
        require(validator.verifier() == address(verifier), "verifier");
        require(validator.rpIdHash() == rpIdHash, "rpIdHash");
        require(validator.rpIdHash() == sha256("verakey.test"), "rpIdHash is sha256(rpId)");
        require(validator.originHash() == keccak256(bytes(origin)), "originHash");
        require(validator.originLength() == bytes(origin).length, "originLength");
    }

    function test_InstallStoresConfigPerAccount() public {
        require(!validator.isInitialized(ACCOUNT), "fresh account");
        _install(ACCOUNT, appId, nullifier);
        require(validator.isInitialized(ACCOUNT), "installed");
        require(!validator.isInitialized(OTHER_ACCOUNT), "other account untouched");
        (bytes32 storedAppId, bytes32 storedNullifier) = validator.accountConfig(ACCOUNT);
        require(storedAppId == appId && storedNullifier == nullifier, "stored config");
    }

    function test_InstallTwiceReverts() public {
        _install(ACCOUNT, appId, nullifier);
        _expectInstallRevert(
            ACCOUNT,
            abi.encode(appId, otherNullifier),
            abi.encodeWithSelector(IModule.AlreadyInitialized.selector, ACCOUNT)
        );
        (, bytes32 storedNullifier) = validator.accountConfig(ACCOUNT);
        require(storedNullifier == nullifier, "config unchanged");
    }

    function test_InstallRejectsNonFieldAppId() public {
        bytes memory invalidConfig = abi.encodeWithSelector(VeraKeyValidator.InvalidConfig.selector);
        _expectInstallRevert(ACCOUNT, abi.encode(bytes32(BN254_R), nullifier), invalidConfig);
        _expectInstallRevert(ACCOUNT, abi.encode(bytes32(BN254_R + 1), nullifier), invalidConfig);
        _expectInstallRevert(ACCOUNT, abi.encode(bytes32(type(uint256).max), nullifier), invalidConfig);
        require(!validator.isInitialized(ACCOUNT), "nothing installed");
        // The largest field element is accepted.
        _install(ACCOUNT, bytes32(BN254_R - 1), nullifier);
        require(validator.isInitialized(ACCOUNT), "r - 1 is a field element");
    }

    function test_InstallRejectsBadNullifierOrEncoding() public {
        bytes memory invalidConfig = abi.encodeWithSelector(VeraKeyValidator.InvalidConfig.selector);
        _expectInstallRevert(ACCOUNT, abi.encode(appId, bytes32(0)), invalidConfig);
        _expectInstallRevert(ACCOUNT, abi.encode(appId, bytes32(BN254_R)), invalidConfig);
        _expectInstallRevert(ACCOUNT, abi.encode(appId, bytes32(type(uint256).max)), invalidConfig);
        _expectInstallRevert(ACCOUNT, "", invalidConfig);
        _expectInstallRevert(ACCOUNT, abi.encode(appId), invalidConfig);
        _expectInstallRevert(ACCOUNT, abi.encode(appId, nullifier, uint256(0)), invalidConfig);
        require(!validator.isInitialized(ACCOUNT), "nothing installed");
    }

    function test_UninstallClearsConfigAndIsIdempotent() public {
        _install(ACCOUNT, appId, nullifier);
        _install(OTHER_ACCOUNT, appId, otherNullifier);
        VM.prank(ACCOUNT);
        validator.onUninstall("");
        require(!validator.isInitialized(ACCOUNT), "uninstalled");
        require(validator.isInitialized(OTHER_ACCOUNT), "other account keeps its config");
        (bytes32 storedAppId, bytes32 storedNullifier) = validator.accountConfig(ACCOUNT);
        require(storedAppId == 0 && storedNullifier == 0, "config cleared");
        require(_validate(ACCOUNT, userOpHash, signature) == SIG_VALIDATION_FAILED, "uninstalled account fails");

        // Uninstalling again does not revert, so the module can never block its own removal.
        VM.prank(ACCOUNT);
        validator.onUninstall("");

        // Reinstalling restores validation.
        _install(ACCOUNT, appId, nullifier);
        require(_validate(ACCOUNT, userOpHash, signature) == VALID, "reinstalled account validates");
    }

    // ---------------------------------------------------------------------------------------------
    // Valid proofs
    // ---------------------------------------------------------------------------------------------

    function test_ValidUserOpReturnsZero() public {
        _install(ACCOUNT, appId, nullifier);
        PackedUserOperation memory op = _userOp(ACCOUNT, signature);
        VM.cool(address(validator));
        VM.cool(address(verifier));
        VM.prank(ACCOUNT);
        uint256 start = gasleft();
        uint256 result = validator.validateUserOp(op, userOpHash);
        uint256 used = start - gasleft();
        require(result == VALID, "valid user operation");
        _log("gas: validateUserOp, valid proof (cold, incl. call overhead)", used);
    }

    function test_ValidLevel1ClientDataReturnsZero() public {
        _install(ACCOUNT, appId, nullifier);
        (bytes memory level1,) = _variant("level1");
        require(_validate(ACCOUNT, userOpHash, level1) == VALID, "`}` right after the origin");
    }

    function test_Erc1271ValidReturnsMagic() public {
        _install(ACCOUNT, appId, nullifier);
        bytes memory sig = erc1271Signature;
        VM.cool(address(validator));
        VM.cool(address(verifier));
        VM.prank(ACCOUNT);
        uint256 start = gasleft();
        bytes4 result = validator.isValidSignatureWithSender(address(this), erc1271Hash, sig);
        uint256 used = start - gasleft();
        require(result == ERC1271_MAGIC_VALUE, "ERC-1271 magic value");
        _log("gas: isValidSignatureWithSender, valid proof (cold, incl. call overhead)", used);
    }

    function test_Erc1271ChallengeMatchesSdk() public view {
        bytes32 typehash = keccak256("VeraKeyERC1271(uint256 chainId,address account,bytes32 hash)");
        require(validator.ERC1271_TYPEHASH() == typehash, "typehash");
        require(VM.parseJsonBytes32(json, ".erc1271.typehash") == typehash, "SDK typehash");
        bytes32 challenge = validator.erc1271Challenge(ACCOUNT, erc1271Hash);
        require(challenge == keccak256(abi.encode(typehash, block.chainid, ACCOUNT, erc1271Hash)), "encoding");
        require(challenge == VM.parseJsonBytes32(json, ".erc1271.challenge"), "SDK challenge");
        // The passkey signed the bound challenge, not the hash.
        bytes memory signedClientData = VM.parseJsonBytes(json, ".erc1271.clientDataJSON");
        require(keccak256(_slice(signedClientData, 36, 79)) == keccak256(harness.base64Url(challenge)), "signed");
        require(harness.checkClientData(signedClientData, challenge), "clientDataJSON for the challenge");
        require(!harness.checkClientData(signedClientData, erc1271Hash), "not for the raw hash");
    }

    function test_Erc1271RejectsProofOverRawHash() public {
        _install(ACCOUNT, appId, nullifier);
        // The top-level proof signs userOpHash itself: a valid user operation signature, and what the
        // unbound ERC-1271 check used to accept for hash = userOpHash.
        require(_validate(ACCOUNT, userOpHash, signature) == VALID, "valid as a user operation");
        require(_isValidSignature(ACCOUNT, userOpHash, signature) == ERC1271_INVALID, "raw hash");
        // An ERC-1271 signature cannot authorize a user operation either, whatever hash it names.
        require(_validate(ACCOUNT, erc1271Hash, erc1271Signature) == SIG_VALIDATION_FAILED, "1271 proof as userOp");
    }

    function test_Erc1271RejectsOtherAccountWithSameNullifier() public {
        // Account B installs account A's owner, which anyone can do since nullifiers are public.
        _install(ACCOUNT, appId, nullifier);
        _install(OTHER_ACCOUNT, appId, nullifier);
        require(_isValidSignature(ACCOUNT, erc1271Hash, erc1271Signature) == ERC1271_MAGIC_VALUE, "account A");
        require(_isValidSignature(OTHER_ACCOUNT, erc1271Hash, erc1271Signature) == ERC1271_INVALID, "account B");
    }

    function test_Erc1271RejectsOtherChain() public {
        _install(ACCOUNT, appId, nullifier);
        uint256 fixtureChainId = block.chainid;
        VM.chainId(42161);
        require(_isValidSignature(ACCOUNT, erc1271Hash, erc1271Signature) == ERC1271_INVALID, "other chain");
        VM.chainId(fixtureChainId);
        require(_isValidSignature(ACCOUNT, erc1271Hash, erc1271Signature) == ERC1271_MAGIC_VALUE, "fixture chain");
    }

    function test_Erc1271UsesCallerConfigNotSenderArgument() public {
        _install(ACCOUNT, appId, nullifier);
        // `sender` (the ERC-1271 caller) does not matter; the calling account's config does.
        VM.prank(ACCOUNT);
        require(
            validator.isValidSignatureWithSender(OTHER_ACCOUNT, erc1271Hash, erc1271Signature) == ERC1271_MAGIC_VALUE,
            "any ERC-1271 sender"
        );
        VM.prank(OTHER_ACCOUNT);
        require(
            validator.isValidSignatureWithSender(ACCOUNT, erc1271Hash, erc1271Signature) == ERC1271_INVALID,
            "uninstalled caller"
        );
        require(_isValidSignature(ACCOUNT, ~erc1271Hash, erc1271Signature) == ERC1271_INVALID, "other hash");
    }

    function test_VerifierAcceptsEveryFixtureProof() public view {
        require(verifier.verify(proof, VM.parseJsonBytes32Array(json, ".publicInputs")), "top-level proof");
        string[4] memory names = ["level1", "crossOrigin", "wrongOrigin", "prefixOrigin"];
        for (uint256 i; i < names.length; ++i) {
            (bytes memory sig, bytes32[] memory inputs) = _variant(names[i]);
            (bytes memory variantProof,) = abi.decode(sig, (bytes, bytes));
            require(verifier.verify(variantProof, inputs), names[i]);
        }
        require(verifier.verify(erc1271Proof, VM.parseJsonBytes32Array(json, ".erc1271.publicInputs")), "erc1271");
    }

    function test_PublicInputsMatchSdk() public view {
        bytes32[] memory expected = VM.parseJsonBytes32Array(json, ".publicInputs");
        _requireEqual(harness.publicInputs(clientDataJson, appId, nullifier), expected, "top-level inputs");
        string[4] memory names = ["level1", "crossOrigin", "wrongOrigin", "prefixOrigin"];
        for (uint256 i; i < names.length; ++i) {
            (bytes memory sig, bytes32[] memory inputs) = _variant(names[i]);
            (, bytes memory variantClientData) = abi.decode(sig, (bytes, bytes));
            _requireEqual(harness.publicInputs(variantClientData, appId, nullifier), inputs, names[i]);
        }
        _requireEqual(
            harness.publicInputs(VM.parseJsonBytes(json, ".erc1271.clientDataJSON"), appId, nullifier),
            VM.parseJsonBytes32Array(json, ".erc1271.publicInputs"),
            "erc1271 inputs"
        );
    }

    // ---------------------------------------------------------------------------------------------
    // Rejections
    // ---------------------------------------------------------------------------------------------

    function test_TamperedProofFails() public {
        _install(ACCOUNT, appId, nullifier);
        uint256[5] memory positions = [uint256(0x1f), 200, 0x400, proof.length / 2, proof.length - 1];
        for (uint256 i; i < positions.length; ++i) {
            bytes memory sig = abi.encode(_flip(proof, positions[i]), clientDataJson);
            require(_validate(ACCOUNT, userOpHash, sig) == SIG_VALIDATION_FAILED, "tampered proof");
            (, bytes memory erc1271ClientData) = abi.decode(erc1271Signature, (bytes, bytes));
            sig = abi.encode(_flip(erc1271Proof, positions[i]), erc1271ClientData);
            require(_isValidSignature(ACCOUNT, erc1271Hash, sig) == ERC1271_INVALID, "tampered proof (1271)");
        }
    }

    function test_FailsClosedWithinARealisticGasBudget() public {
        _install(ACCOUNT, appId, nullifier);
        VM.prank(ACCOUNT);
        require(
            validator.validateUserOp{gas: 1_000_000}(_userOp(ACCOUNT, signature), userOpHash) == VALID,
            "a valid proof fits in 1M gas"
        );
        // The last byte belongs to the KZG quotient commitment. Flipping it gives an invalid G1 point, and
        // the failing EC precompile consumes all the gas the verifier forwards to it. The 1/64 that the
        // validator keeps back from the verifier call still covers returning SIG_VALIDATION_FAILED.
        bytes memory sig = abi.encode(_flip(proof, proof.length - 1), clientDataJson);
        VM.prank(ACCOUNT);
        require(
            validator.validateUserOp{gas: 1_000_000}(_userOp(ACCOUNT, sig), userOpHash) == SIG_VALIDATION_FAILED,
            "gas-burning proof fails without reverting"
        );
        // Too little gas for the verifier also fails closed, instead of reverting.
        VM.prank(ACCOUNT);
        require(
            validator.validateUserOp{gas: 600_000}(_userOp(ACCOUNT, signature), userOpHash) == SIG_VALIDATION_FAILED,
            "under-provisioned validation"
        );
    }

    function test_TamperedClientDataFails() public {
        _install(ACCOUNT, appId, nullifier);
        // Flip the last byte ('}' -> '|'): the parser rejects it before the proof is checked.
        bytes memory sig = abi.encode(proof, _flip(clientDataJson, clientDataJson.length - 1));
        require(_validate(ACCOUNT, userOpHash, sig) == SIG_VALIDATION_FAILED, "tampered clientDataJSON");
        // Change "false" to "fals ": the parser accepts it, the proof's clientDataJSON hash does not match.
        bytes memory edited = bytes.concat(clientDataJson);
        edited[edited.length - 2] = " ";
        require(harness.checkClientData(edited, userOpHash), "parser alone accepts the edit");
        require(
            _validate(ACCOUNT, userOpHash, abi.encode(proof, edited)) == SIG_VALIDATION_FAILED,
            "proof binds sha256(clientDataJSON)"
        );
    }

    function test_WrongUserOpHashFails() public {
        _install(ACCOUNT, appId, nullifier);
        require(_validate(ACCOUNT, userOpHash ^ bytes32(uint256(1)), signature) == SIG_VALIDATION_FAILED, "flip");
        require(_validate(ACCOUNT, bytes32(0), signature) == SIG_VALIDATION_FAILED, "zero hash");
        require(_validate(ACCOUNT, keccak256("another op"), signature) == SIG_VALIDATION_FAILED, "other hash");
    }

    function test_WrongOriginFailsDespiteValidProof() public {
        _install(ACCOUNT, appId, nullifier);
        string[2] memory names = ["wrongOrigin", "prefixOrigin"];
        string[2] memory origins = ["https://evil.verakey.test", "https://verakey.test:8443"];
        for (uint256 i; i < names.length; ++i) {
            (bytes memory sig, bytes32[] memory inputs) = _variant(names[i]);
            (bytes memory variantProof, bytes memory variantClientData) = abi.decode(sig, (bytes, bytes));
            require(verifier.verify(variantProof, inputs), "the proof itself is valid");
            require(!harness.checkClientData(variantClientData, userOpHash), "parser rejects the origin");
            require(_validate(ACCOUNT, userOpHash, sig) == SIG_VALIDATION_FAILED, names[i]);

            // Control: a deployment configured for that origin accepts the same assertion.
            VeraKeyValidator forOrigin = new VeraKeyValidator(address(verifier), rpIdHash, origins[i]);
            VM.prank(ACCOUNT);
            forOrigin.onInstall(abi.encode(appId, nullifier));
            VM.prank(ACCOUNT);
            require(forOrigin.validateUserOp(_userOp(ACCOUNT, sig), userOpHash) == VALID, "control");
        }

        // A deployment for another origin of the same length rejects the fixture's valid assertion, so
        // the origin bytes are compared, not just the position of the closing quote.
        VeraKeyValidator sameLength = new VeraKeyValidator(address(verifier), rpIdHash, "https://evilkey.test");
        require(bytes("https://evilkey.test").length == bytes(origin).length, "same length");
        VM.prank(ACCOUNT);
        sameLength.onInstall(abi.encode(appId, nullifier));
        VM.prank(ACCOUNT);
        require(
            sameLength.validateUserOp(_userOp(ACCOUNT, signature), userOpHash) == SIG_VALIDATION_FAILED,
            "same-length origin"
        );
    }

    function test_CrossOriginFailsDespiteValidProof() public {
        _install(ACCOUNT, appId, nullifier);
        (bytes memory sig, bytes32[] memory inputs) = _variant("crossOrigin");
        (bytes memory variantProof, bytes memory variantClientData) = abi.decode(sig, (bytes, bytes));
        require(verifier.verify(variantProof, inputs), "the proof itself is valid");
        require(!harness.checkClientData(variantClientData, userOpHash), "parser rejects crossOrigin:true");
        require(_validate(ACCOUNT, userOpHash, sig) == SIG_VALIDATION_FAILED, "crossOrigin:true");
    }

    function test_OtherNullifierInstalledFails() public {
        _install(ACCOUNT, appId, otherNullifier);
        require(_validate(ACCOUNT, userOpHash, signature) == SIG_VALIDATION_FAILED, "other owner");
        require(_isValidSignature(ACCOUNT, erc1271Hash, erc1271Signature) == ERC1271_INVALID, "other owner (1271)");
    }

    function test_OtherAppIdInstalledFails() public {
        _install(ACCOUNT, otherAppId, nullifier);
        require(_validate(ACCOUNT, userOpHash, signature) == SIG_VALIDATION_FAILED, "other app");
        require(_isValidSignature(ACCOUNT, erc1271Hash, erc1271Signature) == ERC1271_INVALID, "other app (1271)");
    }

    function test_NotInstalledFails() public {
        require(_validate(ACCOUNT, userOpHash, signature) == SIG_VALIDATION_FAILED, "not installed");
        require(_isValidSignature(ACCOUNT, erc1271Hash, erc1271Signature) == ERC1271_INVALID, "not installed (1271)");
        // Installed for ACCOUNT only: another account using the same proof still fails.
        _install(ACCOUNT, appId, nullifier);
        require(_validate(OTHER_ACCOUNT, userOpHash, signature) == SIG_VALIDATION_FAILED, "other account");
    }

    function test_SenderMismatchFails() public {
        _install(ACCOUNT, appId, nullifier);
        _install(OTHER_ACCOUNT, appId, nullifier);
        // The installed account validates an operation whose sender is someone else.
        VM.prank(ACCOUNT);
        require(
            validator.validateUserOp(_userOp(OTHER_ACCOUNT, signature), userOpHash) == SIG_VALIDATION_FAILED,
            "userOp.sender != msg.sender"
        );
        // A third party asks about the installed account's operation.
        VM.prank(address(0xCAFE));
        require(
            validator.validateUserOp(_userOp(ACCOUNT, signature), userOpHash) == SIG_VALIDATION_FAILED,
            "caller is not the sender"
        );
    }

    function test_VerifierFalseOrRevertFails() public {
        address[2] memory stubs = [address(new FalseVerifier()), address(new RevertingVerifier())];
        for (uint256 i; i < stubs.length; ++i) {
            VeraKeyValidator withStub = new VeraKeyValidator(stubs[i], rpIdHash, origin);
            VM.prank(ACCOUNT);
            withStub.onInstall(abi.encode(appId, nullifier));
            // clientDataJSON passes the checks, so the verifier's answer decides.
            VM.prank(ACCOUNT);
            require(
                withStub.validateUserOp(_userOp(ACCOUNT, signature), userOpHash) == SIG_VALIDATION_FAILED,
                "verifier said no"
            );
            VM.prank(ACCOUNT);
            require(
                withStub.isValidSignatureWithSender(address(this), erc1271Hash, erc1271Signature) == ERC1271_INVALID,
                "verifier said no (1271)"
            );
        }
    }

    function test_RpIdHashMismatchFails() public {
        // Same verifier and origin, different relying party: the rpIdHash limbs are public inputs.
        VeraKeyValidator otherRp = new VeraKeyValidator(address(verifier), sha256("evil.test"), origin);
        VM.prank(ACCOUNT);
        otherRp.onInstall(abi.encode(appId, nullifier));
        VM.prank(ACCOUNT);
        require(
            otherRp.validateUserOp(_userOp(ACCOUNT, signature), userOpHash) == SIG_VALIDATION_FAILED,
            "rpIdHash mismatch"
        );
    }

    function test_MalformedSignatureFailsWithoutReverting() public {
        _install(ACCOUNT, appId, nullifier);
        bytes memory valid = signature;
        uint256 head = valid.length - 32; // the last word, as an offset
        bytes[] memory bad = new bytes[](16);
        bad[0] = "";
        bad[1] = new bytes(63);
        bad[2] = new bytes(64); // both fields point at offset 0: a zero-length proof and clientDataJSON
        bad[3] = abi.encode(proof); // one field only
        bad[4] = abi.encode(type(uint256).max, uint256(0x40)); // proof offset overflows
        bad[5] = abi.encode(uint256(0x40), type(uint256).max); // clientDataJSON offset overflows
        bad[6] = abi.encode(uint256(0x40), uint256(0x40), type(uint256).max); // length overflows
        bad[7] = abi.encode(uint256(0x40), head, uint256(0)); // offset past the end
        bad[8] = _prefix(valid, valid.length - 32); // clientDataJSON cut short
        bad[9] = _prefix(valid, 0x40 + 32 + 100); // proof cut short
        bad[10] = abi.encode(bytes(""), clientDataJson); // empty proof: the verifier reverts
        bad[11] = abi.encode(_prefix(proof, proof.length - 32), clientDataJson); // proof one word short
        bad[12] = abi.encode(bytes.concat(proof, bytes32(0)), clientDataJson); // proof one word long
        bad[13] = abi.encode(proof, bytes.concat(clientDataJson, new bytes(1024))); // clientDataJSON too long
        bad[14] = abi.encode(clientDataJson, proof); // fields swapped
        bad[15] = proof; // not ABI-encoded at all
        for (uint256 i; i < bad.length; ++i) {
            require(_validate(ACCOUNT, userOpHash, bad[i]) == SIG_VALIDATION_FAILED, "malformed signature");
            require(_isValidSignature(ACCOUNT, erc1271Hash, bad[i]) == ERC1271_INVALID, "malformed signature (1271)");
        }
        // Like abi.decode, missing zero padding after the last field is tolerated.
        require(_validate(ACCOUNT, userOpHash, _prefix(valid, valid.length - 1)) == VALID, "unpadded tail");
    }

    // ---------------------------------------------------------------------------------------------
    // Unit tests of the internal checks
    // ---------------------------------------------------------------------------------------------

    function test_ClientDataRulesMirrorStylus() public view {
        bytes memory challenge = harness.base64Url(userOpHash);
        // Accepted, as by `client_data::verify` in verakey-core.
        require(harness.checkClientData(clientDataJson, userOpHash), "fixture (Level 3)");
        require(harness.checkClientData(_clientData(challenge, origin, "}"), userOpHash), "Level 1");
        require(
            harness.checkClientData(
                _clientData(
                    challenge,
                    origin,
                    ',"crossOrigin":false,"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}'
                ),
                userOpHash
            ),
            "Chrome's injected key"
        );
        // Prefix match, exactly like `starts_with`: fewer than 19 bytes left cannot be `,"crossOrigin":true`.
        require(harness.checkClientData(_clientData(challenge, origin, ',"crossOrigin":tru'), userOpHash), "tru");
        bytes memory maxLength = _padTo(_clientData(challenge, origin, ',"pad":"'), 1024 - 2);
        maxLength = bytes.concat(maxLength, '"}');
        require(maxLength.length == 1024 && harness.checkClientData(maxLength, userOpHash), "1024 bytes");

        // Rejected.
        require(!harness.checkClientData("", userOpHash), "empty");
        require(!harness.checkClientData(bytes.concat(maxLength, " "), userOpHash), "1025 bytes");
        require(
            !harness.checkClientData(
                bytes.concat('{"type":"webauthn.create","challenge":"', challenge, '","origin":"', bytes(origin), '"}'),
                userOpHash
            ),
            "registration ceremony"
        );
        require(
            !harness.checkClientData(
                bytes.concat('{"type": "webauthn.get","challenge":"', challenge, '","origin":"', bytes(origin), '"}'),
                userOpHash
            ),
            "other serialization"
        );
        require(!harness.checkClientData(clientDataJson, ~userOpHash), "other challenge");
        require(
            !harness.checkClientData(_clientData(bytes.concat(challenge, "="), origin, "}"), userOpHash),
            "padded challenge"
        );
        bytes memory standardBase64 = bytes.concat(challenge);
        for (uint256 i; i < standardBase64.length; ++i) {
            if (standardBase64[i] == "-") standardBase64[i] = "+";
            if (standardBase64[i] == "_") standardBase64[i] = "/";
        }
        require(keccak256(standardBase64) != keccak256(challenge), "fixture challenge uses '-' or '_'");
        require(!harness.checkClientData(_clientData(standardBase64, origin, "}"), userOpHash), "standard base64");
        require(!harness.checkClientData(_clientData(challenge, "https://evil.test", "}"), userOpHash), "foreign");
        require(
            !harness.checkClientData(_clientData(challenge, "https://evilkey.test", "}"), userOpHash),
            "foreign origin of the same length"
        );
        // Corrupt one byte without moving any offset: `"challengE":"`, `"Origin":"`, and the quote that
        // closes the challenge.
        require(!harness.checkClientData(_replaceByte(clientDataJson, 32, "E"), userOpHash), "challenge key");
        require(!harness.checkClientData(_replaceByte(clientDataJson, 82, "O"), userOpHash), "origin key");
        require(!harness.checkClientData(_replaceByte(clientDataJson, 79, "'"), userOpHash), "challenge close");
        require(
            !harness.checkClientData(_clientData(challenge, "https://evil.verakey.test", "}"), userOpHash), "subdomain"
        );
        require(!harness.checkClientData(_clientData(challenge, "https://verakey.test:8443", "}"), userOpHash), "port");
        require(
            !harness.checkClientData(_clientData(challenge, "https://verakey.test.evil.test", "}"), userOpHash),
            "prefix"
        );
        require(!harness.checkClientData(_clientData(challenge, "http://verakey.test", "}"), userOpHash), "http");
        require(
            !harness.checkClientData(
                _clientData(challenge, origin, ',"crossOrigin":true,"topOrigin":"https://evil.test"}'), userOpHash
            ),
            "cross-origin iframe"
        );
        require(
            !harness.checkClientData(_clientData(challenge, origin, ',"crossOrigin":true'), userOpHash),
            "crossOrigin:true at the very end"
        );
        // Secure Payment Confirmation (`payment.get`) is refused. The Stylus account accepts it for `pay` only,
        // after checking the payee and total the browser showed; a user operation has no such fields.
        require(
            !harness.checkClientData(
                bytes.concat(
                    '{"type":"payment.get","challenge":"',
                    challenge,
                    '","origin":"',
                    bytes(origin),
                    '","crossOrigin":false,"payment":{"rpId":"verakey.test","topOrigin":"',
                    bytes(origin),
                    '","payeeName":"0x71c7656ec7ab88b098defb751b7401b5f6d8976f","total":{"value":"2.02","currency":"USD"},"instrument":{}}}'
                ),
                userOpHash
            ),
            "SPC payment.get"
        );
        require(!harness.checkClientData(_clientData(challenge, origin, ""), userOpHash), "truncated after origin");
        require(!harness.checkClientData(_clientData(challenge, origin, " }"), userOpHash), "unexpected byte");
        require(
            !harness.checkClientData(
                bytes.concat(
                    '{"type":"webauthn.get","challenge":"',
                    challenge,
                    '","origin":"',
                    bytes(origin),
                    '},"crossOrigin":false}'
                ),
                userOpHash
            ),
            "missing closing quote"
        );
    }

    function test_Base64UrlKnownVectors() public view {
        require(
            keccak256(harness.base64Url(bytes32(0))) == keccak256("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
            "zeros"
        );
        require(
            keccak256(harness.base64Url(bytes32(type(uint256).max)))
                == keccak256("__________________________________________8"),
            "ones use the URL-safe alphabet"
        );
        require(
            keccak256(harness.base64Url(sha256("abc"))) == keccak256("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"),
            "sha256('abc')"
        );
        // The encoder agrees with the SDK's base64UrlEncode on the fixture challenge.
        require(keccak256(harness.base64Url(userOpHash)) == keccak256(_slice(clientDataJson, 36, 79)), "SDK");
    }

    function test_DecodeSignatureMatchesAbiDecode() public view {
        bytes memory canonical = signature;
        bytes[3] memory encodings =
            [canonical, abi.encode(bytes(""), bytes("")), abi.encode(bytes("proof"), bytes("clientDataJSON"))];
        for (uint256 i; i < encodings.length; ++i) {
            (bytes memory expectedProof, bytes memory expectedClientData) = abi.decode(encodings[i], (bytes, bytes));
            (bool ok, bytes memory decodedProof, bytes memory decodedClientData) = harness.decodeSignature(encodings[i]);
            require(ok, "decodes");
            require(keccak256(decodedProof) == keccak256(expectedProof), "proof");
            require(keccak256(decodedClientData) == keccak256(expectedClientData), "clientDataJSON");
        }
        (bool okShort,,) = harness.decodeSignature(new bytes(63));
        (bool okOverflow,,) = harness.decodeSignature(abi.encode(uint256(0x40), uint256(0x40), type(uint256).max));
        (bool okPastEnd,,) = harness.decodeSignature(abi.encode(uint256(0x40), uint256(0x60), uint256(0)));
        require(!okShort && !okOverflow && !okPastEnd, "rejects out-of-bounds encodings");
    }

    function test_DeployScriptDeploysConfiguredValidator() public {
        VeraKeyValidator deployed = VeraKeyValidator(new DeployValidator().run(address(verifier), rpIdHash, origin));
        require(deployed.verifier() == address(verifier), "verifier");
        require(deployed.rpIdHash() == rpIdHash, "rpIdHash");
        require(deployed.originHash() == keccak256(bytes(origin)), "origin");
        VM.prank(ACCOUNT);
        deployed.onInstall(abi.encode(appId, nullifier));
        VM.prank(ACCOUNT);
        require(deployed.validateUserOp(_userOp(ACCOUNT, signature), userOpHash) == VALID, "validates");
    }

    function test_ConstructorRejectsBadConfig() public {
        try new VeraKeyValidator(address(0xdead), rpIdHash, origin) returns (VeraKeyValidator) {
            revert("verifier without code accepted");
        } catch (bytes memory reason) {
            require(
                keccak256(reason) == keccak256(abi.encodeWithSelector(VeraKeyValidator.InvalidVerifier.selector)),
                "InvalidVerifier"
            );
        }
        try new VeraKeyValidator(address(verifier), rpIdHash, "") returns (VeraKeyValidator) {
            revert("empty origin accepted");
        } catch (bytes memory reason) {
            require(
                keccak256(reason) == keccak256(abi.encodeWithSelector(VeraKeyValidator.InvalidOrigin.selector)),
                "InvalidOrigin (empty)"
            );
        }
        string memory tooLong = string(_padTo(bytes("https://"), 129));
        try new VeraKeyValidator(address(verifier), rpIdHash, tooLong) returns (VeraKeyValidator) {
            revert("129-byte origin accepted");
        } catch (bytes memory reason) {
            require(
                keccak256(reason) == keccak256(abi.encodeWithSelector(VeraKeyValidator.InvalidOrigin.selector)),
                "InvalidOrigin (long)"
            );
        }
        new VeraKeyValidator(address(verifier), rpIdHash, string(_padTo(bytes("https://"), 128)));
    }

    // ---------------------------------------------------------------------------------------------
    // Gas
    // ---------------------------------------------------------------------------------------------

    function test_GasBreakdown() public {
        _install(ACCOUNT, appId, nullifier);
        bytes32[] memory inputs = VM.parseJsonBytes32Array(json, ".publicInputs");
        bytes memory proofBytes = proof;
        PackedUserOperation memory op = _userOp(ACCOUNT, signature);

        VM.cool(address(verifier));
        uint256 start = gasleft();
        bool verified = verifier.verify(proofBytes, inputs);
        uint256 verifyGas = start - gasleft();
        require(verified, "verify");

        VM.cool(address(validator));
        VM.cool(address(verifier));
        VM.prank(ACCOUNT);
        start = gasleft();
        uint256 result = validator.validateUserOp(op, userOpHash);
        uint256 validateGas = start - gasleft();
        require(result == VALID, "validateUserOp");

        PackedUserOperation memory wrongHashOp = _userOp(ACCOUNT, signature);
        VM.cool(address(validator));
        VM.prank(ACCOUNT);
        start = gasleft();
        result = validator.validateUserOp(wrongHashOp, ~userOpHash);
        uint256 rejectGas = start - gasleft();
        require(result == SIG_VALIDATION_FAILED, "rejected");

        bytes memory sig1271 = erc1271Signature;
        VM.cool(address(validator));
        VM.cool(address(verifier));
        VM.prank(ACCOUNT);
        start = gasleft();
        bytes4 magic = validator.isValidSignatureWithSender(address(this), erc1271Hash, sig1271);
        uint256 erc1271Gas = start - gasleft();
        require(magic == ERC1271_MAGIC_VALUE, "isValidSignatureWithSender");

        _log("gas: HonkVerifier.verify alone (cold)", verifyGas);
        _log("gas: validateUserOp, valid proof (cold)", validateGas);
        _log("gas: validateUserOp overhead over verify", validateGas - verifyGas);
        _log("gas: isValidSignatureWithSender, valid proof (cold)", erc1271Gas);
        _log("gas: isValidSignatureWithSender overhead over verify (incl. rehash)", erc1271Gas - verifyGas);
        _log("gas: validateUserOp, wrong userOpHash (rejected before verify)", rejectGas);
        _log("bytes: userOp.signature", signature.length);
    }

    // ---------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------

    function _install(address account, bytes32 appId_, bytes32 nullifier_) private {
        VM.prank(account);
        validator.onInstall(abi.encode(appId_, nullifier_));
    }

    function _expectInstallRevert(address account, bytes memory data, bytes memory expected) private {
        VM.prank(account);
        try validator.onInstall(data) {
            revert("onInstall did not revert");
        } catch (bytes memory reason) {
            require(keccak256(reason) == keccak256(expected), "unexpected revert reason");
        }
    }

    function _validate(address account, bytes32 hash, bytes memory sig) private returns (uint256) {
        PackedUserOperation memory op = _userOp(account, sig);
        VM.prank(account);
        return validator.validateUserOp(op, hash);
    }

    function _isValidSignature(address account, bytes32 hash, bytes memory sig) private returns (bytes4) {
        VM.prank(account);
        return validator.isValidSignatureWithSender(address(this), hash, sig);
    }

    function _userOp(address sender, bytes memory sig) private pure returns (PackedUserOperation memory op) {
        op.sender = sender;
        op.nonce = 7;
        op.callData = hex"e9ae5c53"; // ERC-7579 execute(bytes32,bytes)
        op.accountGasLimits = bytes32(uint256(900_000) << 128 | 100_000);
        op.preVerificationGas = 200_000;
        op.gasFees = bytes32(uint256(0.01 gwei) << 128 | 0.02 gwei);
        op.signature = sig;
    }

    /// @dev (signature, publicInputs) of a fixture variant.
    function _variant(string memory name) private view returns (bytes memory sig, bytes32[] memory inputs) {
        string memory key = string.concat(".variants.", name);
        sig = abi.encode(
            VM.parseJsonBytes(json, string.concat(key, ".proof")),
            VM.parseJsonBytes(json, string.concat(key, ".clientDataJSON"))
        );
        inputs = VM.parseJsonBytes32Array(json, string.concat(key, ".publicInputs"));
    }

    function _clientData(bytes memory challenge, string memory origin_, string memory rest)
        private
        pure
        returns (bytes memory)
    {
        return bytes.concat(
            '{"type":"webauthn.get","challenge":"', challenge, '","origin":"', bytes(origin_), '"', bytes(rest)
        );
    }

    function _replaceByte(bytes memory data, uint256 index, bytes1 value) private pure returns (bytes memory out) {
        out = bytes.concat(data);
        out[index] = value;
    }

    function _flip(bytes memory data, uint256 index) private pure returns (bytes memory out) {
        out = bytes.concat(data);
        out[index] ^= 0x01;
    }

    function _prefix(bytes memory data, uint256 length) private pure returns (bytes memory out) {
        return _slice(data, 0, length);
    }

    function _slice(bytes memory data, uint256 from, uint256 to) private pure returns (bytes memory out) {
        require(from <= to && to <= data.length, "slice out of range");
        out = new bytes(to - from);
        assembly ("memory-safe") {
            mcopy(add(out, 0x20), add(add(data, 0x20), from), sub(to, from))
        }
    }

    /// @dev `data` followed by 'a' up to `length` bytes.
    function _padTo(bytes memory data, uint256 length) private pure returns (bytes memory out) {
        bytes1 pad = "a";
        out = new bytes(length);
        for (uint256 i; i < length; ++i) {
            out[i] = i < data.length ? data[i] : pad;
        }
    }

    function _requireEqual(bytes32[] memory a, bytes32[] memory b, string memory message) private pure {
        require(a.length == b.length, message);
        for (uint256 i; i < a.length; ++i) {
            require(a[i] == b[i], message);
        }
    }

    function _log(string memory label, uint256 value) private view {
        (bool ok,) = CONSOLE.staticcall(abi.encodeWithSignature("log(string,uint256)", label, value));
        ok;
    }
}
