// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ProjectRegistry {
    enum Status {
        Draft,
        Active,
        Paused,
        Completed
    }

    struct Project {
        address steward;
        string metadataURI;
        Status status;
        bool exists;
    }

    address public owner;
    bool public paused;

    mapping(bytes32 => Project) private projects;

    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);
    event RegistryPaused(address indexed account);
    event RegistryUnpaused(address indexed account);
    event ProjectRegistered(bytes32 indexed projectId, address indexed steward, string metadataURI, uint8 status);
    event ProjectMetadataUpdated(bytes32 indexed projectId, string metadataURI);
    event ProjectStatusUpdated(bytes32 indexed projectId, uint8 previousStatus, uint8 nextStatus);
    event ProjectStewardTransferred(bytes32 indexed projectId, address indexed previousSteward, address indexed nextSteward);

    error Unauthorized();
    error InvalidOwner();
    error InvalidSteward();
    error InvalidMetadataURI();
    error ProjectAlreadyExists();
    error ProjectNotFound();
    error InvalidStatusTransition();
    error RegistryIsPaused();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyProjectOperator(bytes32 projectId) {
        if (!_isProjectOperator(projectId, msg.sender)) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert RegistryIsPaused();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert InvalidOwner();
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
        emit RegistryPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit RegistryUnpaused(msg.sender);
    }

    function registerProject(
        bytes32 projectId,
        address steward,
        string calldata metadataURI
    ) external onlyOwner whenNotPaused {
        if (projects[projectId].exists) revert ProjectAlreadyExists();
        if (steward == address(0)) revert InvalidSteward();
        if (bytes(metadataURI).length == 0) revert InvalidMetadataURI();

        projects[projectId] = Project({
            steward: steward,
            metadataURI: metadataURI,
            status: Status.Draft,
            exists: true
        });

        emit ProjectRegistered(projectId, steward, metadataURI, uint8(Status.Draft));
    }

    function updateProjectMetadataURI(
        bytes32 projectId,
        string calldata metadataURI
    ) external onlyProjectOperator(projectId) whenNotPaused {
        Project storage project = _requireProject(projectId);
        if (bytes(metadataURI).length == 0) revert InvalidMetadataURI();

        project.metadataURI = metadataURI;
        emit ProjectMetadataUpdated(projectId, metadataURI);
    }

    function updateProjectStatus(
        bytes32 projectId,
        Status nextStatus
    ) external onlyProjectOperator(projectId) whenNotPaused {
        Project storage project = _requireProject(projectId);
        Status previousStatus = project.status;

        if (!_isValidStatusTransition(previousStatus, nextStatus)) {
            revert InvalidStatusTransition();
        }

        project.status = nextStatus;
        emit ProjectStatusUpdated(projectId, uint8(previousStatus), uint8(nextStatus));
    }

    function transferSteward(
        bytes32 projectId,
        address nextSteward
    ) external onlyProjectOperator(projectId) whenNotPaused {
        Project storage project = _requireProject(projectId);
        if (nextSteward == address(0)) revert InvalidSteward();

        address previousSteward = project.steward;
        project.steward = nextSteward;

        emit ProjectStewardTransferred(projectId, previousSteward, nextSteward);
    }

    function projectExists(bytes32 projectId) external view returns (bool) {
        return projects[projectId].exists;
    }

    function getSteward(bytes32 projectId) external view returns (address) {
        return _requireProject(projectId).steward;
    }

    function getStatus(bytes32 projectId) external view returns (uint8) {
        return uint8(_requireProject(projectId).status);
    }

    function getProject(bytes32 projectId) external view returns (address steward, string memory metadataURI, uint8 status) {
        Project storage project = _requireProject(projectId);
        return (project.steward, project.metadataURI, uint8(project.status));
    }

    function _requireProject(bytes32 projectId) internal view returns (Project storage project) {
        project = projects[projectId];
        if (!project.exists) revert ProjectNotFound();
    }

    function _isProjectOperator(bytes32 projectId, address account) internal view returns (bool) {
        Project storage project = projects[projectId];
        return project.exists && (account == owner || account == project.steward);
    }

    function _isValidStatusTransition(Status currentStatus, Status nextStatus) internal pure returns (bool) {
        if (currentStatus == nextStatus) {
            return false;
        }

        if (currentStatus == Status.Draft) {
            return nextStatus == Status.Active || nextStatus == Status.Paused;
        }

        if (currentStatus == Status.Active) {
            return nextStatus == Status.Paused || nextStatus == Status.Completed;
        }

        if (currentStatus == Status.Paused) {
            return nextStatus == Status.Active || nextStatus == Status.Completed;
        }

        return false;
    }
}
