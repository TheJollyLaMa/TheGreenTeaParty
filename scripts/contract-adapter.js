/* global window, ethers, GTPAppState, GTPConfig */

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

  // ---- Provider helpers -------------------------------------------------------

  function ethersAvailable() {
    return typeof window !== 'undefined' && typeof window.ethers !== 'undefined';
  }

  /**
   * Returns a read-only JsonRpcProvider for the given chainId.
   * Falls back to null if ethers is not loaded or the network has no RPC URL.
   */
  function getReadProvider(chainId) {
    if (!ethersAvailable()) return null;
    var networks = GTPConfig && GTPConfig.networks ? GTPConfig.networks : {};
    var net = networks[chainId];
    if (!net || !net.rpcUrl) return null;
    try {
      return new window.ethers.JsonRpcProvider(net.rpcUrl, chainId);
    } catch (e) {
      console.warn('[GTPContractAdapter] Could not create JsonRpcProvider', e);
      return null;
    }
  }

  /**
   * Returns a signer-backed provider from the injected wallet.
   * Throws if wallet is unavailable.
   */
  function getSignerProvider() {
    if (!ethersAvailable()) throw new Error('ethers.js is not loaded.');
    var injected = window.ethereum;
    if (!injected) throw new Error('No injected wallet found. Install MetaMask to continue.');
    return new window.ethers.BrowserProvider(injected);
  }

  /**
   * Converts a human-readable project ID string to bytes32.
   * If the value is already a 0x-prefixed 32-byte hex string it is returned as-is.
   */
  function toBytes32(value) {
    if (!ethersAvailable()) throw new Error('ethers.js is not loaded.');
    if (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)) {
      return value;
    }
    return window.ethers.keccak256(window.ethers.toUtf8Bytes(String(value)));
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

  // ---- Contract factories -----------------------------------------------------

  function readRegistry(chainId) {
    var contracts = getContractsForChain(chainId);
    var provider = getReadProvider(chainId);
    if (!provider) throw new Error('Read provider unavailable for chainId ' + chainId);
    return new window.ethers.Contract(contracts.projectRegistry, PROJECT_REGISTRY_ABI, provider);
  }

  function readTreasury(chainId) {
    var contracts = getContractsForChain(chainId);
    var provider = getReadProvider(chainId);
    if (!provider) throw new Error('Read provider unavailable for chainId ' + chainId);
    return new window.ethers.Contract(contracts.treasury, TREASURY_ABI, provider);
  }

  function readProfile(chainId) {
    var contracts = getContractsForChain(chainId);
    var provider = getReadProvider(chainId);
    if (!provider) throw new Error('Read provider unavailable for chainId ' + chainId);
    return new window.ethers.Contract(contracts.profileRegistry, PROFILE_REGISTRY_ABI, provider);
  }

  // ---- create() ---------------------------------------------------------------

  function create(options) {
    function currentChainId() {
      return resolveChainId(options);
    }

    function assertCanWrite() {
      if (GTPAppState && typeof GTPAppState.assertCanWrite === 'function') {
        GTPAppState.assertCanWrite();
      }
    }

    return {
      // -- Reads ----------------------------------------------------------------

      getContractState: function () {
        var chainId = currentChainId();
        var contracts = getContractsForChain(chainId);
        var provider = chainId ? getReadProvider(chainId) : null;

        if (!provider) {
          return Promise.resolve({
            placeholder: false,
            chainId: chainId,
            contracts: contracts,
            ready: false,
            reason: chainId
              ? 'RPC provider unavailable for chain ' + chainId + '.'
              : 'No network selected.'
          });
        }

        return provider.getNetwork().then(function (network) {
          var readiness = getReadiness(chainId);
          return {
            placeholder: false,
            chainId: Number(network.chainId),
            contracts: contracts,
            ready: readiness.ready,
            reason: readiness.reason
          };
        }).catch(function (err) {
          console.warn('[GTPContractAdapter] getContractState RPC error', err);
          return {
            placeholder: false,
            chainId: chainId,
            contracts: contracts,
            ready: false,
            reason: 'Could not reach Optimism RPC. Check your connection.'
          };
        });
      },

      getProjectRecord: function (projectId) {
        var chainId = currentChainId();
        if (!ethersAvailable() || !chainId) {
          return Promise.resolve({ ok: false, placeholder: true, action: 'getProjectRecord', chainId: chainId });
        }
        return readRegistry(chainId).getProject(toBytes32(projectId))
          .then(function (result) {
            return {
              ok: true,
              placeholder: false,
              projectId: projectId,
              steward: result.steward,
              metadataURI: result.metadataURI,
              status: Number(result.status)
            };
          })
          .catch(function (err) {
            console.warn('[GTPContractAdapter] getProjectRecord error', err);
            return { ok: false, placeholder: false, action: 'getProjectRecord', chainId: chainId, error: err.message };
          });
      },

      getProjectBalance: function (projectId) {
        var chainId = currentChainId();
        if (!ethersAvailable() || !chainId) {
          return Promise.resolve({ ok: false, placeholder: true, action: 'getProjectBalance', chainId: chainId });
        }
        return readTreasury(chainId).projectBalances(toBytes32(projectId))
          .then(function (balanceWei) {
            return {
              ok: true,
              placeholder: false,
              projectId: projectId,
              balanceWei: balanceWei.toString(),
              balanceEth: window.ethers.formatEther(balanceWei)
            };
          })
          .catch(function (err) {
            console.warn('[GTPContractAdapter] getProjectBalance error', err);
            return { ok: false, placeholder: false, action: 'getProjectBalance', chainId: chainId, error: err.message };
          });
      },

      getProfilePointer: function (account) {
        var chainId = currentChainId();
        if (!ethersAvailable() || !chainId) {
          return Promise.resolve({ ok: false, placeholder: true, action: 'getProfilePointer', chainId: chainId });
        }
        return readProfile(chainId).getProfileURI(account)
          .then(function (profileURI) {
            return {
              ok: true,
              placeholder: false,
              account: account,
              profileURI: profileURI
            };
          })
          .catch(function (err) {
            console.warn('[GTPContractAdapter] getProfilePointer error', err);
            return { ok: false, placeholder: false, action: 'getProfilePointer', chainId: chainId, error: err.message };
          });
      },

      // -- Writes ---------------------------------------------------------------

      registerProject: function (projectId, steward, metadataURI) {
        assertCanWrite();
        var chainId = currentChainId();
        var contracts = getContractsForChain(chainId);
        return getSignerProvider().getSigner().then(function (signer) {
          var registry = new window.ethers.Contract(contracts.projectRegistry, PROJECT_REGISTRY_ABI, signer);
          return registry.registerProject(toBytes32(projectId), steward, metadataURI);
        }).then(function (tx) {
          return { ok: true, placeholder: false, action: 'registerProject', tx: tx };
        }).catch(function (err) {
          console.warn('[GTPContractAdapter] registerProject error', err);
          return { ok: false, placeholder: false, action: 'registerProject', chainId: chainId, error: err.message };
        });
      },

      updateProjectMetadataURI: function (projectId, metadataURI) {
        assertCanWrite();
        var chainId = currentChainId();
        var contracts = getContractsForChain(chainId);
        return getSignerProvider().getSigner().then(function (signer) {
          var registry = new window.ethers.Contract(contracts.projectRegistry, PROJECT_REGISTRY_ABI, signer);
          return registry.updateProjectMetadataURI(toBytes32(projectId), metadataURI);
        }).then(function (tx) {
          return { ok: true, placeholder: false, action: 'updateProjectMetadataURI', tx: tx };
        }).catch(function (err) {
          console.warn('[GTPContractAdapter] updateProjectMetadataURI error', err);
          return { ok: false, placeholder: false, action: 'updateProjectMetadataURI', chainId: chainId, error: err.message };
        });
      },

      updateProjectStatus: function (projectId, nextStatus) {
        assertCanWrite();
        var chainId = currentChainId();
        var contracts = getContractsForChain(chainId);
        return getSignerProvider().getSigner().then(function (signer) {
          var registry = new window.ethers.Contract(contracts.projectRegistry, PROJECT_REGISTRY_ABI, signer);
          return registry.updateProjectStatus(toBytes32(projectId), nextStatus);
        }).then(function (tx) {
          return { ok: true, placeholder: false, action: 'updateProjectStatus', tx: tx };
        }).catch(function (err) {
          console.warn('[GTPContractAdapter] updateProjectStatus error', err);
          return { ok: false, placeholder: false, action: 'updateProjectStatus', chainId: chainId, error: err.message };
        });
      },

      transferProjectSteward: function (projectId, nextSteward) {
        assertCanWrite();
        var chainId = currentChainId();
        var contracts = getContractsForChain(chainId);
        return getSignerProvider().getSigner().then(function (signer) {
          var registry = new window.ethers.Contract(contracts.projectRegistry, PROJECT_REGISTRY_ABI, signer);
          return registry.transferSteward(toBytes32(projectId), nextSteward);
        }).then(function (tx) {
          return { ok: true, placeholder: false, action: 'transferProjectSteward', tx: tx };
        }).catch(function (err) {
          console.warn('[GTPContractAdapter] transferProjectSteward error', err);
          return { ok: false, placeholder: false, action: 'transferProjectSteward', chainId: chainId, error: err.message };
        });
      },

      setProfilePointer: function (profileURI) {
        assertCanWrite();
        var chainId = currentChainId();
        var contracts = getContractsForChain(chainId);
        return getSignerProvider().getSigner().then(function (signer) {
          var profile = new window.ethers.Contract(contracts.profileRegistry, PROFILE_REGISTRY_ABI, signer);
          return profile.setProfileURI(profileURI);
        }).then(function (tx) {
          return { ok: true, placeholder: false, action: 'setProfilePointer', tx: tx };
        }).catch(function (err) {
          console.warn('[GTPContractAdapter] setProfilePointer error', err);
          return { ok: false, placeholder: false, action: 'setProfilePointer', chainId: chainId, error: err.message };
        });
      },

      contribute: function (projectId, contributeOptions) {
        assertCanWrite();
        var chainId = currentChainId();
        var contracts = getContractsForChain(chainId);
        var valueWei = contributeOptions && contributeOptions.value != null
          ? window.ethers.parseEther(String(contributeOptions.value))
          : 0n;
        return getSignerProvider().getSigner().then(function (signer) {
          var treasury = new window.ethers.Contract(contracts.treasury, TREASURY_ABI, signer);
          return treasury.contribute(toBytes32(projectId), { value: valueWei });
        }).then(function (tx) {
          return { ok: true, placeholder: false, action: 'contribute', tx: tx };
        }).catch(function (err) {
          console.warn('[GTPContractAdapter] contribute error', err);
          return { ok: false, placeholder: false, action: 'contribute', chainId: chainId, error: err.message };
        });
      },

      setPayoutAddress: function (projectId, payoutAddress) {
        assertCanWrite();
        var chainId = currentChainId();
        var contracts = getContractsForChain(chainId);
        return getSignerProvider().getSigner().then(function (signer) {
          var treasury = new window.ethers.Contract(contracts.treasury, TREASURY_ABI, signer);
          return treasury.setPayoutAddress(toBytes32(projectId), payoutAddress);
        }).then(function (tx) {
          return { ok: true, placeholder: false, action: 'setPayoutAddress', tx: tx };
        }).catch(function (err) {
          console.warn('[GTPContractAdapter] setPayoutAddress error', err);
          return { ok: false, placeholder: false, action: 'setPayoutAddress', chainId: chainId, error: err.message };
        });
      },

      withdraw: function (projectId, amountWei) {
        assertCanWrite();
        var chainId = currentChainId();
        var contracts = getContractsForChain(chainId);
        return getSignerProvider().getSigner().then(function (signer) {
          var treasury = new window.ethers.Contract(contracts.treasury, TREASURY_ABI, signer);
          return treasury.withdraw(toBytes32(projectId), amountWei);
        }).then(function (tx) {
          return { ok: true, placeholder: false, action: 'withdraw', tx: tx };
        }).catch(function (err) {
          console.warn('[GTPContractAdapter] withdraw error', err);
          return { ok: false, placeholder: false, action: 'withdraw', chainId: chainId, error: err.message };
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

