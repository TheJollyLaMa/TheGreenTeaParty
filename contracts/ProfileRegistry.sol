// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IProfileRegistry.sol";

contract ProfileRegistry is IProfileRegistry {
    mapping(address => string) private profileURIs;

    event ProfileURIUpdated(address indexed account, string profileURI);

    error InvalidProfileURI();

    function setProfileURI(string calldata profileURI) external override {
        if (bytes(profileURI).length == 0) revert InvalidProfileURI();

        profileURIs[msg.sender] = profileURI;
        emit ProfileURIUpdated(msg.sender, profileURI);
    }

    function getProfileURI(address account) external view override returns (string memory) {
        return profileURIs[account];
    }
}
