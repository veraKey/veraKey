//! The action a passkey authorizes.
//!
//! The WebAuthn challenge is `keccak256(abi.encode(ACTION_TYPEHASH, chainId, account, nonce, kind,
//! target, amount, dataHash, fee, deadline))`. Binding the chain, the account address and the
//! account nonce makes every proof single-use and useless on any other account or chain; binding
//! the fee and deadline stops a relayer from changing what the user approved.

use alloy_primitives::{Address, B256, U256};

/// `keccak256("VeraKeyAction(uint256 chainId,address account,uint256 nonce,uint8 kind,address target,uint256 amount,bytes32 dataHash,uint256 fee,uint64 deadline)")`
pub const ACTION_TYPEHASH: [u8; 32] = [
    0x49, 0xb7, 0x51, 0x85, 0x11, 0x22, 0x3f, 0xf2, 0x4d, 0x5b, 0xc3, 0x1d, 0x13, 0x7c, 0xf0, 0xf6,
    0x57, 0x84, 0xf0, 0x57, 0x0d, 0x50, 0xae, 0xe3, 0x8d, 0xc0, 0x53, 0x78, 0x4e, 0x2b, 0x51, 0x4d,
];

/// Action kinds. Each kind has its own meaning for `target`, `amount` and `data_hash`.
pub mod kind {
    /// USDG payment: `target` = recipient, `amount` = USDG base units, `data_hash` = 0.
    pub const PAY: u8 = 1;
    /// Schedule a timelocked configuration change: `data_hash` = keccak256(changeKind ‖ payload).
    pub const SCHEDULE_CHANGE: u8 = 2;
    /// Cancel a scheduled change: `data_hash` = the change id.
    pub const CANCEL_CHANGE: u8 = 3;
    /// Cancel a guardian-initiated recovery: `data_hash` = the pending recovery nullifier.
    pub const CANCEL_RECOVERY: u8 = 4;
}

/// The typed fields of an action, before hashing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Action {
    pub chain_id: u64,
    pub account: Address,
    pub nonce: U256,
    pub kind: u8,
    pub target: Address,
    pub amount: U256,
    pub data_hash: B256,
    pub fee: U256,
    pub deadline: u64,
}

/// Number of bytes in the ABI encoding hashed into the challenge (ten 32-byte words).
pub const ENCODED_LEN: usize = 320;

fn put_u256(out: &mut [u8; ENCODED_LEN], word: usize, value: U256) {
    out[word * 32..word * 32 + 32].copy_from_slice(&value.to_be_bytes::<32>());
}

fn put_address(out: &mut [u8; ENCODED_LEN], word: usize, value: Address) {
    out[word * 32 + 12..word * 32 + 32].copy_from_slice(value.as_slice());
}

impl Action {
    /// `abi.encode(ACTION_TYPEHASH, chainId, account, nonce, kind, target, amount, dataHash, fee, deadline)`.
    pub fn encode(&self) -> [u8; ENCODED_LEN] {
        let mut out = [0u8; ENCODED_LEN];
        out[..32].copy_from_slice(&ACTION_TYPEHASH);
        put_u256(&mut out, 1, U256::from(self.chain_id));
        put_address(&mut out, 2, self.account);
        put_u256(&mut out, 3, self.nonce);
        put_u256(&mut out, 4, U256::from(self.kind));
        put_address(&mut out, 5, self.target);
        put_u256(&mut out, 6, self.amount);
        out[7 * 32..8 * 32].copy_from_slice(self.data_hash.as_slice());
        put_u256(&mut out, 8, self.fee);
        put_u256(&mut out, 9, U256::from(self.deadline));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::{address, b256, keccak256};

    #[test]
    fn typehash_matches_signature_string() {
        let expected = keccak256(
            "VeraKeyAction(uint256 chainId,address account,uint256 nonce,uint8 kind,address target,uint256 amount,bytes32 dataHash,uint256 fee,uint64 deadline)",
        );
        assert_eq!(expected.0, ACTION_TYPEHASH);
    }

    #[test]
    fn encoding_matches_solidity_abi_encode() {
        // Reference produced with:
        // cast abi-encode "f(bytes32,uint256,address,uint256,uint8,address,uint256,bytes32,uint256,uint64)" \
        //   0x49b7...514d 421614 0x00000000000000000000000000000000000000aa 7 1 0x00000000000000000000000000000000000000bb 2500000 0x0 10000 1790000000
        let action = Action {
            chain_id: 421_614,
            account: address!("00000000000000000000000000000000000000aa"),
            nonce: U256::from(7),
            kind: kind::PAY,
            target: address!("00000000000000000000000000000000000000bb"),
            amount: U256::from(2_500_000u64),
            data_hash: B256::ZERO,
            fee: U256::from(10_000u64),
            deadline: 1_790_000_000,
        };
        let encoded = action.encode();
        assert_eq!(
            keccak256(encoded),
            b256!("81f1e449fd071651d8e8cecfdee61b5652e12db85683b4bf5ed939b3246bf6d9"),
            "update this constant from the cast command in the comment if the encoding changes"
        );
    }

    #[test]
    fn nonce_changes_the_hash() {
        let mut a = Action {
            chain_id: 1,
            account: Address::ZERO,
            nonce: U256::ZERO,
            kind: kind::PAY,
            target: Address::ZERO,
            amount: U256::ZERO,
            data_hash: B256::ZERO,
            fee: U256::ZERO,
            deadline: 0,
        };
        let first = keccak256(a.encode());
        a.nonce = U256::from(1);
        assert_ne!(first, keccak256(a.encode()));
    }
}
