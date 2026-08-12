// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITreasury {
    function projectBalances(bytes32 projectId) external view returns (uint256);
    function payoutAddresses(bytes32 projectId) external view returns (address);
    function contribute(bytes32 projectId) external payable;
    function setPayoutAddress(bytes32 projectId, address payoutAddress) external;
    function withdraw(bytes32 projectId, uint256 amount) external;
}
