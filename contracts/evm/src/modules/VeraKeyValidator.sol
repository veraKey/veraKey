// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @dev ERC-4337 v0.7 user operation, as EntryPoint v0.7 passes it to the account.
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

/// @dev ERC-7579 module. A minimal local copy, so the module has no dependencies.
interface IModule {
    error AlreadyInitialized(address smartAccount);
    error NotInitialized(address smartAccount);

    function onInstall(bytes calldata data) external;
    function onUninstall(bytes calldata data) external;
    function isModuleType(uint256 moduleTypeId) external view returns (bool);
    function isInitialized(address smartAccount) external view returns (bool);
}

/// @dev ERC-7579 validator (module type 1).
interface IValidator is IModule {
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external returns (uint256);
    function isValidSignatureWithSender(address sender, bytes32 hash, bytes calldata data)
        external
        view
        returns (bytes4);
}

/// @dev The bb-generated UltraHonk verifier (src/HonkVerifier.sol). It returns true or reverts.
interface IHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @title VeraKey ERC-7579 validator
/// @notice Authorizes an account's ERC-4337 user operations and ERC-1271 signatures with a VeraKey
/// proof: an UltraHonk zero-knowledge proof that a passkey signed a WebAuthn assertion over the
/// challenge. The chain never sees the passkey's public key or signature. The account is bound to its
/// owner's per-app nullifier.
///
/// The proof shows three things:
/// - the passkey signed sha256(authenticatorData || sha256(clientDataJSON));
/// - authenticatorData carries this deployment's rpIdHash with the UP and UV flags set;
/// - the nullifier is Poseidon2(domain, publicKey, prfSecret, appId).
/// This contract checks the rest, like `authorize()` in the Stylus VeraKey account. clientDataJSON must
/// be a `webauthn.get` for exactly this challenge and origin, not made in a cross-origin iframe, and its
/// hash must be the proof's public input.
///
/// Signature (`userOp.signature`, or `data` for ERC-1271): abi.encode(bytes proof, bytes clientDataJSON).
/// Challenge: `userOpHash` for user operations, `erc1271Challenge(account, hash)` for ERC-1271.
///
/// Design notes:
/// - One deployment serves one relying party. The verifier, the rpIdHash and the origin are immutable,
///   so validation reads no storage except the account's own config. ERC-7562 lets an unstaked account
///   read storage associated with its address during validation, but no other storage of this module.
/// - The origin is kept as keccak256(origin) plus its length. The check hashes the same-length slice of
///   clientDataJSON, then requires the closing quote. That costs about a hundred gas and no SLOAD.
/// - The account calls its validators itself (ERC-7579), so the config of `msg.sender` applies.
///   `validateUserOp` also fails unless `userOp.sender == msg.sender`. EntryPoint only asks
///   `userOp.sender` to validate, so a mismatch means a mis-wired caller.
/// - A bad signature never reverts, it fails validation. The signature is decoded with explicit bounds
///   checks instead of `abi.decode`, and the verifier call is wrapped in try/catch.
/// - For ERC-1271 the passkey never signs `hash` itself: it signs
///   keccak256(abi.encode(ERC1271_TYPEHASH, chainId, account, hash)). Without that binding, an ERC-1271
///   signature would be valid for every account and chain where the same nullifier is installed.
///   Anyone can install anyone's nullifier, since nullifiers are public. The typed encoding also keeps
///   ERC-1271 challenges apart from userOpHashes, so a signed message can never authorize a user operation.
/// - The module has no nonce, deadline or spending policy. The userOpHash binds the chain, the
///   EntryPoint, the account and its nonce. Unlike the Stylus account, the passkey gets full control
///   of the account.
contract VeraKeyValidator is IValidator {
    uint256 internal constant MODULE_TYPE_VALIDATOR = 1;
    uint256 internal constant VALIDATION_SUCCESS = 0;
    uint256 internal constant SIG_VALIDATION_FAILED = 1;
    bytes4 internal constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 internal constant ERC1271_INVALID = 0xffffffff;

    /// @dev BN254 scalar field modulus. The app id and the nullifier are public inputs, so they must
    /// be canonical field elements.
    uint256 internal constant BN254_R = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;

    /// @notice The ERC-1271 challenge is keccak256(abi.encode(ERC1271_TYPEHASH, chainId, account, hash)).
    bytes32 public constant ERC1271_TYPEHASH =
        keccak256("VeraKeyERC1271(uint256 chainId,address account,bytes32 hash)");

    /// @notice Upper bound that keeps hashing and scanning costs predictable (as in the Stylus account).
    uint256 public constant MAX_CLIENT_DATA_LENGTH = 1024;
    uint256 public constant MAX_ORIGIN_LENGTH = 128;

    // clientDataJSON must be laid out as follows (WebAuthn L3 §5.8.1.2 fixes the key order):
    //   [0, 36)   {"type":"webauthn.get","challenge":"
    //   [36, 79)  base64url(challenge), 43 characters, no padding
    //   [79, 91)  ","origin":"
    //   [91, q)   origin, where q = 91 + origin length
    //   q         "
    //   q + 1     `}`, or `,` not followed by "crossOrigin":true
    bytes32 private constant TYPE_AND_CHALLENGE_KEY_HEAD = '{"type":"webauthn.get","challeng';
    bytes4 private constant TYPE_AND_CHALLENGE_KEY_TAIL = 'e":"';
    bytes12 private constant ORIGIN_KEY = '","origin":"';
    bytes19 private constant CROSS_ORIGIN_TRUE = ',"crossOrigin":true';
    uint256 private constant ORIGIN_START = 91;

    IHonkVerifier internal immutable VERIFIER;
    bytes32 internal immutable RP_ID_HASH;
    bytes32 internal immutable ORIGIN_HASH;
    uint256 internal immutable ORIGIN_LENGTH;

    struct Config {
        bytes32 appId;
        bytes32 nullifier;
    }

    /// @dev Installed iff `nullifier != 0`, since onInstall rejects a zero nullifier.
    mapping(address account => Config) private _configs;

    event Installed(address indexed account, bytes32 indexed appId, bytes32 indexed nullifier);
    event Uninstalled(address indexed account);

    error InvalidVerifier();
    error InvalidOrigin();
    error InvalidConfig();

    /// @param _verifier The UltraHonk verifier of the VeraKey WebAuthn circuit.
    /// @param _rpIdHash sha256 of the WebAuthn relying party id, e.g. sha256("verakey.app").
    /// @param _origin The only origin whose assertions this deployment accepts, e.g. "https://verakey.app".
    constructor(address _verifier, bytes32 _rpIdHash, string memory _origin) {
        // try/catch cannot catch a failed decode of the return data, which is what a call to an
        // address without code produces. Ruling that out keeps validation revert-free.
        if (_verifier.code.length == 0) revert InvalidVerifier();
        bytes memory origin = bytes(_origin);
        if (origin.length == 0 || origin.length > MAX_ORIGIN_LENGTH) revert InvalidOrigin();
        VERIFIER = IHonkVerifier(_verifier);
        RP_ID_HASH = _rpIdHash;
        ORIGIN_HASH = keccak256(origin);
        ORIGIN_LENGTH = origin.length;
    }

    // ---------------------------------------------------------------------------------------------
    // ERC-7579 module
    // ---------------------------------------------------------------------------------------------

    /// @param data abi.encode(bytes32 appId, bytes32 nullifier)
    function onInstall(bytes calldata data) external {
        if (_configs[msg.sender].nullifier != bytes32(0)) revert AlreadyInitialized(msg.sender);
        if (data.length != 64) revert InvalidConfig();
        (bytes32 appId, bytes32 nullifier) = abi.decode(data, (bytes32, bytes32));
        if (uint256(appId) >= BN254_R || uint256(nullifier) >= BN254_R || nullifier == bytes32(0)) {
            revert InvalidConfig();
        }
        _configs[msg.sender] = Config({appId: appId, nullifier: nullifier});
        emit Installed(msg.sender, appId, nullifier);
    }

    /// @dev Idempotent and never reverts, so the module can never block its own removal.
    function onUninstall(bytes calldata) external {
        delete _configs[msg.sender];
        emit Uninstalled(msg.sender);
    }

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR;
    }

    function isInitialized(address smartAccount) external view returns (bool) {
        return _configs[smartAccount].nullifier != bytes32(0);
    }

    // ---------------------------------------------------------------------------------------------
    // ERC-7579 validator
    // ---------------------------------------------------------------------------------------------

    /// @return 0 when the proof authorizes `userOpHash` for the calling account, else 1
    /// (SIG_VALIDATION_FAILED). It never reverts on a bad signature.
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external view returns (uint256) {
        if (userOp.sender != msg.sender) return SIG_VALIDATION_FAILED;
        return _isValid(msg.sender, userOpHash, userOp.signature) ? VALIDATION_SUCCESS : SIG_VALIDATION_FAILED;
    }

    /// @notice ERC-1271 check for the calling account. The passkey must have signed
    /// `erc1271Challenge(msg.sender, hash)`, which binds this chain and this account. The ERC-1271 caller
    /// (`sender`) is not used.
    /// @return 0x1626ba7e when the proof authorizes `hash` for the calling account, else 0xffffffff.
    function isValidSignatureWithSender(address, bytes32 hash, bytes calldata data) external view returns (bytes4) {
        return _isValid(msg.sender, erc1271Challenge(msg.sender, hash), data) ? ERC1271_MAGIC_VALUE : ERC1271_INVALID;
    }

    /// @notice The WebAuthn challenge that authorizes `hash` for `account` through ERC-1271 on this chain.
    function erc1271Challenge(address account, bytes32 hash) public view returns (bytes32) {
        // Kept as the documented encoding rather than assembly: the difference is about a hundred gas.
        // forge-lint: disable-next-line(asm-keccak256)
        return keccak256(abi.encode(ERC1271_TYPEHASH, block.chainid, account, hash));
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function verifier() external view returns (address) {
        return address(VERIFIER);
    }

    function rpIdHash() external view returns (bytes32) {
        return RP_ID_HASH;
    }

    /// @notice keccak256 of the accepted origin. The origin itself is in the deployment's constructor
    /// arguments.
    function originHash() external view returns (bytes32) {
        return ORIGIN_HASH;
    }

    function originLength() external view returns (uint256) {
        return ORIGIN_LENGTH;
    }

    function accountConfig(address smartAccount) external view returns (bytes32 appId, bytes32 nullifier) {
        Config storage config = _configs[smartAccount];
        return (config.appId, config.nullifier);
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    function _isValid(address account, bytes32 challenge, bytes calldata signature) internal view returns (bool) {
        Config storage config = _configs[account];
        bytes32 nullifier = config.nullifier;
        if (nullifier == bytes32(0)) return false;
        (bool decoded, bytes calldata proof, bytes calldata clientDataJson) = _decodeSignature(signature);
        if (!decoded || !_checkClientData(clientDataJson, challenge)) return false;
        bytes32[] memory publicInputs = _publicInputs(clientDataJson, config.appId, nullifier);
        // The verifier reverts on any invalid proof, including one of the wrong length.
        try VERIFIER.verify(proof, publicInputs) returns (bool verified) {
            return verified;
        } catch {
            return false;
        }
    }

    /// @dev The circuit's public inputs, in order: sha256(clientDataJSON) and rpIdHash, each split into
    /// big-endian 16-byte limbs right-aligned in a word (like `field::split_limbs` in Rust), then the
    /// app id and the nullifier.
    function _publicInputs(bytes calldata clientDataJson, bytes32 appId, bytes32 nullifier)
        internal
        view
        returns (bytes32[] memory inputs)
    {
        uint256 clientDataHash = uint256(sha256(clientDataJson));
        uint256 rpId = uint256(RP_ID_HASH);
        inputs = new bytes32[](6);
        inputs[0] = bytes32(clientDataHash >> 128);
        inputs[1] = bytes32(clientDataHash & type(uint128).max);
        inputs[2] = bytes32(rpId >> 128);
        inputs[3] = bytes32(rpId & type(uint128).max);
        inputs[4] = appId;
        inputs[5] = nullifier;
    }

    /// @dev Decodes abi.encode(bytes proof, bytes clientDataJSON) without reverting. It accepts the
    /// encodings abi.decode accepts. Where abi.decode would revert (a head or length pointing outside
    /// `signature`), it returns false. The slices point into calldata, so nothing is copied.
    function _decodeSignature(bytes calldata signature)
        internal
        pure
        returns (bool ok, bytes calldata proof, bytes calldata clientDataJson)
    {
        proof = signature[0:0];
        clientDataJson = signature[0:0];
        if (signature.length < 64) return (false, proof, clientDataJson);
        bool proofOk;
        bool clientDataOk;
        (proofOk, proof) = _dynamicBytes(signature, uint256(bytes32(signature[0:32])));
        (clientDataOk, clientDataJson) = _dynamicBytes(signature, uint256(bytes32(signature[32:64])));
        ok = proofOk && clientDataOk;
    }

    /// @dev The `bytes` whose length word sits at `offset`. Requires `data.length >= 64`.
    function _dynamicBytes(bytes calldata data, uint256 offset) private pure returns (bool, bytes calldata) {
        if (offset > data.length - 32) return (false, data[0:0]);
        uint256 start = offset + 32;
        uint256 length = uint256(bytes32(data[offset:start]));
        if (length > data.length - start) return (false, data[0:0]);
        return (true, data[start:start + length]);
    }

    /// @dev Mirrors `client_data::verify` of the Stylus account (verakey-core). WebAuthn's "limited
    /// verification algorithm" checks a byte prefix instead of parsing JSON. Keys a browser appends
    /// after `origin` are accepted. `"crossOrigin":true` is rejected because VeraKey never
    /// authenticates from inside a cross-origin iframe.
    function _checkClientData(bytes calldata clientDataJson, bytes32 challenge) internal view returns (bool) {
        uint256 length = clientDataJson.length;
        uint256 quote = ORIGIN_START + ORIGIN_LENGTH;
        // The byte after the closing quote must exist.
        if (length > MAX_CLIENT_DATA_LENGTH || length < quote + 2) return false;
        if (bytes32(clientDataJson[0:32]) != TYPE_AND_CHALLENGE_KEY_HEAD) return false;
        if (bytes4(clientDataJson[32:36]) != TYPE_AND_CHALLENGE_KEY_TAIL) return false;
        (bytes32 challengeHead, bytes11 challengeTail) = _base64Url(challenge);
        if (bytes32(clientDataJson[36:68]) != challengeHead) return false;
        if (bytes11(clientDataJson[68:79]) != challengeTail) return false;
        if (bytes12(clientDataJson[79:ORIGIN_START]) != ORIGIN_KEY) return false;
        // The closing quote must follow, so "https://a.xyz:8443" never matches "https://a.xyz".
        if (keccak256(clientDataJson[ORIGIN_START:quote]) != ORIGIN_HASH) return false;
        if (clientDataJson[quote] != '"') return false;
        bytes1 next = clientDataJson[quote + 1];
        if (next == "}") return true;
        if (next != ",") return false;
        uint256 rest = quote + 1;
        return length < rest + 19 || bytes19(clientDataJson[rest:rest + 19]) != CROSS_ORIGIN_TRUE;
    }

    /// @dev Unpadded base64url (RFC 4648 §5) of 32 bytes: 43 characters, returned as the first 32 and
    /// the last 11.
    function _base64Url(bytes32 value) internal pure returns (bytes32 head, bytes11 tail) {
        assembly ("memory-safe") {
            // Scratch memory past the free memory pointer: the alphabet, then the 43 output bytes.
            let table := mload(0x40)
            mstore(table, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef")
            mstore(add(table, 0x20), "ghijklmnopqrstuvwxyz0123456789-_")
            let out := add(table, 0x40)
            // Characters 0..41 encode the first 252 bits, six at a time, most significant first.
            for { let i := 0 } lt(i, 42) { i := add(i, 1) } {
                let sextet := and(shr(sub(250, mul(6, i)), value), 0x3f)
                mstore8(add(out, i), byte(0, mload(add(table, sextet))))
            }
            // Character 42 encodes the last four bits followed by two zero bits.
            mstore8(add(out, 42), byte(0, mload(add(table, shl(2, and(value, 0x0f))))))
            head := mload(out)
            tail := and(mload(add(out, 0x20)), shl(168, not(0)))
        }
    }
}
