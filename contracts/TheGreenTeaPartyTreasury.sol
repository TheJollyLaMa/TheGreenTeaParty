// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IProjectRegistryLike {
    function projectExists(bytes32 projectId) external view returns (bool);
    function getSteward(bytes32 projectId) external view returns (address);
    function getStatus(bytes32 projectId) external view returns (uint8);
}

interface IProfileRegistryLike {
    function getProfileURI(address account) external view returns (string memory);
}

interface IERC20Like {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract TheGreenTeaPartyTreasury {
    uint8 private constant STATUS_ACTIVE = 1;

    IProjectRegistryLike public registry;
    IProfileRegistryLike public profileRegistry;

    address public owner;
    bool public paused;
    bool private locked;

    mapping(bytes32 => uint256) public projectBalances;
    mapping(bytes32 => address) public payoutAddresses;

    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);
    event RegistryUpdated(address indexed previousRegistry, address indexed nextRegistry);
    event ProfileRegistryUpdated(address indexed previousProfileRegistry, address indexed nextProfileRegistry);
    event TreasuryPaused(address indexed account);
    event TreasuryUnpaused(address indexed account);
    event DirectDepositReceived(address indexed sender, uint256 amount);
    event ContributionReceived(bytes32 indexed projectId, address indexed contributor, uint256 amount, uint256 newBalance);
    event PayoutAddressUpdated(bytes32 indexed projectId, address indexed payoutAddress);
    event Withdrawal(bytes32 indexed projectId, address indexed recipient, uint256 amount, uint256 newBalance);
    event UnassignedETHSwept(address indexed recipient, uint256 amount);
    event ERC20TokensSwept(address indexed token, address indexed recipient, uint256 amount);

    error Unauthorized();
    error InvalidOwner();
    error InvalidRegistry();
    error InvalidProfileRegistry();
    error InvalidPayoutAddress();
    error InvalidAmount();
    error InvalidProjectState();
    error ProjectNotFound();
    error TreasuryIsPaused();
    error ReentrancyAttempt();
    error TransferFailed();
    error InsufficientProjectBalance();
    error InsufficientContractBalance();

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

    constructor(address registryAddress, address profileRegistryAddress, address initialOwner) {
        if (registryAddress == address(0)) revert InvalidRegistry();
        if (profileRegistryAddress == address(0)) revert InvalidProfileRegistry();
        if (initialOwner == address(0)) revert InvalidOwner();

        registry = IProjectRegistryLike(registryAddress);
        profileRegistry = IProfileRegistryLike(profileRegistryAddress);
        owner = initialOwner;

        emit OwnershipTransferred(address(0), initialOwner);
        emit RegistryUpdated(address(0), registryAddress);
        emit ProfileRegistryUpdated(address(0), profileRegistryAddress);
    }

    receive() external payable {
        emit DirectDepositReceived(msg.sender, msg.value);
    }

    fallback() external payable {
        if (msg.value > 0) {
            emit DirectDepositReceived(msg.sender, msg.value);
        }
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert InvalidOwner();
        address previousOwner = owner;
        owner = nextOwner;
        emit OwnershipTransferred(previousOwner, nextOwner);
    }

    function updateRegistry(address newRegistry) external onlyOwner {
        if (newRegistry == address(0)) revert InvalidRegistry();
        address previousRegistry = address(registry);
        registry = IProjectRegistryLike(newRegistry);
        emit RegistryUpdated(previousRegistry, newRegistry);
    }

    function updateProfileRegistry(address newProfileRegistry) external onlyOwner {
        if (newProfileRegistry == address(0)) revert InvalidProfileRegistry();
        address previousProfileRegistry = address(profileRegistry);
        profileRegistry = IProfileRegistryLike(newProfileRegistry);
        emit ProfileRegistryUpdated(previousProfileRegistry, newProfileRegistry);
    }

    function pause() external onlyOwner {
        paused = true;
        emit TreasuryPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit TreasuryUnpaused(msg.sender);
    }

    function sweepUnassignedETH(address payable recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert InvalidOwner();
        if (amount == 0) revert InvalidAmount();
        if (amount > address(this).balance) revert InsufficientContractBalance();

        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit UnassignedETHSwept(recipient, amount);
    }

    function sweepERC20(address token, address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0) || recipient == address(0)) revert InvalidOwner();
        if (amount == 0) revert InvalidAmount();

        bool success = IERC20Like(token).transfer(recipient, amount);
        if (!success) revert TransferFailed();

        emit ERC20TokensSwept(token, recipient, amount);
    }

    function contribute(bytes32 projectId) external payable whenNotPaused {
        _requireProject(projectId);
        if (registry.getStatus(projectId) != STATUS_ACTIVE) revert InvalidProjectState();
        if (msg.value == 0) revert InvalidAmount();

        projectBalances[projectId] += msg.value;
        emit ContributionReceived(projectId, msg.sender, msg.value, projectBalances[projectId]);
    }

    function setPayoutAddress(bytes32 projectId, address payoutAddress) external whenNotPaused {
        _requireProject(projectId);
        if (msg.sender != registry.getSteward(projectId)) revert Unauthorized();
        if (payoutAddress == address(0)) revert InvalidPayoutAddress();

        payoutAddresses[projectId] = payoutAddress;
        emit PayoutAddressUpdated(projectId, payoutAddress);
    }

    function withdraw(bytes32 projectId, uint256 amount) external whenNotPaused nonReentrant {
        _requireProject(projectId);
        if (amount == 0) revert InvalidAmount();
        if (projectBalances[projectId] < amount) revert InsufficientProjectBalance();

        address steward = registry.getSteward(projectId);
        address recipient = payoutAddresses[projectId];
        if (recipient == address(0)) {
            recipient = steward;
        }

        if (msg.sender != steward && msg.sender != recipient && msg.sender != owner) revert Unauthorized();

        projectBalances[projectId] -= amount;

        (bool success, ) = payable(recipient).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit Withdrawal(projectId, recipient, amount, projectBalances[projectId]);
    }

    function getProjectBalance(bytes32 projectId) external view returns (uint256) {
        return projectBalances[projectId];
    }

    function _requireProject(bytes32 projectId) internal view {
        if (!registry.projectExists(projectId)) revert ProjectNotFound();
    }
}
