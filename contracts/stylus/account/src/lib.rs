//! VeraKey account.
//!
//! One implementation, deployed once, behind EIP-1167 minimal proxies created by
//! `verakey-factory`. Every authorization is a zero-knowledge proof that a passkey owned by this
//! account signed a WebAuthn assertion over the exact action; the chain never sees the passkey's
//! public key or signature. Owners are identified by nullifiers, which are per-app and unlinkable.
//!
//! Security rules (each has a negative test in `packages/sdk/test/e2e`):
//! - the account only moves USDG, through `transfer`, and every payment plus its fee is capped per
//!   transaction and per UTC day. Safety actions (restrict, cancelling a change or a recovery) are never
//!   refused because of the caps, so a thief who spends the day's cap cannot stop the owners from
//!   freezing or vetoing; their fee, at most `maxFee`, still counts toward the day's spending. The
//!   per-transaction cap never drops below `maxFee`, so every fee stays payable;
//! - fees go only to the factory's `feeRecipient` and never exceed `maxFee`, so whoever submits a
//!   transaction cannot turn a fee into a payment to themselves (not even from a frozen account);
//! - the first payment to a recipient that is neither known (paid before) nor allowlisted is capped
//!   by `newPayeeCap`, which bounds what a look-alike address or a tampered page can take at once;
//! - a frozen account makes no payments; owners (with a proof) and the guardian freeze at once,
//!   unfreezing is a timelocked change. Freezing also cancels every scheduled change (a guardian's
//!   freeze keeps changes to the guardian itself). A freeze is always instant: it cannot be scheduled;
//! - with the payment sheet required, `pay` accepts only Secure Payment Confirmation client data;
//! - the nonce is consumed before any token transfer and every action carries a deadline of at most
//!   ten minutes;
//! - loosening configuration changes are scheduled with a proof and applied only after a timelock;
//!   owners and the guardian can cancel them, and at most `MAX_PENDING` wait at once, listed on-chain
//!   so an owner on any device can see them. Tightening changes (freeze, lower limits, enable the
//!   allowlist, remove a recipient, require the payment sheet) apply immediately through `restrict`;
//! - the guardian is stored as a salted commitment, so it stays private until it acts; it can
//!   freeze the account and replace all owners after a recovery delay, which any owner can cancel.
//!   It cannot veto a change to the guardian. Every change to the guardian waits the change delay plus
//!   the recovery delay and cancels a recovery the previous guardian started, so a guardian can delay
//!   the owners but never hold the account hostage, and a thief cannot install a guardian quickly;
//! - `pay` and the other proof-authorized entry points are permissionless: anyone may submit.
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

use alloc::{vec, vec::Vec};
use alloy_primitives::{address, Address, FixedBytes, B256, U128, U256, U64, U8};
use alloy_sol_types::sol;
use openzeppelin_stylus::token::erc20::utils::safe_erc20::{ISafeErc20, SafeErc20};
#[allow(deprecated)]
use stylus_sdk::call::Call;
use stylus_sdk::{
    abi::Bytes,
    crypto::keccak,
    prelude::*,
    storage::{
        StorageAddress, StorageArray, StorageB256, StorageBool, StorageBytes, StorageMap, StorageU128,
        StorageU256, StorageU64, StorageU8,
    },
};
use verakey_core::{
    action::{kind, Action},
    client_data, config, field, spending,
};

/// Longest validity an authorization may request.
pub const MAX_DEADLINE_WINDOW: u64 = 600;
/// Bounds on the configurable delays (seconds) and on the origin, shared with the factory.
pub use verakey_core::config::{MAX_DELAY, MAX_ORIGIN_LEN};
/// Most scheduled changes that may wait at once.
pub const MAX_PENDING: usize = 8;

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
    event Restricted(bytes32 indexed restrictionId, uint8 changeKind, bytes payload);
    event GuardianFroze();
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
    error NewPayeeCapExceeded(uint256 cap);
    error FeeTooHigh(uint256 maxFee);
    error PaymentSheetRequired();
    error AccountFrozen();
    error InvalidChange();
    error NotRestrictive();
    error UnknownChange();
    error ChangeNotReady(uint64 eta);
    error TooManyPendingChanges();
    error NotGuardian();
    error CannotVetoGuardianChange();
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
    NewPayeeCapExceeded(NewPayeeCapExceeded),
    FeeTooHigh(FeeTooHigh),
    PaymentSheetRequired(PaymentSheetRequired),
    AccountFrozen(AccountFrozen),
    InvalidChange(InvalidChange),
    NotRestrictive(NotRestrictive),
    UnknownChange(UnknownChange),
    ChangeNotReady(ChangeNotReady),
    TooManyPendingChanges(TooManyPendingChanges),
    NotGuardian(NotGuardian),
    CannotVetoGuardianChange(CannotVetoGuardianChange),
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
    eta: StorageU64,
    payload_hash: StorageB256,
    owner_epoch: StorageU256,
}

/// Field order is the storage layout. Small fields are packed so that `initialize` writes ten
/// slots and a payment updates its nonce and spending window in a single slot.
#[storage]
#[entrypoint]
pub struct VeraKeyAccount {
    // slot 0
    initialized: StorageBool,
    factory: StorageAddress,
    change_delay: StorageU64,
    frozen: StorageBool,
    allowlist_enabled: StorageBool,
    payment_sheet_required: StorageBool,
    // slot 1
    verifier: StorageAddress,
    recovery_delay: StorageU64,
    // slot 2
    usdg: StorageAddress,
    owner_count: StorageU64,
    // slot 3
    per_tx_cap: StorageU128,
    daily_cap: StorageU128,
    // slot 4
    new_payee_cap: StorageU128,
    recovery_eta: StorageU64,
    max_fee: StorageU64,
    // slot 5: everything a payment writes to this account
    nonce: StorageU64,
    spend_day: StorageU64,
    spent_today: StorageU128,
    // slot 6
    fee_recipient: StorageAddress,
    // one slot each
    app_id: StorageB256,
    rp_id_hash: StorageB256,
    origin: StorageBytes,
    // Owners are keyed by keccak256(ownerEpoch ‖ nullifier); recovery bumps the epoch, which
    // revokes every previous owner in O(1).
    owner_epoch: StorageU256,
    guardian_commitment: StorageB256,
    recovery_nullifier: StorageB256,
    // Ids of the scheduled changes still waiting (zero = free), readable from any device.
    pending_ids: StorageArray<StorageB256, MAX_PENDING>,
    owners: StorageMap<B256, StorageBool>,
    allowed_recipients: StorageMap<Address, StorageBool>,
    known_recipients: StorageMap<Address, StorageBool>,
    pending: StorageMap<B256, PendingChange>,
    safe_erc20: SafeErc20,
}

fn change_data_hash(change_kind: u8, payload: &[u8]) -> B256 {
    let mut preimage = Vec::with_capacity(1 + payload.len());
    preimage.push(change_kind);
    preimage.extend_from_slice(payload);
    keccak(preimage)
}

fn u128_to_u256(value: U128) -> U256 {
    U256::from(value.to::<u128>())
}

/// Callers only pass values already bounded by a `u128` limit, so this never truncates.
fn u256_to_u128(value: U256) -> U128 {
    U128::from(value.to::<u128>())
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

    fn current_nonce(&self) -> U256 {
        U256::from(self.nonce.get().to::<u64>())
    }

    fn limits(&self) -> change::Limits {
        change::Limits {
            per_tx_cap: u128_to_u256(self.per_tx_cap.get()),
            daily_cap: u128_to_u256(self.daily_cap.get()),
            new_payee_cap: u128_to_u256(self.new_payee_cap.get()),
        }
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
            nonce: self.current_nonce(),
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
    /// Returns the action hash (the WebAuthn challenge), which doubles as a unique id. A payment may
    /// be confirmed through Secure Payment Confirmation (`payment`), in which case the payee and
    /// total the browser showed must equal the payment.
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
        payment: Option<client_data::Payment>,
    ) -> Result<B256, AccountError> {
        self.require_initialized()?;
        let max_fee = self.fee_ceiling();
        if fee > max_fee {
            return Err(AccountError::FeeTooHigh(FeeTooHigh { maxFee: max_fee }));
        }
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
        let origin = self.origin.get_bytes();
        let invalid = |e: client_data::ClientDataError| AccountError::InvalidClientData(InvalidClientData { code: e as u8 });
        if client_data_json.starts_with(client_data::SPC_PREFIX) {
            let payment = payment.ok_or(invalid(client_data::ClientDataError::NotAnAssertion))?;
            let rp_id = client_data::verify_payment(client_data_json, &action_hash.0, &origin, &payment).map_err(invalid)?;
            if Self::sha256(rp_id)? != self.rp_id_hash.get().0 {
                return Err(invalid(client_data::ClientDataError::RpIdMismatch));
            }
        } else {
            client_data::verify(client_data_json, &action_hash.0, &origin).map_err(invalid)?;
        }

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

        self.nonce.set(U64::from(self.nonce.get().to::<u64>() + 1));
        Ok(action_hash)
    }

    fn check_spend(&self, amount: U256) -> Result<spending::Window, AccountError> {
        let window = spending::Window {
            day: self.spend_day.get().to::<u64>(),
            spent: u128_to_u256(self.spent_today.get()),
        };
        Ok(spending::spend(
            u128_to_u256(self.per_tx_cap.get()),
            u128_to_u256(self.daily_cap.get()),
            window,
            self.now(),
            amount,
        )?)
    }

    /// `window.spent` fits a `u128`: payments never exceed the daily cap, and `spending::record` saturates.
    fn record_spend(&mut self, window: spending::Window) {
        self.spend_day.set(U64::from(window.day));
        self.spent_today.set(u256_to_u128(window.spent));
    }

    /// Safety actions (restrict, cancelling a change or a recovery) are never refused because of the caps,
    /// or a thief who spends the day's cap would stop the owners from freezing and vetoing. Their fee,
    /// at most `max_fee` (checked in `authorize`), still counts toward the day's spending.
    fn record_fee(&mut self, fee: U256) {
        let window = spending::Window {
            day: self.spend_day.get().to::<u64>(),
            spent: u128_to_u256(self.spent_today.get()),
        };
        self.record_spend(spending::record(window, self.now(), fee));
    }

    /// The largest fee any action may carry.
    fn fee_ceiling(&self) -> U256 {
        U256::from(self.max_fee.get().to::<u64>())
    }

    /// A change can be scheduled only if it could apply: a valid payload, a per-transaction cap that
    /// still covers the largest fee, and owner changes that fit the current owners. A freeze never
    /// waits: it goes through `restrict`.
    fn check_schedule(&self, change_kind: u8, payload: &[u8]) -> Result<(), AccountError> {
        if change_kind == change::FREEZE
            || !change::is_valid(change_kind, payload)
            || !change::keeps_fees_payable(change_kind, payload, self.fee_ceiling())
        {
            return Err(AccountError::InvalidChange(InvalidChange {}));
        }
        match change_kind {
            change::ADD_OWNER if self.owner(B256::from_slice(payload)) => Err(AccountError::AlreadyOwner(AlreadyOwner {})),
            change::REMOVE_OWNER if !self.owner(B256::from_slice(payload)) => Err(AccountError::NotOwner(NotOwner {})),
            change::REMOVE_OWNER if self.owner_count.get().to::<u64>() <= 1 => Err(AccountError::LastOwner(LastOwner {})),
            _ => Ok(()),
        }
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

    /// Fees go to the factory's fee recipient, never to the caller: a submitter chosen by an attacker
    /// gains nothing from the fee an owner signed.
    fn pay_fee(&mut self, fee: U256) -> Result<(), AccountError> {
        let recipient = self.fee_recipient.get();
        self.transfer_usdg(recipient, fee)
    }

    fn pending_id(&self, index: usize) -> B256 {
        self.pending_ids.getter(index).map(|id| id.get()).unwrap_or_default()
    }

    fn set_pending_id(&mut self, index: usize, id: B256) {
        if let Some(mut slot) = self.pending_ids.setter(index) {
            slot.set(id);
        }
    }

    fn track_pending(&mut self, change_id: B256) -> Result<(), AccountError> {
        for index in 0..MAX_PENDING {
            if self.pending_id(index) == B256::ZERO {
                self.set_pending_id(index, change_id);
                return Ok(());
            }
        }
        Err(AccountError::TooManyPendingChanges(TooManyPendingChanges {}))
    }

    fn clear_pending(&mut self, change_id: B256) {
        let mut pending = self.pending.setter(change_id);
        pending.change_kind.set(U8::ZERO);
        pending.payload_hash.set(B256::ZERO);
        pending.eta.set(U64::ZERO);
        pending.owner_epoch.set(U256::ZERO);
        for index in 0..MAX_PENDING {
            if self.pending_id(index) == change_id {
                self.set_pending_id(index, B256::ZERO);
                break;
            }
        }
    }

    /// Cancels every scheduled change; with `keep_guardian_changes`, changes to the guardian stay,
    /// so a guardian's freeze cannot undo the owners' attempt to replace it.
    fn cancel_pending_changes(&mut self, keep_guardian_changes: bool) {
        for index in 0..MAX_PENDING {
            let change_id = self.pending_id(index);
            if change_id == B256::ZERO {
                continue;
            }
            let kind = self.pending.getter(change_id).change_kind.get().to::<u8>();
            if keep_guardian_changes && kind == change::SET_GUARDIAN {
                continue;
            }
            self.clear_pending(change_id);
            log(self.vm(), ChangeCancelled { changeId: change_id });
        }
    }

    fn pending_eta(&self, change_id: B256) -> u64 {
        self.pending.getter(change_id).eta.get().to::<u64>()
    }

    /// The caller is the guardian if `keccak256(abi.encode(typehash, this, caller, salt))` equals
    /// the stored commitment. The guardian reveals itself (and only for this account) by acting.
    fn require_guardian(&self, salt: B256) -> Result<(), AccountError> {
        let commitment = self.guardian_commitment.get();
        let claimed = keccak(change::guardian_preimage(
            self.vm().contract_address(),
            self.vm().msg_sender(),
            salt,
        ));
        if commitment == B256::ZERO || claimed != commitment {
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

    /// Applies a validated change. Payloads were checked by `change::is_valid` when they were
    /// scheduled or restricted; they are checked again here so no path can apply a malformed one.
    fn apply(&mut self, change_kind: u8, payload: &[u8]) -> Result<(), AccountError> {
        if !change::is_valid(change_kind, payload) {
            return Err(AccountError::InvalidChange(InvalidChange {}));
        }
        match change_kind {
            change::ADD_OWNER => {
                let nullifier = B256::from_slice(payload);
                if self.owner(nullifier) {
                    return Err(AccountError::AlreadyOwner(AlreadyOwner {}));
                }
                self.set_owner(nullifier, true);
                self.owner_count.set(U64::from(self.owner_count.get().to::<u64>() + 1));
            }
            change::REMOVE_OWNER => {
                let nullifier = B256::from_slice(payload);
                if !self.owner(nullifier) {
                    return Err(AccountError::NotOwner(NotOwner {}));
                }
                let count = self.owner_count.get().to::<u64>();
                if count <= 1 {
                    return Err(AccountError::LastOwner(LastOwner {}));
                }
                self.set_owner(nullifier, false);
                self.owner_count.set(U64::from(count - 1));
            }
            change::SET_LIMITS => {
                let per_tx = change::word_u128(&payload[..32]).unwrap_or_default();
                let daily = change::word_u128(&payload[32..]).unwrap_or_default();
                self.per_tx_cap.set(U128::from(per_tx));
                self.daily_cap.set(U128::from(daily));
            }
            change::SET_RECIPIENT => {
                let recipient = change::word_address(&payload[..32]).unwrap_or_default();
                let allowed = change::word_bool(&payload[32..]).unwrap_or(false);
                self.allowed_recipients.setter(recipient).set(allowed);
            }
            change::SET_ALLOWLIST => {
                self.allowlist_enabled.set(change::word_bool(payload).unwrap_or(false));
            }
            change::SET_GUARDIAN => {
                self.guardian_commitment.set(B256::from_slice(payload));
                // A recovery belongs to the guardian that started it: a removed or replaced guardian
                // keeps no way to take the account.
                if !self.recovery_eta.get().is_zero() {
                    let nullifier = self.clear_recovery();
                    log(self.vm(), RecoveryCancelled { newNullifier: nullifier });
                }
            }
            change::SET_NEW_PAYEE_CAP => {
                self.new_payee_cap.set(U128::from(change::word_u128(payload).unwrap_or_default()));
            }
            change::SET_PAYMENT_SHEET => {
                self.payment_sheet_required.set(change::word_bool(payload).unwrap_or(false));
            }
            change::FREEZE => self.frozen.set(true),
            change::UNFREEZE => self.frozen.set(false),
            _ => return Err(AccountError::InvalidChange(InvalidChange {})),
        }
        Ok(())
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
        new_payee_cap: U256,
        change_delay: u64,
        recovery_delay: u64,
        fee_recipient: Address,
        max_fee: U256,
    ) -> Result<(), AccountError> {
        if self.initialized.get() {
            return Err(AccountError::AlreadyInitialized(AlreadyInitialized {}));
        }
        let policy = config::Policy {
            per_tx_cap,
            daily_cap,
            new_payee_cap,
            change_delay,
            recovery_delay,
            max_fee,
            origin_len: origin.len(),
        };
        let valid = field::is_field_element(app_id)
            && field::is_field_element(owner_nullifier)
            && owner_nullifier != B256::ZERO
            && verifier != Address::ZERO
            && usdg != Address::ZERO
            && fee_recipient != Address::ZERO
            && config::is_valid_policy(&policy);
        if !valid {
            return Err(AccountError::InvalidConfig(InvalidConfig {}));
        }
        self.initialized.set(true);
        self.factory.set(self.vm().msg_sender());
        self.change_delay.set(U64::from(change_delay));
        self.verifier.set(verifier);
        self.recovery_delay.set(U64::from(recovery_delay));
        self.usdg.set(usdg);
        self.owner_count.set(U64::from(1));
        self.per_tx_cap.set(u256_to_u128(per_tx_cap));
        self.daily_cap.set(u256_to_u128(daily_cap));
        self.new_payee_cap.set(u256_to_u128(new_payee_cap));
        self.max_fee.set(U64::from(max_fee.to::<u64>()));
        self.fee_recipient.set(fee_recipient);
        self.app_id.set(app_id);
        self.rp_id_hash.set(rp_id_hash);
        self.origin.set_bytes(&origin);
        self.set_owner(owner_nullifier, true);
        log(self.vm(), Initialized {
            appId: app_id,
            ownerNullifier: owner_nullifier,
            factory: self.vm().msg_sender(),
        });
        Ok(())
    }

    /// Pays `amount` USDG to `to`, plus `fee` USDG (at most `maxFee`) to the fee recipient.
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
        if self.frozen.get() {
            return Err(AccountError::AccountFrozen(AccountFrozen {}));
        }
        if amount.is_zero() {
            return Err(AccountError::InvalidAmount(InvalidAmount {}));
        }
        if to == Address::ZERO || to == self.vm().contract_address() {
            return Err(AccountError::InvalidRecipient(InvalidRecipient {}));
        }
        let allowlisted = self.allowed_recipients.get(to);
        if self.allowlist_enabled.get() && !allowlisted {
            return Err(AccountError::RecipientNotAllowed(RecipientNotAllowed {}));
        }
        if self.payment_sheet_required.get() && !client_data_json.starts_with(client_data::SPC_PREFIX) {
            return Err(AccountError::PaymentSheetRequired(PaymentSheetRequired {}));
        }
        let total = amount
            .checked_add(fee)
            .ok_or(AccountError::InvalidAmount(InvalidAmount {}))?;
        let window = self.check_spend(total)?;
        // Within the caps, a first payment to a recipient that is neither known nor allowlisted is
        // bounded again: a look-alike address or a tampered page can take at most `newPayeeCap`.
        let known = self.known_recipients.get(to);
        if !known && !allowlisted {
            let cap = u128_to_u256(self.new_payee_cap.get());
            if amount > cap {
                return Err(AccountError::NewPayeeCapExceeded(NewPayeeCapExceeded { cap }));
            }
        }
        let nonce = self.current_nonce();
        // `total` passed the caps above, so it fits the u128 the caps are stored in.
        let payment = client_data::Payment { payee: to, total: total.to::<u128>() };
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
            Some(payment),
        )?;
        self.record_spend(window);
        if !known {
            self.known_recipients.setter(to).set(true);
        }

        let submitter = self.vm().msg_sender();
        self.transfer_usdg(to, amount)?;
        self.pay_fee(fee)?;
        log(self.vm(), Paid {
            nonce,
            to,
            amount,
            fee,
            submitter,
        });
        Ok(())
    }

    /// Schedules a configuration change; it can be applied after the change delay. Every change to the
    /// guardian waits the recovery delay on top, so the guardian can still recover an account whose
    /// passkey was stolen before a thief could remove it, and a thief cannot install a guardian of its
    /// own before the owners can cancel it.
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
        self.check_schedule(change_kind, &payload)?;
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
            None,
        )?;
        self.record_spend(window);
        self.track_pending(change_id)?;

        let mut delay = self.change_delay.get().to::<u64>();
        if change_kind == change::SET_GUARDIAN {
            delay += self.recovery_delay.get().to::<u64>();
        }
        let eta = self.now() + delay;
        let epoch = self.owner_epoch.get();
        let mut pending = self.pending.setter(change_id);
        pending.change_kind.set(U8::from(change_kind));
        pending.payload_hash.set(data_hash);
        pending.eta.set(U64::from(eta));
        pending.owner_epoch.set(epoch);

        self.pay_fee(fee)?;
        log(self.vm(), ChangeScheduled {
            changeId: change_id,
            changeKind: change_kind,
            payload: payload.0.into(),
            eta,
        });
        Ok(change_id)
    }

    /// Applies a tightening change immediately (freeze, lower limits, enable the allowlist, remove
    /// a recipient, require the payment sheet). Anything that loosens the account must go through
    /// `schedule_change`. Freezing also cancels every scheduled change, so nothing a thief scheduled
    /// survives the owner's emergency stop.
    #[allow(clippy::too_many_arguments)]
    pub fn restrict(
        &mut self,
        change_kind: u8,
        payload: Bytes,
        fee: U256,
        deadline: u64,
        nullifier: B256,
        client_data_json: Bytes,
        proof: Bytes,
    ) -> Result<B256, AccountError> {
        if !change::is_restrictive(change_kind, &payload, &self.limits()) {
            return Err(AccountError::NotRestrictive(NotRestrictive {}));
        }
        if !change::keeps_fees_payable(change_kind, &payload, self.fee_ceiling()) {
            return Err(AccountError::InvalidChange(InvalidChange {}));
        }
        let data_hash = change_data_hash(change_kind, &payload);
        let restriction_id = self.authorize(
            kind::RESTRICT,
            Address::ZERO,
            U256::ZERO,
            data_hash,
            fee,
            deadline,
            nullifier,
            &client_data_json,
            &proof,
            None,
        )?;
        self.record_fee(fee);
        self.apply(change_kind, &payload)?;
        if change_kind == change::FREEZE {
            self.cancel_pending_changes(false);
        }

        self.pay_fee(fee)?;
        log(self.vm(), Restricted {
            restrictionId: restriction_id,
            changeKind: change_kind,
            payload: payload.0.into(),
        });
        Ok(restriction_id)
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
        self.apply(change_kind, &payload)?;
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
            None,
        )?;
        self.record_fee(fee);
        self.clear_pending(change_id);
        self.pay_fee(fee)?;
        log(self.vm(), ChangeCancelled { changeId: change_id });
        Ok(())
    }

    /// Lets the guardian veto a scheduled change (for example after a device theft), except a
    /// change to the guardian itself.
    pub fn guardian_cancel_change(&mut self, change_id: B256, salt: B256) -> Result<(), AccountError> {
        self.require_guardian(salt)?;
        if self.pending_eta(change_id) == 0 {
            return Err(AccountError::UnknownChange(UnknownChange {}));
        }
        if self.pending.getter(change_id).change_kind.get().to::<u8>() == change::SET_GUARDIAN {
            return Err(AccountError::CannotVetoGuardianChange(CannotVetoGuardianChange {}));
        }
        self.clear_pending(change_id);
        log(self.vm(), ChangeCancelled { changeId: change_id });
        Ok(())
    }

    /// Lets the guardian stop all payments at once and cancel every scheduled change except changes
    /// to the guardian. Unfreezing is a timelocked owner change.
    pub fn guardian_freeze(&mut self, salt: B256) -> Result<(), AccountError> {
        self.require_initialized()?;
        self.require_guardian(salt)?;
        self.frozen.set(true);
        self.cancel_pending_changes(true);
        log(self.vm(), GuardianFroze {});
        Ok(())
    }

    /// Starts replacing every owner with `new_nullifier`, effective after the recovery delay.
    pub fn initiate_recovery(&mut self, new_nullifier: B256, salt: B256) -> Result<(), AccountError> {
        self.require_initialized()?;
        self.require_guardian(salt)?;
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
        // Changes scheduled by the old owners die with them.
        self.cancel_pending_changes(false);
        let epoch = self.owner_epoch.get() + U256::from(1);
        self.owner_epoch.set(epoch);
        self.set_owner(nullifier, true);
        self.owner_count.set(U64::from(1));
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
            None,
        )?;
        self.record_fee(fee);
        self.clear_recovery();
        self.pay_fee(fee)?;
        log(self.vm(), RecoveryCancelled {
            newNullifier: pending,
        });
        Ok(())
    }

    /// Lets the guardian withdraw its own recovery.
    pub fn guardian_cancel_recovery(&mut self, salt: B256) -> Result<(), AccountError> {
        self.require_guardian(salt)?;
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
        self.current_nonce()
    }

    pub fn app_id(&self) -> B256 {
        self.app_id.get()
    }

    pub fn is_owner(&self, nullifier: B256) -> bool {
        self.owner(nullifier)
    }

    pub fn owner_count(&self) -> U256 {
        U256::from(self.owner_count.get().to::<u64>())
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
            u128_to_u256(self.spent_today.get())
        } else {
            U256::ZERO
        };
        (
            u128_to_u256(self.per_tx_cap.get()),
            u128_to_u256(self.daily_cap.get()),
            spent,
            today,
            self.allowlist_enabled.get(),
        )
    }

    /// `(newPayeeCap, frozen, guardianCommitment, paymentSheetRequired)`.
    pub fn protections(&self) -> (U256, bool, B256, bool) {
        (
            u128_to_u256(self.new_payee_cap.get()),
            self.frozen.get(),
            self.guardian_commitment.get(),
            self.payment_sheet_required.get(),
        )
    }

    /// `(feeRecipient, maxFee)`: where every fee goes, and the largest fee any action may carry.
    pub fn fees(&self) -> (Address, U256) {
        (self.fee_recipient.get(), U256::from(self.max_fee.get().to::<u64>()))
    }

    /// Ids of the scheduled changes that are still waiting; details via `pendingChange`.
    pub fn pending_change_ids(&self) -> Vec<B256> {
        (0..MAX_PENDING)
            .map(|index| self.pending_id(index))
            .filter(|id| *id != B256::ZERO)
            .collect()
    }

    pub fn is_recipient_allowed(&self, recipient: Address) -> bool {
        !self.allowlist_enabled.get() || self.allowed_recipients.get(recipient)
    }

    /// Whether `recipient` has been paid before (so the new-payee cap no longer applies to it).
    pub fn is_known_recipient(&self, recipient: Address) -> bool {
        self.known_recipients.get(recipient)
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
