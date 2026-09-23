//! Pure logic shared by the VeraKey Stylus contracts.
//!
//! Everything here is deterministic, allocation-free where possible and `no_std`, so it can be
//! unit-tested on the host and compiled into the WASM contracts unchanged.
#![no_std]

pub mod action;
pub mod base64url;
pub mod changes;
pub mod client_data;
pub mod clone;
pub mod field;
pub mod spending;
