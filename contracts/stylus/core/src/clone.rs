//! EIP-1167 minimal-proxy creation code and CREATE2 preimages for VeraKey accounts.
//!
//! The functions return hash *preimages*; the factory hashes them with the Stylus host's keccak.

use alloy_primitives::{Address, B256};

/// EIP-1167 creation code: prefix ‖ implementation ‖ suffix.
pub const INIT_CODE_LEN: usize = 55;

const PREFIX: [u8; 20] = [
    0x3d, 0x60, 0x2d, 0x80, 0x60, 0x0a, 0x3d, 0x39, 0x81, 0xf3, 0x36, 0x3d, 0x3d, 0x37, 0x3d, 0x3d,
    0x3d, 0x36, 0x3d, 0x73,
];
const SUFFIX: [u8; 15] = [
    0x5a, 0xf4, 0x3d, 0x82, 0x80, 0x3e, 0x90, 0x3d, 0x91, 0x60, 0x2b, 0x57, 0xfd, 0x5b, 0xf3,
];

pub fn init_code(implementation: Address) -> [u8; INIT_CODE_LEN] {
    let mut code = [0u8; INIT_CODE_LEN];
    code[..20].copy_from_slice(&PREFIX);
    code[20..40].copy_from_slice(implementation.as_slice());
    code[40..].copy_from_slice(&SUFFIX);
    code
}

/// `abi.encode(appId, nullifier, configHash)`: the salt commits to the whole factory configuration.
pub fn salt_preimage(app_id: B256, nullifier: B256, config_hash: B256) -> [u8; 96] {
    let mut preimage = [0u8; 96];
    preimage[..32].copy_from_slice(app_id.as_slice());
    preimage[32..64].copy_from_slice(nullifier.as_slice());
    preimage[64..].copy_from_slice(config_hash.as_slice());
    preimage
}

/// `0xff ‖ deployer ‖ salt ‖ keccak256(initCode)` (EIP-1014).
pub fn create2_preimage(deployer: Address, salt: B256, init_code_hash: B256) -> [u8; 85] {
    let mut preimage = [0u8; 85];
    preimage[0] = 0xff;
    preimage[1..21].copy_from_slice(deployer.as_slice());
    preimage[21..53].copy_from_slice(salt.as_slice());
    preimage[53..].copy_from_slice(init_code_hash.as_slice());
    preimage
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::{address, b256, hex, keccak256};

    fn create2(deployer: Address, salt: B256, init_code: &[u8]) -> Address {
        let hash = keccak256(create2_preimage(deployer, salt, keccak256(init_code)));
        Address::from_slice(&hash[12..])
    }

    #[test]
    fn init_code_matches_eip1167() {
        assert_eq!(
            hex::encode(init_code(address!("bebebebebebebebebebebebebebebebebebebebe"))),
            "3d602d80600a3d3981f3363d3d373d3d3d363d73bebebebebebebebebebebebebebebebebebebebe5af43d82803e903d91602b57fd5bf3"
        );
    }

    #[test]
    fn create2_matches_eip1014_example() {
        // Cross-checked with `cast create2 --deployer 0x..deadbeef --salt 0x..cafebabe --init-code 0xdeadbeef`.
        let got = create2(
            address!("00000000000000000000000000000000deadbeef"),
            b256!("00000000000000000000000000000000000000000000000000000000cafebabe"),
            &[0xde, 0xad, 0xbe, 0xef],
        );
        assert_eq!(got, address!("60f3f640a8508fC6a86d45DF051962668E1e8AC7"));
    }

    #[test]
    fn salt_commits_to_config() {
        let app = B256::with_last_byte(1);
        let nullifier = B256::with_last_byte(2);
        assert_ne!(
            keccak256(salt_preimage(app, nullifier, B256::repeat_byte(1))),
            keccak256(salt_preimage(app, nullifier, B256::repeat_byte(2)))
        );
    }
}
