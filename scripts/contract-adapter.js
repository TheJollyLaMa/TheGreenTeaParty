/* global window, GTPAppState, GTPConfig */

var GTPContractAdapter = (function () {
  'use strict';

  var PROJECT_REGISTRY_ABI = [
    'function projectExists(bytes32 projectId) view returns (bool)',
    'function getSteward(bytes32 projectId) view returns (address)',
    'function getStatus(bytes32 projectId) view returns (uint8)',
    'function getProject(bytes32 projectId) view returns (address steward, string metadataURI, uint8 status)',
    'function registerProject(bytes32 projectId, address steward, string metadataURI)',
    'function updateProjectMetadataURI(bytes32 projectId, string metadataURI)',
    'function updateProjectStatus(bytes32 projectId, uint8 nextStatus)',
    'function transferSteward(bytes32 projectId, address nextSteward)',
    'event ProjectRegistered(bytes32 indexed projectId, address indexed steward, string metadataURI, uint8 status)',
    'event ProjectMetadataUpdated(bytes32 indexed projectId, string metadataURI)',
    'event ProjectStatusUpdated(bytes32 indexed projectId, uint8 previousStatus, uint8 nextStatus)',
    'event ProjectStewardTransferred(bytes32 indexed projectId, address indexed previousSteward, address indexed nextSteward)'
  ];

  var PROFILE_REGISTRY_ABI = [
    'function getProfileURI(address account) view returns (string)',
    'function setProfileURI(string profileURI)',
    'event ProfileURIUpdated(address indexed account, string profileURI)'
  ];

  var TREASURY_ABI = [
    'function projectBalances(bytes32 projectId) view returns (uint256)',
    'function payoutAddresses(bytes32 projectId) view returns (address)',
    'function contribute(bytes32 projectId) payable',
    'function setPayoutAddress(bytes32 projectId, address payoutAddress)',
    'function withdraw(bytes32 projectId, uint256 amount)',
    'event ContributionReceived(bytes32 indexed projectId, address indexed contributor, uint256 amount, uint256 newBalance)',
    'event PayoutAddressUpdated(bytes32 indexed projectId, address indexed payoutAddress)',
    'event Withdrawal(bytes32 indexed projectId, address indexed recipient, uint256 amount, uint256 newBalance)'
  ];

  function getContractsForChain(chainId) {
    var contracts = GTPConfig && GTPConfig.contracts ? GTPConfig.contracts : {};
    return contracts[chainId] || {
      projectRegistry: null,
      treasury: null,
      profileRegistry: null
    };
  }

  function getReadiness(chainId) {
    var state = GTPAppState && typeof GTPAppState.getReadiness === 'function'
      ? GTPAppState.getReadiness()
      : { ready: false, reason: 'App state unavailable.' };
    var contracts = getContractsForChain(chainId);

    if (!contracts.projectRegistry || !contracts.treasury || !contracts.profileRegistry) {
      return {
        ready: false,
        reason: 'Contract addresses are not configured for the selected network.',
        contracts: contracts
      };
    }

    if (!state.ready) {
      return {
        ready: false,
        reason: state.reason,
        contracts: contracts
      };
    }

    return {
      ready: true,
      reason: '',
      contracts: contracts
    };
  }

  function createPlaceholderResult(action, chainId, detail) {
    return Promise.resolve({
      ok: false,
      placeholder: true,
      action: action,
      chainId: chainId,
      detail: detail || null,
      readiness: getReadiness(chainId)
    });
  }

  function resolveChainId(options) {
    if (options && typeof options.chainId === 'number') {
      return options.chainId;
    }

    if (GTPAppState && typeof GTPAppState.getSessionIdentity === 'function') {
      return GTPAppState.getSessionIdentity().chainId;
    }

    return null;
  }

  function create(options) {
    function currentChainId() {
      return resolveChainId(options);
    }

    return {
      getContractState: function () {
        var chainId = currentChainId();
        var readiness = getReadiness(chainId);

        return Promise.resolve({
          placeholder: true,
          chainId: chainId,
          contracts: readiness.contracts,
          ready: readiness.ready,
          reason: readiness.reason
        });
      },
      getProjectRecord: function (projectId) {
        var chainId = currentChainId();
        return createPlaceholderResult('getProjectRecord', chainId, { projectId: projectId });
      },
      getProjectBalance: function (projectId) {
        var chainId = currentChainId();
        return createPlaceholderResult('getProjectBalance', chainId, { projectId: projectId });
      },
      getProfilePointer: function (account) {
        var chainId = currentChainId();
        return createPlaceholderResult('getProfilePointer', chainId, { account: account });
      },
      registerProject: function (projectId, steward, metadataURI) {
        var chainId = currentChainId();
        GTPAppState.assertCanWrite();
        return createPlaceholderResult('registerProject', chainId, {
          projectId: projectId,
          steward: steward,
          metadataURI: metadataURI
        });
      },
      updateProjectMetadata: function (projectId, metadataURI) {
        var chainId = currentChainId();
        GTPAppState.assertCanWrite();
        return createPlaceholderResult('updateProjectMetadata', chainId, {
          projectId: projectId,
          metadataURI: metadataURI
        });
      },
      updateProjectStatus: function (projectId, nextStatus) {
        var chainId = currentChainId();
        GTPAppState.assertCanWrite();
        return createPlaceholderResult('updateProjectStatus', chainId, {
          projectId: projectId,
          nextStatus: nextStatus
        });
      },
      transferProjectSteward: function (projectId, nextSteward) {
        var chainId = currentChainId();
        GTPAppState.assertCanWrite();
        return createPlaceholderResult('transferProjectSteward', chainId, {
          projectId: projectId,
          nextSteward: nextSteward
        });
      },
      setProfilePointer: function (profileURI) {
        var chainId = currentChainId();
        GTPAppState.assertCanWrite();
        return createPlaceholderResult('setProfilePointer', chainId, {
          profileURI: profileURI
        });
      },
      contribute: function (projectId, amountWei) {
        var chainId = currentChainId();
        GTPAppState.assertCanWrite();
        return createPlaceholderResult('contribute', chainId, {
          projectId: projectId,
          amountWei: amountWei
        });
      },
      setPayoutAddress: function (projectId, payoutAddress) {
        var chainId = currentChainId();
        GTPAppState.assertCanWrite();
        return createPlaceholderResult('setPayoutAddress', chainId, {
          projectId: projectId,
          payoutAddress: payoutAddress
        });
      },
      withdraw: function (projectId, amountWei) {
        var chainId = currentChainId();
        GTPAppState.assertCanWrite();
        return createPlaceholderResult('withdraw', chainId, {
          projectId: projectId,
          amountWei: amountWei
        });
      }
    };
  }

  return {
    PROJECT_REGISTRY_ABI: PROJECT_REGISTRY_ABI.slice(),
    PROFILE_REGISTRY_ABI: PROFILE_REGISTRY_ABI.slice(),
    TREASURY_ABI: TREASURY_ABI.slice(),
    create: create,
    getContractsForChain: getContractsForChain
  };
 }());

window.GTPContractAdapter = GTPContractAdapter;
