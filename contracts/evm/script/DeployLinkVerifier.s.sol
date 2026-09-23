// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {LinkHonkVerifier} from "../src/LinkHonkVerifier.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploys the bb-generated (optimized, ZK) verifier of the consent-to-link circuit.
contract DeployLinkVerifier {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address verifier) {
        vm.startBroadcast();
        verifier = address(new LinkHonkVerifier());
        vm.stopBroadcast();
    }
}
