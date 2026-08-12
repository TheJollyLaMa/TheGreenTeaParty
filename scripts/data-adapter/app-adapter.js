/* global window, ethers, GTPContractAdapter, GTPConfig */

var GTPAppDataAdapter = (function () {
  'use strict';

  var DEFAULT_CHAIN_ID = 10;

  function fetchJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) {
        throw new Error('[GTPAppDataAdapter] Failed to load ' + url + ' (HTTP ' + res.status + ')');
      }
      return res.json();
    });
  }

  // ---- Live event feed -------------------------------------------------------

  /**
   * Fetches all known contract events from the three GTP contracts on Optimism
   * and maps them into the shape expected by GTPData.normalizeActivity().
   *
   * CONTRACT_EVENT_MAP in data-layer.js keys on these eventName values:
   *   ProjectRegistered, ProjectMetadataUpdated, ProjectStatusUpdated,
   *   ProjectStewardTransferred, ContributionReceived, PayoutAddressUpdated,
   *   Withdrawal, ProfileURIUpdated
   */
  function fetchLiveActivity(chainId) {
    if (typeof window === 'undefined' || typeof window.ethers === 'undefined') {
      console.warn('[GTPAppDataAdapter] ethers.js not loaded — returning empty activity list.');
      return Promise.resolve([]);
    }

    var networks = GTPConfig && GTPConfig.networks ? GTPConfig.networks : {};
    var net = networks[chainId];
    if (!net || !net.rpcUrl) {
      console.warn('[GTPAppDataAdapter] No RPC URL for chainId ' + chainId + ' — returning empty activity list.');
      return Promise.resolve([]);
    }

    var contractsCfg = GTPConfig && GTPConfig.contracts ? (GTPConfig.contracts[chainId] || {}) : {};
    if (!contractsCfg.projectRegistry || !contractsCfg.treasury || !contractsCfg.profileRegistry) {
      console.warn('[GTPAppDataAdapter] Contract addresses not configured for chainId ' + chainId);
      return Promise.resolve([]);
    }

    var fromBlock = typeof contractsCfg.fromBlock === 'number' ? contractsCfg.fromBlock : 0;

    var PROJECT_REGISTRY_ABI = GTPContractAdapter.PROJECT_REGISTRY_ABI;
    var PROFILE_REGISTRY_ABI = GTPContractAdapter.PROFILE_REGISTRY_ABI;
    var TREASURY_ABI = GTPContractAdapter.TREASURY_ABI;

    var provider;
    try {
      provider = new window.ethers.JsonRpcProvider(net.rpcUrl, chainId);
    } catch (e) {
      console.warn('[GTPAppDataAdapter] Could not create provider:', e);
      return Promise.resolve([]);
    }

    var registry = new window.ethers.Contract(contractsCfg.projectRegistry, PROJECT_REGISTRY_ABI, provider);
    var treasury = new window.ethers.Contract(contractsCfg.treasury, TREASURY_ABI, provider);
    var profile = new window.ethers.Contract(contractsCfg.profileRegistry, PROFILE_REGISTRY_ABI, provider);

    var eventQueries = [
      { contract: registry, event: 'ProjectRegistered' },
      { contract: registry, event: 'ProjectMetadataUpdated' },
      { contract: registry, event: 'ProjectStatusUpdated' },
      { contract: registry, event: 'ProjectStewardTransferred' },
      { contract: treasury, event: 'ContributionReceived' },
      { contract: treasury, event: 'PayoutAddressUpdated' },
      { contract: treasury, event: 'Withdrawal' },
      { contract: profile, event: 'ProfileURIUpdated' }
    ];

    var queries = eventQueries.map(function (q) {
      return q.contract.queryFilter(q.contract.filters[q.event](), fromBlock, 'latest')
        .then(function (logs) {
          return logs.map(function (log) {
            return mapLogToActivity(log, q.event, chainId);
          });
        })
        .catch(function (err) {
          console.warn('[GTPAppDataAdapter] queryFilter(' + q.event + ') failed:', err);
          return [];
        });
    });

    return Promise.all(queries).then(function (results) {
      var merged = [];
      results.forEach(function (rows) {
        rows.forEach(function (row) { merged.push(row); });
      });

      if (!merged.length) return merged;

      // Resolve block timestamps in a batch (one request per unique block)
      var uniqueBlocks = {};
      merged.forEach(function (row) {
        if (row.blockNumber && !row.blockTimestamp) {
          uniqueBlocks[row.blockNumber] = true;
        }
      });

      var blockNumbers = Object.keys(uniqueBlocks).map(Number);
      var blockFetches = blockNumbers.map(function (bn) {
        return provider.getBlock(bn).then(function (block) {
          return { bn: bn, timestamp: block && block.timestamp ? block.timestamp : null };
        }).catch(function () {
          return { bn: bn, timestamp: null };
        });
      });

      return Promise.all(blockFetches).then(function (blockResults) {
        var timestampByBlock = {};
        blockResults.forEach(function (b) {
          if (b.timestamp) timestampByBlock[b.bn] = b.timestamp;
        });

        merged.forEach(function (row) {
          if (!row.blockTimestamp && timestampByBlock[row.blockNumber]) {
            row.blockTimestamp = timestampByBlock[row.blockNumber];
          }
        });

        // Sort newest-first by blockNumber then logIndex
        merged.sort(function (a, b) {
          if (b.blockNumber !== a.blockNumber) return b.blockNumber - a.blockNumber;
          return (b.logIndex || 0) - (a.logIndex || 0);
        });
        return merged;
      });
    });
  }

  /**
   * Maps an ethers log to the flat activity shape consumed by normalizeActivity()
   * in data-layer.js.  Fields used by normalizeActivity:
   *   eventName, type, title, amount, date/blockTimestamp,
   *   projectId, direction, status, category, description,
   *   notes, proofUrl, transactionHash, logIndex, blockNumber, args
   */
  function mapLogToActivity(log, eventName, chainId) {
    var args = {};
    var projectId = null;
    var amount = null;

    try {
      // log.args is a Result object — copy named keys into a plain object
      if (log.args) {
        var fragment = log.fragment;
        if (fragment && fragment.inputs) {
          fragment.inputs.forEach(function (input) {
            var raw = log.args[input.name];
            if (raw !== undefined) {
              // Convert BigInt to string for safe serialisation
              args[input.name] = typeof raw === 'bigint' ? raw.toString() : raw;
            }
          });
        }
      }
    } catch (e) {
      // best-effort
    }

    // Extract projectId (bytes32 → hex string) and amount (wei → ETH number)
    if (args.projectId !== undefined) {
      projectId = args.projectId;
    }
    if (args.amount !== undefined) {
      try {
        amount = parseFloat(window.ethers.formatEther(BigInt(args.amount)));
      } catch (e) {
        amount = null;
      }
    }

    // Approximate date from block timestamp when available; fall back to block number
    var blockTimestamp = log.blockTimestamp || null; // populated by some providers
    var dateValue = blockTimestamp || null;

    return {
      eventName: eventName,
      type: eventName,
      title: eventName,
      amount: amount,
      // normalizeActivity looks at raw.timestamp then raw.blockTimestamp then raw.date
      blockTimestamp: dateValue,
      blockNumber: log.blockNumber || 0,
      logIndex: log.index !== undefined ? log.index : (log.logIndex || 0),
      transactionHash: log.transactionHash || null,
      projectId: projectId,
      status: 'confirmed',
      notes: '',
      proofUrl: log.transactionHash
        ? (net_blockExplorer(chainId) + '/tx/' + log.transactionHash)
        : null,
      args: args
    };
  }

  function net_blockExplorer(chainId) {
    var networks = GTPConfig && GTPConfig.networks ? GTPConfig.networks : {};
    var net = networks[chainId || DEFAULT_CHAIN_ID];
    return (net && net.blockExplorer) || 'https://optimistic.etherscan.io';
  }

  // ---- create() --------------------------------------------------------------

  function create(options) {
    var basePath = (options && options.basePath) || '';
    var appState = options && options.appState;
    var contractAdapter = GTPContractAdapter.create({
      chainId: appState && typeof appState.getSessionIdentity === 'function'
        ? appState.getSessionIdentity().chainId
        : null
    });

    function resolvedChainId() {
      if (appState && typeof appState.getSessionIdentity === 'function') {
        return appState.getSessionIdentity().chainId || DEFAULT_CHAIN_ID;
      }
      return DEFAULT_CHAIN_ID;
    }

    return {
      getProjects: function () {
        return fetchJson(basePath + 'data/projects.json');
      },
      getAssociations: function () {
        return fetchJson(basePath + 'data/associations.json');
      },
      getActivity: function () {
        return fetchLiveActivity(resolvedChainId()).catch(function (err) {
          console.warn('[GTPAppDataAdapter] Live activity fetch failed:', err);
          return [];
        });
      },
      getMetrics: function () {
        return contractAdapter.getContractState().then(function (contractState) {
          return {
            availableFunds: 0,
            placeholder: !contractState.ready,
            reason: contractState.ready
              ? ''
              : (contractState.reason || 'Connect wallet to load live treasury data.')
          };
        });
      },
      getContractState: function () {
        return contractAdapter.getContractState();
      },
      getProjectRecord: function (projectId) {
        return contractAdapter.getProjectRecord(projectId);
      },
      getProjectBalance: function (projectId) {
        return contractAdapter.getProjectBalance(projectId);
      },
      getProfilePointer: function (account) {
        return contractAdapter.getProfilePointer(account);
      },
      registerProject: function (projectId, steward, metadataURI) {
        return contractAdapter.registerProject(projectId, steward, metadataURI);
      },
      updateProjectMetadataURI: function (projectId, metadataURI) {
        return contractAdapter.updateProjectMetadataURI(projectId, metadataURI);
      },
      updateProjectStatus: function (projectId, nextStatus) {
        return contractAdapter.updateProjectStatus(projectId, nextStatus);
      },
      transferProjectSteward: function (projectId, nextSteward) {
        return contractAdapter.transferProjectSteward(projectId, nextSteward);
      },
      setProfilePointer: function (profileURI) {
        return contractAdapter.setProfilePointer(profileURI);
      },
      contribute: function (projectId, contributeOptions) {
        return contractAdapter.contribute(projectId, contributeOptions);
      },
      setPayoutAddress: function (projectId, payoutAddress) {
        return contractAdapter.setPayoutAddress(projectId, payoutAddress);
      },
      withdraw: function (projectId, amountWei) {
        return contractAdapter.withdraw(projectId, amountWei);
      }
    };
  }

  return {
    create: create
  };
}());

window.GTPAppDataAdapter = GTPAppDataAdapter;

