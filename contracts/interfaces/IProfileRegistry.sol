// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IProfileRegistry {
    function getProfileURI(address account) external view returns (string memory);
    function setProfileURI(string calldata profileURI) external;
}
