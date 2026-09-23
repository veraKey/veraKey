//! VeraKey account.
//!
//! One implementation, deployed once, behind EIP-1167 minimal proxies created by
//! `verakey-factory`. Every authorization is a zero-knowledge proof that a passkey owned by this
//! account signed a WebAuthn assertion over the exact action; the chain never sees the passkey's
//! public key or signature. Owners are identified by nullifiers, which are per-app and unlinkable.
//!
//! Security rules (each has a negative test in `packages/sdk/test/e2e`):
//! - the account only moves USDG, through `transfer`, and every movement (payment plus fee) is
//!   capped per transaction and per UTC day;
//! - the nonce is consumed before any token transfer and every action carries a deadline of at most
//!   ten minutes;
//! - configuration changes are scheduled with a proof and applied only after a timelock; owners and
//!   the guardian can cancel them;
//! - a guardian can replace all owners after a recovery delay, which any owner can cancel;
//! - `pay` and the other proof-authorized entry points are permissionless: anyone may submit.
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

use alloc::{vec, vec::Vec};
use alloy_primitives::{address, Address, FixedBytes, B256, U256, U64, U8};
use alloy_sol_types::sol;
use openzeppelin_stylus::token::erc20::utils::safe_erc20::{ISafeErc20, SafeErc20};
#[allow(deprecated)]
use stylus_sdk::call::Call;
use stylus_sdk::{
    abi::Bytes,
    crypto::keccak,
    prelude::*,
    storage::{
        StorageAddress, StorageB256, StorageBool, StorageBytes, StorageMap, StorageU256, StorageU64,
        StorageU8,
    },
};
use verakey_core::{
    action::{kind, Action},
    client_data, field, spending,
};

/// Longest validity an authorization may request.
pub const MAX_DEADLINE_WINDOW: u64 = 600;
/// Bounds on the configurable delays (seconds).
pub const MAX_DELAY: u64 = 30 * 86_400;
pub const MAX_ORIGIN_LEN: usize = 128;

const SHA256_PRECOMPILE: Address = address!("0000000000000000000000000000000000000002");

pub use verakey_core::changes as change;

sol_interface! {
    interface IHonkVerifier {
        function verify(bytes calldata proof, bytes32[] calldata public_inputs) external view returns (bool);
    }
}

sol! {
    event Initialized(bytes32 indexed appId, bytes32 indexed ownerNullifier, address factory);
    event Paid(uint256 indexed nonce, address indexed to, uint256 amount, uint256 fee, address indexed submitter);
    event ChangeScheduled(bytes32 indexed changeId, uint8 changeKind, bytes payload, uint64 eta);
    event ChangeApplied(bytes32 indexed changeId, uint8 changeKind);
    event ChangeCancelled(bytes32 indexed changeId);
    event RecoveryInitiated(bytes32 indexed newNullifier, uint64 eta);
    event RecoveryExecuted(bytes32 indexed newNullifier, uint256 ownerEpoch);
    event RecoveryCancelled(bytes32 indexed newNullifier);

    error AlreadyInitialized();
    error NotInitialized();
    error InvalidConfig();
    error DeadlineExpired();
    error DeadlineTooFar();
    error NotOwner();
    error InvalidClientData(uint8 code);
    error InvalidProof();
    error InvalidAmount();
    error InvalidRecipient();
    error RecipientNotAllowed();
    error PerTxCapExceeded();
    error DailyCapExceeded();
    error InvalidChange();
    error UnknownChange();
    error ChangeNotReady(uint64 eta);
    error NotGuardian();
    error NoRecovery();
    error RecoveryNotReady(uint64 eta);
    error LastOwner();
    error AlreadyOwner();
    error TokenTransferFailed();
}

#[derive(SolidityError)]
pub enum AccountError {
    AlreadyInitialized(AlreadyInitialized),
    NotInitialized(NotInitialized),
    InvalidConfig(InvalidConfig),
    DeadlineExpired(DeadlineExpired),
    DeadlineTooFar(DeadlineTooFar),
    NotOwner(NotOwner),
    InvalidClientData(InvalidClientData),
    InvalidProof(InvalidProof),
    InvalidAmount(InvalidAmount),
    InvalidRecipient(InvalidRecipient),
    RecipientNotAllowed(RecipientNotAllowed),
    PerTxCapExceeded(PerTxCapExceeded),
    DailyCapExceeded(DailyCapExceeded),
    InvalidChange(InvalidChange),
    UnknownChange(UnknownChange),
    ChangeNotReady(ChangeNotReady),
    NotGuardian(NotGuardian),
    NoRecovery(NoRecovery),
    RecoveryNotReady(RecoveryNotReady),
    LastOwner(LastOwner),
    AlreadyOwner(AlreadyOwner),
    TokenTransferFailed(TokenTransferFailed),
}

impl From<spending::SpendError> for AccountError {
    fn from(e: spending::SpendError) -> Self {
        match e {
            spending::SpendError::PerTxCapExceeded => Self::PerTxCapExceeded(PerTxCapExceeded {}),
            spending::SpendError::DailyCapExceeded => Self::DailyCapExceeded(DailyCapExceeded {}),
        }
    }
}

#[storage]
pub struct PendingChange {
    change_kind: StorageU8,
    payload_hash: StorageB256,
    eta: StorageU64,
    owner_epoch: StorageU256,
}

#[storage]
#[entrypoint]
pub struct VeraKeyAccount {
    initialized: StorageBool,
    factory: StorageAddress,
    verifier: StorageAddress,
    usdg: StorageAddress,
    app_id: StorageB256,
    rp_id_hash: StorageB256,
    origin: StorageBytes,
    nonce: StorageU256,
    // Owners are keyed by keccak256(ownerEpoch ‖ nullifier); recovery bumps the epoch, which
    // revokes every previous owner in O(1).
    owner_epoch: StorageU256,
    owner_count: StorageU256,
    owners: StorageMap<B256, StorageBool>,
    per_tx_cap: StorageU256,
    daily_cap: StorageU256,
    spend_day: StorageU64,
    spent_today: StorageU256,
    allowlist_enabled: StorageBool,
    allowed_recipients: StorageMap<Address, StorageBool>,
    change_delay: StorageU64,
    pending: StorageMap<B256, PendingChange>,
    guardian: StorageAddress,
    recovery_delay: StorageU64,
    recovery_nullifier: StorageB256,
    recovery_eta: StorageU64,
    safe_erc20: SafeErc20,
}

fn change_data_hash(change_kind: u8, payload: &[u8]) -> B256 {
    let mut preimage = Vec::with_capacity(1 + payload.len());
    preimage.push(change_kind);
    preimage.extend_from_slice(payload);
    keccak(preimage)
}

impl VeraKeyAccount {
    fn require_initialized(&self) -> Result<(), AccountError> {
        if !self.initialized.get() {
            return Err(AccountError::NotInitialized(NotInitialized {}));
        }
        Ok(())
    }

    fn owner_key(epoch: U256, nullifier: B256) -> B256 {
        let mut preimage = [0u8; 64];
        preimage[..32].copy_from_slice(&epoch.to_be_bytes::<32>());
        preimage[32..].copy_from_slice(nullifier.as_slice());
        keccak(preimage)
    }

    fn owner(&self, nullifier: B256) -> bool {
        self.owners.get(Self::owner_key(self.owner_epoch.get(), nullifier))
    }

    fn set_owner(&mut self, nullifier: B256, is_owner: bool) {
        let key = Self::owner_key(self.owner_epoch.get(), nullifier);
        self.owners.setter(key).set(is_owner);
    }

    fn now(&self) -> u64 {
        self.vm().block_timestamp()
    }

    fn build_action(
        &self,
        action_kind: u8,
        target: Address,
        amount: U256,
        data_hash: B256,
        fee: U256,
        deadline: u64,
    ) -> Action {
        Action {
            chain_id: self.vm().chain_id(),
            account: self.vm().contract_address(),
            nonce: self.nonce.get(),
            kind: action_kind,
            target,
            amount,
            data_hash,
            fee,
            deadline,
        }
    }

    fn sha256(data: &[u8]) -> Result<[u8; 32], AccountError> {
        #[allow(deprecated)]
        let out = stylus_sdk::call::static_call(Call::new(), SHA256_PRECOMPILE, data)
            .map_err(|_| AccountError::InvalidClientData(InvalidClientData { code: 0 }))?;
        let mut digest = [0u8; 32];
        digest.copy_from_slice(&out[..32]);
        Ok(digest)
    }

    /// Verifies that an owner's passkey authorized exactly this action, then consumes the nonce.
    /// Returns the action hash (the WebAuthn challenge), which doubles as a unique id.
    #[allow(clippy::too_many_arguments)]
    fn authorize(
        &mut self,
        action_kind: u8,
        target: Address,
        amount: U256,
        data_hash: B256,
        fee: U256,
        deadline: u64,
        nullifier: B256,
        client_data_json: &[u8],
        proof: &[u8],
    ) -> Result<B256, AccountError> {
        self.require_initialized()?;
        let now = self.now();
        if deadline < now {
            return Err(AccountError::DeadlineExpired(DeadlineExpired {}));
        }
        if deadline > now + MAX_DEADLINE_WINDOW {
            return Err(AccountError::DeadlineTooFar(DeadlineTooFar {}));
        }
        if !self.owner(nullifier) {
            return Err(AccountError::NotOwner(NotOwner {}));
        }

        let action = self.build_action(action_kind, target, amount, data_hash, fee, deadline);
        let action_hash = keccak(action.encode());
        client_data::verify(client_data_json, &action_hash.0, &self.origin.get_bytes())
            .map_err(|e| AccountError::InvalidClientData(InvalidClientData { code: e as u8 }))?;

        let client_data_hash = Self::sha256(client_data_json)?;
        let (cdh_hi, cdh_lo) = field::split_limbs(&client_data_hash);
        let (rp_hi, rp_lo) = field::split_limbs(&self.rp_id_hash.get().0);
        let public_inputs: Vec<FixedBytes<32>> =
            vec![cdh_hi, cdh_lo, rp_hi, rp_lo, self.app_id.get(), nullifier];
        #[allow(deprecated)]
        let verified = IHonkVerifier::new(self.verifier.get())
            .verify(Call::new(), proof.to_vec().into(), public_inputs)
            .unwrap_or(false);
        if !verified {
            return Err(AccountError::InvalidProof(InvalidProof {}));
        }

        self.nonce.set(action.nonce + U256::from(1));
        Ok(action_hash)
    }

    fn check_spend(&self, amount: U256) -> Result<spending::Window, AccountError> {
        let window = spending::Window {
            day: self.spend_day.get().to::<u64>(),
            spent: self.spent_today.get(),
        };
        Ok(spending::spend(
            self.per_tx_cap.get(),
            self.daily_cap.get(),
            window,
            self.now(),
            amount,
        )?)
    }

    fn record_spend(&mut self, window: spending::Window) {
        self.spend_day.set(U64::from(window.day));
        self.spent_today.set(window.spent);
    }

    fn transfer_usdg(&mut self, to: Address, amount: U256) -> Result<(), AccountError> {
        if amount.is_zero() {
            return Ok(());
        }
        let usdg = self.usdg.get();
        self.safe_erc20
            .safe_transfer(usdg, to, amount)
            .map_err(|_| AccountError::TokenTransferFailed(TokenTransferFailed {}))
    }

    fn clear_pending(&mut self, change_id: B256) {
        let mut pending = self.pending.setter(change_id);
        pending.change_kind.set(U8::ZERO);
        pending.payload_hash.set(B256::ZERO);
        pending.eta.set(U64::ZERO);
        pending.owner_epoch.set(U256::ZERO);
    }

    fn pending_eta(&self, change_id: B256) -> u64 {
        self.pending.getter(change_id).eta.get().to::<u64>()
    }

    fn require_guardian(&self) -> Result<(), AccountError> {
        let guardian = self.guardian.get();
        if guardian == Address::ZERO || guardian != self.vm().msg_sender() {
            return Err(AccountError::NotGuardian(NotGuardian {}));
        }
        Ok(())
    }

    fn clear_recovery(&mut self) -> B256 {
        let nullifier = self.recovery_nullifier.get();
        self.recovery_nullifier.set(B256::ZERO);
        self.recovery_eta.set(U64::ZERO);
        nullifier
    }
}

#[public]
impl VeraKeyAccount {
    /// Locks the implementation contract itself; proxies are initialized by the factory.
    #[constructor]
    pub fn constructor(&mut self) {
        self.initialized.set(true);
    }

    /// Called by the factory in the same transaction that deploys the proxy.
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        &mut self,
        app_id: B256,
        owner_nullifier: B256,
        verifier: Address,
        usdg: Address,
        rp_id_hash: B256,
        origin: Bytes,
        per_tx_cap: U256,
        daily_cap: U256,
        change_delay: u64,
        recovery_delay: u64,
    ) -> Result<(), AccountError> {
        if self.initialized.get() {
            return Err(AccountError::AlreadyInitialized(AlreadyInitialized {}));
        }
        let valid = field::is_field_element(app_id)
            && field::is_field_element(owner_nullifier)
            && owner_nullifier != B256::ZERO
            && verifier != Address::ZERO
            && usdg != Address::ZERO
            && !origin.is_empty()
            && origin.len() <= MAX_ORIGIN_LEN
            && !per_tx_cap.is_zero()
            && per_tx_cap <= daily_cap
            && change_delay <= MAX_DELAY
            && recovery_delay <= MAX_DELAY;
        if !valid {
            return Err(AccountError::InvalidConfig(InvalidConfig {}));
        }
        self.initialized.set(true);
        self.factory.set(self.vm().msg_sender());
        self.verifier.set(verifier);
        self.usdg.set(usdg);
        self.app_id.set(app_id);
        self.rp_id_hash.set(rp_id_hash);
        self.origin.set_bytes(&origin);
        self.per_tx_cap.set(per_tx_cap);
        self.daily_cap.set(daily_cap);
        self.change_delay.set(U64::from(change_delay));
        self.recovery_delay.set(U64::from(recovery_delay));
        self.set_owner(owner_nullifier, true);
        self.owner_count.set(U256::from(1));
        log(self.vm(), Initialized {
            appId: app_id,
            ownerNullifier: owner_nullifier,
            factory: self.vm().msg_sender(),
        });
        Ok(())
    }

    /// Pays `amount` USDG to `to`, plus `fee` USDG to whoever submits the transaction.
    #[allow(clippy::too_many_arguments)]
    pub fn pay(
        &mut self,
        to: Address,
        amount: U256,
        fee: U256,
        deadline: u64,
        nullifier: B256,
        client_data_json: Bytes,
        proof: Bytes,
    ) -> Result<(), AccountError> {
        if amount.is_zero() {
            return Err(AccountError::InvalidAmount(InvalidAmount {}));
        }
        if to == Address::ZERO || to == self.vm().contract_address() {
            return Err(AccountError::InvalidRecipient(InvalidRecipient {}));
        }
        if self.allowlist_enabled.get() && !self.allowed_recipients.get(to) {
            return Err(AccountError::RecipientNotAllowed(RecipientNotAllowed {}));
        }
        let total = amount
            .checked_add(fee)
            .ok_or(AccountError::InvalidAmount(InvalidAmount {}))?;
        let window = self.check_spend(total)?;
        let nonce = self.nonce.get();
        self.authorize(
            kind::PAY,
            to,
            amount,
            B256::ZERO,
            fee,
            deadline,
            nullifier,
            &client_data_json,
            &proof,
        )?;
        self.record_spend(window);

        let submitter = self.vm().msg_sender();
        self.transfer_usdg(to, amount)?;
        self.transfer_usdg(submitter, fee)?;
        log(self.vm(), Paid {
            nonce,
            to,
            amount,
            fee,
            submitter,
        });
        Ok(())
    }

    /// Schedules a configuration change; it can be applied after the change delay.
    #[allow(clippy::too_many_arguments)]
    pub fn schedule_change(
        &mut self,
        change_kind: u8,
        payload: Bytes,
        fee: U256,
        deadline: u64,
        nullifier: B256,
        client_data_json: Bytes,
        proof: Bytes,
    ) -> Result<B256, AccountError> {
        if !change::is_valid(change_kind, &payload) {
            return Err(AccountError::InvalidChange(InvalidChange {}));
        }
        let data_hash = change_data_hash(change_kind, &payload);
        let window = self.check_spend(fee)?;
        let change_id = self.authorize(
            kind::SCHEDULE_CHANGE,
            Address::ZERO,
            U256::ZERO,
            data_hash,
            fee,
            deadline,
            nullifier,
            &client_data_json,
            &proof,
        )?;
        self.record_spend(window);

        let eta = self.now() + self.change_delay.get().to::<u64>();
        let epoch = self.owner_epoch.get();
        let mut pending = self.pending.setter(change_id);
        pending.change_kind.set(U8::from(change_kind));
        pending.payload_hash.set(data_hash);
        pending.eta.set(U64::from(eta));
        pending.owner_epoch.set(epoch);

        let submitter = self.vm().msg_sender();
        self.transfer_usdg(submitter, fee)?;
        log(self.vm(), ChangeScheduled {
            changeId: change_id,
            changeKind: change_kind,
            payload: payload.0.into(),
            eta,
        });
        Ok(change_id)
    }

    /// Applies a scheduled change once its timelock has passed. Anyone may call it.
    pub fn apply_change(
        &mut self,
        change_id: B256,
        change_kind: u8,
        payload: Bytes,
    ) -> Result<(), AccountError> {
        self.require_initialized()?;
        let (eta, stored_kind, stored_hash, stored_epoch) = {
            let pending = self.pending.getter(change_id);
            (
                pending.eta.get().to::<u64>(),
                pending.change_kind.get().to::<u8>(),
                pending.payload_hash.get(),
                pending.owner_epoch.get(),
            )
        };
        if eta == 0
            || stored_kind != change_kind
            || stored_hash != change_data_hash(change_kind, &payload)
            || stored_epoch != self.owner_epoch.get()
        {
            return Err(AccountError::UnknownChange(UnknownChange {}));
        }
        if self.now() < eta {
            return Err(AccountError::ChangeNotReady(ChangeNotReady { eta }));
        }
        self.clear_pending(change_id);

        match change_kind {
            change::ADD_OWNER => {
                let nullifier = B256::from_slice(&payload);
                if self.owner(nullifier) {
                    return Err(AccountError::AlreadyOwner(AlreadyOwner {}));
                }
                self.set_owner(nullifier, true);
                self.owner_count.set(self.owner_count.get() + U256::from(1));
            }
            change::REMOVE_OWNER => {
                let nullifier = B256::from_slice(&payload);
                if !self.owner(nullifier) {
                    return Err(AccountError::NotOwner(NotOwner {}));
                }
                if self.owner_count.get() <= U256::from(1) {
                    return Err(AccountError::LastOwner(LastOwner {}));
                }
                self.set_owner(nullifier, false);
                self.owner_count.set(self.owner_count.get() - U256::from(1));
            }
            change::SET_LIMITS => {
                self.per_tx_cap.set(U256::from_be_slice(&payload[..32]));
                self.daily_cap.set(U256::from_be_slice(&payload[32..]));
            }
            change::SET_RECIPIENT => {
                let recipient = change::word_address(&payload[..32]).unwrap_or_default();
                let allowed = change::word_bool(&payload[32..]).unwrap_or(false);
                self.allowed_recipients.setter(recipient).set(allowed);
            }
            change::SET_ALLOWLIST => {
                self.allowlist_enabled.set(change::word_bool(&payload).unwrap_or(false));
            }
            change::SET_GUARDIAN => {
                self.guardian.set(change::word_address(&payload).unwrap_or_default());
            }
            _ => return Err(AccountError::InvalidChange(InvalidChange {})),
        }
        log(self.vm(), ChangeApplied {
            changeId: change_id,
            changeKind: change_kind,
        });
        Ok(())
    }

    /// Cancels a scheduled change with an owner's proof.
    pub fn cancel_change(
        &mut self,
        change_id: B256,
        fee: U256,
        deadline: u64,
        nullifier: B256,
        client_data_json: Bytes,
        proof: Bytes,
    ) -> Result<(), AccountError> {
        if self.pending_eta(change_id) == 0 {
            return Err(AccountError::UnknownChange(UnknownChange {}));
        }
        let window = self.check_spend(fee)?;
        self.authorize(
            kind::CANCEL_CHANGE,
            Address::ZERO,
            U256::ZERO,
            change_id,
            fee,
            deadline,
            nullifier,
            &client_data_json,
            &proof,
        )?;
        self.record_spend(window);
        self.clear_pending(change_id);
        let submitter = self.vm().msg_sender();
        self.transfer_usdg(submitter, fee)?;
        log(self.vm(), ChangeCancelled { changeId: change_id });
        Ok(())
    }

    /// Lets the guardian veto a scheduled change (for example after a device theft).
    pub fn guardian_cancel_change(&mut self, change_id: B256) -> Result<(), AccountError> {
        self.require_guardian()?;
        if self.pending_eta(change_id) == 0 {
            return Err(AccountError::UnknownChange(UnknownChange {}));
        }
        self.clear_pending(change_id);
        log(self.vm(), ChangeCancelled { changeId: change_id });
        Ok(())
    }

    /// Starts replacing every owner with `new_nullifier`, effective after the recovery delay.
    pub fn initiate_recovery(&mut self, new_nullifier: B256) -> Result<(), AccountError> {
        self.require_initialized()?;
        self.require_guardian()?;
        if new_nullifier == B256::ZERO || !field::is_field_element(new_nullifier) {
            return Err(AccountError::InvalidChange(InvalidChange {}));
        }
        let eta = self.now() + self.recovery_delay.get().to::<u64>();
        self.recovery_nullifier.set(new_nullifier);
        self.recovery_eta.set(U64::from(eta));
        log(self.vm(), RecoveryInitiated {
            newNullifier: new_nullifier,
            eta,
        });
        Ok(())
    }

    /// Completes a recovery after its delay. Anyone may call it.
    pub fn execute_recovery(&mut self) -> Result<(), AccountError> {
        let eta = self.recovery_eta.get().to::<u64>();
        if eta == 0 {
            return Err(AccountError::NoRecovery(NoRecovery {}));
        }
        if self.now() < eta {
            return Err(AccountError::RecoveryNotReady(RecoveryNotReady { eta }));
        }
        let nullifier = self.clear_recovery();
        let epoch = self.owner_epoch.get() + U256::from(1);
        self.owner_epoch.set(epoch);
        self.set_owner(nullifier, true);
        self.owner_count.set(U256::from(1));
        log(self.vm(), RecoveryExecuted {
            newNullifier: nullifier,
            ownerEpoch: epoch,
        });
        Ok(())
    }

    /// Cancels a pending recovery with an owner's proof.
    pub fn cancel_recovery(
        &mut self,
        fee: U256,
        deadline: u64,
        nullifier: B256,
        client_data_json: Bytes,
        proof: Bytes,
    ) -> Result<(), AccountError> {
        let pending = self.recovery_nullifier.get();
        if self.recovery_eta.get().is_zero() {
            return Err(AccountError::NoRecovery(NoRecovery {}));
        }
        let window = self.check_spend(fee)?;
        self.authorize(
            kind::CANCEL_RECOVERY,
            Address::ZERO,
            U256::ZERO,
            pending,
            fee,
            deadline,
            nullifier,
            &client_data_json,
            &proof,
        )?;
        self.record_spend(window);
        self.clear_recovery();
        let submitter = self.vm().msg_sender();
        self.transfer_usdg(submitter, fee)?;
        log(self.vm(), RecoveryCancelled {
            newNullifier: pending,
        });
        Ok(())
    }

    /// Lets the guardian withdraw its own recovery.
    pub fn guardian_cancel_recovery(&mut self) -> Result<(), AccountError> {
        self.require_guardian()?;
        if self.recovery_eta.get().is_zero() {
            return Err(AccountError::NoRecovery(NoRecovery {}));
        }
        let nullifier = self.clear_recovery();
        log(self.vm(), RecoveryCancelled {
            newNullifier: nullifier,
        });
        Ok(())
    }

    /// The WebAuthn challenge the next authorization must sign.
    pub fn action_hash(
        &self,
        action_kind: u8,
        target: Address,
        amount: U256,
        data_hash: B256,
        fee: U256,
        deadline: u64,
    ) -> B256 {
        keccak(
            self.build_action(action_kind, target, amount, data_hash, fee, deadline)
                .encode(),
        )
    }

    pub fn initialized(&self) -> bool {
        self.initialized.get()
    }

    pub fn nonce(&self) -> U256 {
        self.nonce.get()
    }

    pub fn app_id(&self) -> B256 {
        self.app_id.get()
    }

    pub fn is_owner(&self, nullifier: B256) -> bool {
        self.owner(nullifier)
    }

    pub fn owner_count(&self) -> U256 {
        self.owner_count.get()
    }

    pub fn owner_epoch(&self) -> U256 {
        self.owner_epoch.get()
    }

    /// `(perTxCap, dailyCap, spentToday, spendDay, allowlistEnabled)`; `spentToday` is reported for
    /// the current UTC day.
    pub fn policy(&self) -> (U256, U256, U256, u64, bool) {
        let today = self.now() / spending::SECONDS_PER_DAY;
        let day = self.spend_day.get().to::<u64>();
        let spent = if day == today {
            self.spent_today.get()
        } else {
            U256::ZERO
        };
        (
            self.per_tx_cap.get(),
            self.daily_cap.get(),
            spent,
            today,
            self.allowlist_enabled.get(),
        )
    }

    pub fn is_recipient_allowed(&self, recipient: Address) -> bool {
        !self.allowlist_enabled.get() || self.allowed_recipients.get(recipient)
    }

    pub fn guardian(&self) -> Address {
        self.guardian.get()
    }

    /// `(newNullifier, eta)`; `eta` is zero when no recovery is pending.
    pub fn recovery(&self) -> (B256, u64) {
        (
            self.recovery_nullifier.get(),
            self.recovery_eta.get().to::<u64>(),
        )
    }

    /// `(changeKind, payloadHash, eta, ownerEpoch)`; `eta` is zero for unknown ids.
    pub fn pending_change(&self, change_id: B256) -> (u8, B256, u64, U256) {
        let pending = self.pending.getter(change_id);
        (
            pending.change_kind.get().to::<u8>(),
            pending.payload_hash.get(),
            pending.eta.get().to::<u64>(),
            pending.owner_epoch.get(),
        )
    }

    /// `(factory, verifier, usdg, rpIdHash, changeDelay, recoveryDelay)`. Static values only:
    /// stylus-sdk 0.9 encodes a returned tuple that contains `bytes` as one dynamic tuple, which
    /// does not match the exported multi-value interface, so `origin` has its own view.
    pub fn config(&self) -> (Address, Address, Address, B256, u64, u64) {
        (
            self.factory.get(),
            self.verifier.get(),
            self.usdg.get(),
            self.rp_id_hash.get(),
            self.change_delay.get().to::<u64>(),
            self.recovery_delay.get().to::<u64>(),
        )
    }

    /// The only origin whose WebAuthn assertions this account accepts.
    pub fn origin(&self) -> Bytes {
        self.origin.get_bytes().into()
    }
}
