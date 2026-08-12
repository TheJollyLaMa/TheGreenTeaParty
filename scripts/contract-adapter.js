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

  var CONTRACT_DEFINITIONS = {
    projectRegistry: { key: 'projectRegistry', label: 'ProjectRegistry', abi: PROJECT_REGISTRY_ABI },
    treasury: { key: 'treasury', label: 'Treasury', abi: TREASURY_ABI },
    profileRegistry: { key: 'profileRegistry', label: 'ProfileRegistry', abi: PROFILE_REGISTRY_ABI }
  };

  function getContractsForChain(chainId) {
    var contracts = GTPConfig && GTPConfig.contracts ? GTPConfig.contracts : {};
    return contracts[chainId] || {
      projectRegistry: null,
      treasury: null,
      profileRegistry: null
    };
  }

  function getContractDefinition(contractKey, chainId) {
    var base = CONTRACT_DEFINITIONS[contractKey];
    if (!base) return null;
    var contracts = getContractsForChain(chainId);
    return {
      key: base.key,
      label: base.label,
      abi: base.abi.slice(),
      address: contracts[contractKey] || null
    };
  }

  function normalizeProjectIdKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function getCanonicalProjectId(value) {
    if (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)) {
      return value;
    }

    var trimmed = String(value || '').trim();
    if (!trimmed) return trimmed;

    var aliases = GTPConfig && GTPConfig.projectIdAliases ? GTPConfig.projectIdAliases : {};
    var canonicalMap = {};
    Object.keys(aliases).forEach(function (canonicalId) {
      canonicalMap[normalizeProjectIdKey(canonicalId)] = canonicalId;
      var aliasList = Array.isArray(aliases[canonicalId]) ? aliases[canonicalId] : [];
      aliasList.forEach(function (alias) {
        canonicalMap[normalizeProjectIdKey(alias)] = canonicalId;
      });
    });

    return canonicalMap[normalizeProjectIdKey(trimmed)] || trimmed;
  }

  function getErrorMessage(error) {
    if (!error) return 'Unknown error';
    return error.shortMessage
      || error.reason
      || error.info && error.info.error && error.info.error.message
      || error.data && error.data.message
      || error.message
      || String(error);
  }

  function buildDiagnostics(chainId, contractKey, signerAddress, txHash, error) {
    var definition = getContractDefinition(contractKey, chainId);
    return {
      chainId: chainId,
      contractAddress: definition ? definition.address : null,
      signerAddress: signerAddress || null,
      txHash: txHash || null,
      revertReason: error ? getErrorMessage(error) : null
    };
  }

  function rememberRegisteredProjectId(projectId) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    var canonicalProjectId = getCanonicalProjectId(projectId);
    if (!canonicalProjectId || /^0x[0-9a-fA-F]{64}$/.test(canonicalProjectId)) return;
    var storageKey = 'gtp.registeredProjectIds';
    try {
      var parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
      var next = Array.isArray(parsed) ? parsed.slice() : [];
      if (next.indexOf(canonicalProjectId) === -1) {
        next.push(canonicalProjectId);
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      }
    } catch (error) {
      console.warn('[GTPContractAdapter] Could not persist registered project id', error);
    }
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
    var definition = getContractDefinition('projectRegistry', chainId);
    var provider = getReadProvider(chainId);
    if (!provider) throw new Error('Read provider unavailable for chainId ' + chainId);
    return new window.ethers.Contract(definition.address, definition.abi, provider);
  }

  function readTreasury(chainId) {
    var definition = getContractDefinition('treasury', chainId);
    var provider = getReadProvider(chainId);
    if (!provider) throw new Error('Read provider unavailable for chainId ' + chainId);
    return new window.ethers.Contract(definition.address, definition.abi, provider);
  }

  function readProfile(chainId) {
    var definition = getContractDefinition('profileRegistry', chainId);
    var provider = getReadProvider(chainId);
    if (!provider) throw new Error('Read provider unavailable for chainId ' + chainId);
    return new window.ethers.Contract(definition.address, definition.abi, provider);
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
        var canonicalProjectId = getCanonicalProjectId(projectId);
        var projectIdBytes32 = toBytes32(canonicalProjectId);
        var registry = readRegistry(chainId);
        return registry.getProject(projectIdBytes32)
          .then(function (result) {
            return {
              ok: true,
              placeholder: false,
              projectId: canonicalProjectId,
              projectIdBytes32: projectIdBytes32,
              steward: result.steward,
              metadataURI: result.metadataURI,
              status: Number(result.status),
              retrievalSource: 'storage'
            };
          })
          .catch(function (err) {
            return registry.queryFilter(registry.filters.ProjectRegistered(projectIdBytes32), 0, 'latest')
              .then(function (logs) {
                if (!logs.length) throw err;
                var latest = logs[logs.length - 1];
                return {
                  ok: true,
                  placeholder: false,
                  projectId: canonicalProjectId,
                  projectIdBytes32: projectIdBytes32,
                  steward: latest.args && latest.args.steward ? latest.args.steward : null,
                  metadataURI: latest.args && latest.args.metadataURI ? latest.args.metadataURI : '',
                  status: latest.args && latest.args.status !== undefined ? Number(latest.args.status) : 0,
                  retrievalSource: 'event-fallback'
                };
              })
              .catch(function () {
                console.warn('[GTPContractAdapter] getProjectRecord error', err);
                return {
                  ok: false,
                  placeholder: false,
                  action: 'getProjectRecord',
                  chainId: chainId,
                  projectId: canonicalProjectId,
                  projectIdBytes32: projectIdBytes32,
                  error: getErrorMessage(err)
                };
              });
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
        var definition = getContractDefinition('projectRegistry', chainId);
        var canonicalProjectId = getCanonicalProjectId(projectId);
        var projectIdBytes32 = toBytes32(canonicalProjectId);
        var signerAddress = null;
        var txRef = null;
        return getSignerProvider().getSigner().then(function (signer) {
          signerAddress = typeof signer.getAddress === 'function' ? null : signer.address;
          return Promise.resolve(typeof signer.getAddress === 'function' ? signer.getAddress() : signer.address)
            .then(function (resolvedSignerAddress) {
              signerAddress = resolvedSignerAddress || signerAddress;
              var registry = new window.ethers.Contract(definition.address, definition.abi, signer);
              return registry.registerProject(projectIdBytes32, steward, metadataURI).then(function (tx) {
                txRef = tx;
                return tx.wait(1).then(function (receipt) {
                  return registry.getProject(projectIdBytes32).then(function (readback) {
                    rememberRegisteredProjectId(canonicalProjectId);
                    return {
                      ok: true,
                      placeholder: false,
                      action: 'registerProject',
                      projectId: canonicalProjectId,
                      projectIdBytes32: projectIdBytes32,
                      chainId: chainId,
                      contractAddress: definition.address,
                      signerAddress: signerAddress,
                      txHash: tx.hash,
                      tx: tx,
                      receipt: receipt,
                      readback: {
                        steward: readback.steward,
                        metadataURI: readback.metadataURI,
                        status: Number(readback.status)
                      },
                      diagnostics: buildDiagnostics(chainId, 'projectRegistry', signerAddress, tx.hash, null)
                    };
                  });
                });
              });
            });
        }).catch(function (err) {
          console.warn('[GTPContractAdapter] registerProject error', err);
          return {
            ok: false,
            placeholder: false,
            action: 'registerProject',
            chainId: chainId,
            projectId: canonicalProjectId,
            projectIdBytes32: projectIdBytes32,
            contractAddress: definition ? definition.address : null,
            signerAddress: signerAddress,
            txHash: txRef && txRef.hash ? txRef.hash : null,
            error: getErrorMessage(err),
            diagnostics: buildDiagnostics(chainId, 'projectRegistry', signerAddress, txRef && txRef.hash ? txRef.hash : null, err)
          };
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
        var rawValue = contributeOptions && contributeOptions.value != null
          ? contributeOptions.value
          : null;
        if (rawValue === null || rawValue === '' || rawValue === 0 || rawValue === '0') {
          return Promise.resolve({
            ok: false,
            placeholder: false,
            action: 'contribute',
            chainId: chainId,
            error: 'A non-zero ETH value is required. Pass { value: "0.01" } (in ETH) to contribute.'
          });
        }
        var valueWei = window.ethers.parseEther(String(rawValue));
        if (valueWei === 0n) {
          return Promise.resolve({
            ok: false,
            placeholder: false,
            action: 'contribute',
            chainId: chainId,
            error: 'Contribution value must be greater than zero.'
          });
        }
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
    getContractsForChain: getContractsForChain,
    getContractDefinition: getContractDefinition,
    getCanonicalProjectId: getCanonicalProjectId,
    buildDiagnostics: buildDiagnostics
  };
}());

window.GTPContractAdapter = GTPContractAdapter;
