// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IProjectRegistry {
    function projectExists(bytes32 projectId) external view returns (bool);
    function getSteward(bytes32 projectId) external view returns (address);
    function getStatus(bytes32 projectId) external view returns (uint8);
}
