// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {VeraKeyValidator} from "../src/modules/VeraKeyValidator.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploys the VeraKey ERC-7579 validator for one relying party:
///   forge script script/DeployValidator.s.sol:DeployValidator --sig "run(address,bytes32,string)" \
///     <honkVerifier> <rpIdHash> <origin> --rpc-url <rpc> --broadcast
contract DeployValidator {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run(address verifier, bytes32 rpIdHash, string memory origin) external returns (address validator) {
        vm.startBroadcast();
        validator = address(new VeraKeyValidator(verifier, rpIdHash, origin));
        vm.stopBroadcast();
    }
}
