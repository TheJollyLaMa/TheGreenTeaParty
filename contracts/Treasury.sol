// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IProjectRegistry.sol";
import "./interfaces/ITreasury.sol";

contract Treasury is ITreasury {
    uint8 private constant STATUS_ACTIVE = 1;

    IProjectRegistry public immutable registry;
    address public owner;
    bool public paused;
    bool private locked;

    mapping(bytes32 => uint256) public override projectBalances;
    mapping(bytes32 => address) public override payoutAddresses;

    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);
    event TreasuryPaused(address indexed account);
    event TreasuryUnpaused(address indexed account);
    event ContributionReceived(bytes32 indexed projectId, address indexed contributor, uint256 amount, uint256 newBalance);
    event PayoutAddressUpdated(bytes32 indexed projectId, address indexed payoutAddress);
    event Withdrawal(bytes32 indexed projectId, address indexed recipient, uint256 amount, uint256 newBalance);

    error Unauthorized();
    error InvalidOwner();
    error InvalidRegistry();
    error InvalidPayoutAddress();
    error InvalidAmount();
    error InvalidProjectState();
    error ProjectNotFound();
    error TreasuryIsPaused();
    error ReentrancyAttempt();
    error TransferFailed();
    error InsufficientProjectBalance();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert TreasuryIsPaused();
        _;
    }

    modifier nonReentrant() {
        if (locked) revert ReentrancyAttempt();
        locked = true;
        _;
        locked = false;
    }

    constructor(address registryAddress, address initialOwner) {
        if (registryAddress == address(0)) revert InvalidRegistry();
        if (initialOwner == address(0)) revert InvalidOwner();

        registry = IProjectRegistry(registryAddress);
        owner = initialOwner;

        emit OwnershipTransferred(address(0), initialOwner);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert InvalidOwner();
        address previousOwner = owner;
        owner = nextOwner;
        emit OwnershipTransferred(previousOwner, nextOwner);
    }

    function pause() external onlyOwner {
        paused = true;
        emit TreasuryPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit TreasuryUnpaused(msg.sender);
    }

    function contribute(bytes32 projectId) external payable override whenNotPaused {
        _requireProject(projectId);
        if (registry.getStatus(projectId) != STATUS_ACTIVE) revert InvalidProjectState();
        if (msg.value == 0) revert InvalidAmount();

        projectBalances[projectId] += msg.value;
        emit ContributionReceived(projectId, msg.sender, msg.value, projectBalances[projectId]);
    }

    function setPayoutAddress(bytes32 projectId, address payoutAddress) external override whenNotPaused {
        _requireProject(projectId);
        if (msg.sender != registry.getSteward(projectId)) revert Unauthorized();
        if (payoutAddress == address(0)) revert InvalidPayoutAddress();

        payoutAddresses[projectId] = payoutAddress;
        emit PayoutAddressUpdated(projectId, payoutAddress);
    }

    function withdraw(bytes32 projectId, uint256 amount) external override whenNotPaused nonReentrant {
        _requireProject(projectId);
        if (amount == 0) revert InvalidAmount();
        if (projectBalances[projectId] < amount) revert InsufficientProjectBalance();

        address steward = registry.getSteward(projectId);
        address recipient = payoutAddresses[projectId];
        if (recipient == address(0)) {
            recipient = steward;
        }

        if (msg.sender != steward && msg.sender != recipient) revert Unauthorized();

        projectBalances[projectId] -= amount;

        (bool success, ) = payable(recipient).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit Withdrawal(projectId, recipient, amount, projectBalances[projectId]);
    }

    function _requireProject(bytes32 projectId) internal view {
        if (!registry.projectExists(projectId)) revert ProjectNotFound();
    }
}
