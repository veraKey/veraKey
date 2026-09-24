//! VeraKey factory.
//!
//! Deploys VeraKey accounts as EIP-1167 minimal proxies of one Stylus implementation. The CREATE2
//! salt commits to `(appId, nullifier, configHash)`, where `configHash` covers the implementation,
//! verifier, USDG token, rpIdHash, origin, default policy (caps, new-payee cap, delays) and fees (fee
//! recipient, largest fee). An account address can therefore only ever hold code that was
//! initialized with this factory's configuration: nobody can deploy the same address first with a
//! different verifier or policy (risk register #4).
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

use alloc::vec::Vec;
use alloy_primitives::{Address, B256, U256, U64};
use alloy_sol_types::sol;
#[allow(deprecated)]
use stylus_sdk::call::Call;
#[allow(deprecated)]
use stylus_sdk::deploy::RawDeploy;
use stylus_sdk::{
    abi::Bytes,
    crypto::keccak,
    prelude::*,
    storage::{StorageAddress, StorageB256, StorageBytes, StorageU256, StorageU64},
};
use verakey_core::{clone, field};

sol_interface! {
    interface IVeraKeyAccount {
        function initialize(bytes32 app_id, bytes32 owner_nullifier, address verifier, address usdg, bytes32 rp_id_hash, bytes origin, uint256 per_tx_cap, uint256 daily_cap, uint256 new_payee_cap, uint64 change_delay, uint64 recovery_delay, address fee_recipient, uint256 max_fee) external;
    }
}

sol! {
    event AccountCreated(bytes32 indexed appId, bytes32 indexed nullifier, address indexed account);

    error InvalidConfig();
    error InvalidIdentifier();
    error DeploymentFailed();
    error InitializationFailed();
}

#[derive(SolidityError)]
pub enum FactoryError {
    InvalidConfig(InvalidConfig),
    InvalidIdentifier(InvalidIdentifier),
    DeploymentFailed(DeploymentFailed),
    InitializationFailed(InitializationFailed),
}

fn account_salt(app_id: B256, nullifier: B256, config_hash: B256) -> B256 {
    keccak(clone::salt_preimage(app_id, nullifier, config_hash))
}

fn create2_address(deployer: Address, salt: B256, init_code: &[u8]) -> Address {
    let hash = keccak(clone::create2_preimage(deployer, salt, keccak(init_code)));
    Address::from_slice(&hash[12..])
}

#[storage]
#[entrypoint]
pub struct VeraKeyFactory {
    implementation: StorageAddress,
    verifier: StorageAddress,
    usdg: StorageAddress,
    rp_id_hash: StorageB256,
    origin: StorageBytes,
    per_tx_cap: StorageU256,
    daily_cap: StorageU256,
    new_payee_cap: StorageU256,
    change_delay: StorageU64,
    recovery_delay: StorageU64,
    fee_recipient: StorageAddress,
    max_fee: StorageU256,
    config_hash: StorageB256,
}

#[public]
impl VeraKeyFactory {
    #[constructor]
    #[allow(clippy::too_many_arguments)]
    pub fn constructor(
        &mut self,
        implementation: Address,
        verifier: Address,
        usdg: Address,
        rp_id_hash: B256,
        origin: Bytes,
        per_tx_cap: U256,
        daily_cap: U256,
        new_payee_cap: U256,
        change_delay: u64,
        recovery_delay: u64,
        fee_recipient: Address,
        max_fee: U256,
    ) -> Result<(), FactoryError> {
        if implementation == Address::ZERO
            || verifier == Address::ZERO
            || usdg == Address::ZERO
            || origin.is_empty()
            || per_tx_cap.is_zero()
            || per_tx_cap > daily_cap
            || daily_cap > U256::from(u128::MAX)
            || new_payee_cap > U256::from(u128::MAX)
            || fee_recipient == Address::ZERO
            || max_fee > U256::from(u64::MAX)
        {
            return Err(FactoryError::InvalidConfig(InvalidConfig {}));
        }
        self.implementation.set(implementation);
        self.verifier.set(verifier);
        self.usdg.set(usdg);
        self.rp_id_hash.set(rp_id_hash);
        self.origin.set_bytes(&origin);
        self.per_tx_cap.set(per_tx_cap);
        self.daily_cap.set(daily_cap);
        self.new_payee_cap.set(new_payee_cap);
        self.change_delay.set(U64::from(change_delay));
        self.recovery_delay.set(U64::from(recovery_delay));
        self.fee_recipient.set(fee_recipient);
        self.max_fee.set(max_fee);

        // abi.encode(implementation, verifier, usdg, rpIdHash, keccak256(origin), perTxCap,
        //            dailyCap, newPayeeCap, changeDelay, recoveryDelay, feeRecipient, maxFee)
        let mut encoded = Vec::with_capacity(12 * 32);
        for address in [implementation, verifier, usdg] {
            encoded.extend_from_slice(&[0u8; 12]);
            encoded.extend_from_slice(address.as_slice());
        }
        encoded.extend_from_slice(rp_id_hash.as_slice());
        encoded.extend_from_slice(keccak(&origin[..]).as_slice());
        encoded.extend_from_slice(&per_tx_cap.to_be_bytes::<32>());
        encoded.extend_from_slice(&daily_cap.to_be_bytes::<32>());
        encoded.extend_from_slice(&new_payee_cap.to_be_bytes::<32>());
        encoded.extend_from_slice(&U256::from(change_delay).to_be_bytes::<32>());
        encoded.extend_from_slice(&U256::from(recovery_delay).to_be_bytes::<32>());
        encoded.extend_from_slice(&[0u8; 12]);
        encoded.extend_from_slice(fee_recipient.as_slice());
        encoded.extend_from_slice(&max_fee.to_be_bytes::<32>());
        self.config_hash.set(keccak(encoded));
        Ok(())
    }

    /// Deploys and initializes the account for `(appId, nullifier)`; returns the existing address
    /// if it is already deployed. Anyone may call it: the configuration is fixed by the factory.
    pub fn create_account(&mut self, app_id: B256, nullifier: B256) -> Result<Address, FactoryError> {
        if !field::is_field_element(app_id)
            || !field::is_field_element(nullifier)
            || nullifier == B256::ZERO
        {
            return Err(FactoryError::InvalidIdentifier(InvalidIdentifier {}));
        }
        let init_code = clone::init_code(self.implementation.get());
        let salt = account_salt(app_id, nullifier, self.config_hash.get());
        let predicted = create2_address(self.vm().contract_address(), salt, &init_code);
        if self.vm().code_size(predicted) > 0 {
            return Ok(predicted);
        }

        #[allow(deprecated)]
        let account = unsafe { RawDeploy::new().salt(salt).deploy(&init_code, U256::ZERO) }
            .map_err(|_| FactoryError::DeploymentFailed(DeploymentFailed {}))?;
        let verifier = self.verifier.get();
        let usdg = self.usdg.get();
        let rp_id_hash = self.rp_id_hash.get();
        let origin = self.origin.get_bytes();
        let per_tx_cap = self.per_tx_cap.get();
        let daily_cap = self.daily_cap.get();
        let new_payee_cap = self.new_payee_cap.get();
        let change_delay = self.change_delay.get().to::<u64>();
        let recovery_delay = self.recovery_delay.get().to::<u64>();
        let fee_recipient = self.fee_recipient.get();
        let max_fee = self.max_fee.get();
        #[allow(deprecated)]
        IVeraKeyAccount::new(account)
            .initialize(
                Call::new_in(self),
                app_id,
                nullifier,
                verifier,
                usdg,
                rp_id_hash,
                origin.into(),
                per_tx_cap,
                daily_cap,
                new_payee_cap,
                change_delay,
                recovery_delay,
                fee_recipient,
                max_fee,
            )
            .map_err(|_| FactoryError::InitializationFailed(InitializationFailed {}))?;
        log(
            self.vm(),
            AccountCreated {
                appId: app_id,
                nullifier,
                account,
            },
        );
        Ok(account)
    }

    /// The counterfactual address of the account for `(appId, nullifier)`.
    pub fn account_address(&self, app_id: B256, nullifier: B256) -> Address {
        let init_code = clone::init_code(self.implementation.get());
        let salt = account_salt(app_id, nullifier, self.config_hash.get());
        create2_address(self.vm().contract_address(), salt, &init_code)
    }

    pub fn config_hash(&self) -> B256 {
        self.config_hash.get()
    }

    /// `(implementation, verifier, usdg, rpIdHash, perTxCap, dailyCap, newPayeeCap, changeDelay,
    /// recoveryDelay, feeRecipient, maxFee)`; `origin` has its own view (see `VeraKeyAccount::config`).
    #[allow(clippy::type_complexity)]
    pub fn config(&self) -> (Address, Address, Address, B256, U256, U256, U256, u64, u64, Address, U256) {
        (
            self.implementation.get(),
            self.verifier.get(),
            self.usdg.get(),
            self.rp_id_hash.get(),
            self.per_tx_cap.get(),
            self.daily_cap.get(),
            self.new_payee_cap.get(),
            self.change_delay.get().to::<u64>(),
            self.recovery_delay.get().to::<u64>(),
            self.fee_recipient.get(),
            self.max_fee.get(),
        )
    }

    pub fn origin(&self) -> Bytes {
        self.origin.get_bytes().into()
    }
}
