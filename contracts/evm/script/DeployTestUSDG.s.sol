// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {TestUSDG} from "../src/TestUSDG.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Local devnode only.
contract DeployTestUSDG {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address usdg) {
        vm.startBroadcast();
        usdg = address(new TestUSDG());
        vm.stopBroadcast();
    }
}
