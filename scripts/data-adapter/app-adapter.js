/* global window, ethers, GTPContractAdapter, GTPConfig */

var GTPAppDataAdapter = (function () {
  'use strict';

  var DEFAULT_CHAIN_ID = 10;

  var CONTRACT_STATUS_TO_LABEL = { 0: 'draft', 1: 'active', 2: 'paused', 3: 'completed' };

  function fetchJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) {
        throw new Error('[GTPAppDataAdapter] Failed to load ' + url + ' (HTTP ' + res.status + ')');
      }
      return res.json();
    });
  }

  function errorMessage(err) {
    if (!err) return '';
    if (typeof err.message === 'string') return err.message;
    if (err.error && typeof err.error.message === 'string') return err.error.message;
    return String(err);
  }

  function toFiniteNumber(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'bigint') {
      if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
        return Number(value);
      }
      return fallback;
    }
    if (typeof value === 'string' && value.trim()) {
      var parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }

  var DEFAULT_TRACK_LABEL = 'Green Tea';

  function normalizeTrackLabel(value) {
    var track = String(value || '').trim();
    return track || DEFAULT_TRACK_LABEL;
  }

  function getCanonicalTrackLabel(value) {
    var canonicalLabels = window.GTPTrackLabels || [];
    var track = String(value || '').trim().toLowerCase();
    for (var i = 0; i < canonicalLabels.length; i += 1) {
      if (canonicalLabels[i].toLowerCase() === track) {
        return canonicalLabels[i];
      }
    }
    return null;
  }

  function resolveLayoutTrack(value) {
    return getCanonicalTrackLabel(value) || DEFAULT_TRACK_LABEL;
  }

  function isBlockRangeTooLargeError(err) {
    var msg = errorMessage(err).toLowerCase();
    return msg.indexOf('block range is too large') !== -1
      || (msg.indexOf('block range') !== -1 && msg.indexOf('too large') !== -1)
      || msg.indexOf('eth_getlogs is limited') !== -1
      || (msg.indexOf('eth_getlogs') !== -1 && msg.indexOf('limited') !== -1)
      || msg.indexOf('limited to a 10,000') !== -1
      || msg.indexOf('10,000 range') !== -1;
  }

  function queryFilterResilient(contract, filter, fromBlock, toBlock, provider) {
    function queryRange(startBlock, endBlock) {
      if (startBlock > endBlock) return Promise.resolve([]);
      return contract.queryFilter(filter, startBlock, endBlock).catch(function (err) {
        if (!isBlockRangeTooLargeError(err)) throw err;
        if (startBlock >= endBlock) return [];
        var mid = Math.floor((startBlock + endBlock) / 2);
        return queryRange(startBlock, mid).then(function (leftLogs) {
          return queryRange(mid + 1, endBlock).then(function (rightLogs) {
            return leftLogs.concat(rightLogs);
          });
        });
      });
    }

    var normalizedFromBlock = Number(fromBlock);
    if (!Number.isFinite(normalizedFromBlock) || normalizedFromBlock < 0) {
      normalizedFromBlock = 0;
    }

    if (toBlock === 'latest') {
      return provider.getBlockNumber().then(function (latestBlock) {
        if (!Number.isFinite(latestBlock) || normalizedFromBlock > latestBlock) return [];
        return queryRange(normalizedFromBlock, latestBlock);
      });
    }

    var normalizedToBlock = Number(toBlock);
    if (!Number.isFinite(normalizedToBlock) || normalizedFromBlock > normalizedToBlock) return [];
    return queryRange(normalizedFromBlock, normalizedToBlock);
  }

  // ---- Live project list from ProjectRegistry --------------------------------

  /**
   * Returns a Promise<Object[]> of project objects built from on-chain data.
   *
   * Strategy:
   *  1. Query all ProjectRegistered events to enumerate project IDs.
   *  2. For each ID, call getProject() to read the current state.
   *  3. Resolve metadataURI — if it starts with "{" parse it as inline JSON;
   *     if it is an HTTP/IPFS URL, fetch it; otherwise treat it as a label.
   *  4. Merge on-chain fields (steward, status) with metadata fields.
   *
   * Required project shape for data-layer.js:
   *   { id, name, track, status, raised, goal }
   * All other fields are optional but surfaced if present in the metadata.
   */
  function fetchProjectsFromRegistry(chainId) {
    if (typeof window === 'undefined' || typeof window.ethers === 'undefined') {
      console.warn('[GTPAppDataAdapter] ethers.js not loaded — returning empty project list.');
      return Promise.resolve([]);
    }

    var networks = GTPConfig && GTPConfig.networks ? GTPConfig.networks : {};
    var net = networks[chainId];
    if (!net || !net.rpcUrl) {
      console.warn('[GTPAppDataAdapter] No RPC URL for chainId ' + chainId + ' — returning empty project list.');
      return Promise.resolve([]);
    }

    var contractsCfg = GTPConfig && GTPConfig.contracts ? (GTPConfig.contracts[chainId] || {}) : {};
    if (!contractsCfg.projectRegistry) {
      console.warn('[GTPAppDataAdapter] ProjectRegistry address not configured for chainId ' + chainId);
      return Promise.resolve([]);
    }

    var fromBlock = typeof contractsCfg.fromBlock === 'number' ? contractsCfg.fromBlock : 0;
    var PROJECT_REGISTRY_ABI = GTPContractAdapter.PROJECT_REGISTRY_ABI;

    var provider;
    try {
      provider = new window.ethers.JsonRpcProvider(net.rpcUrl, chainId);
    } catch (e) {
      console.warn('[GTPAppDataAdapter] Could not create provider for project fetch:', e);
      return Promise.resolve([]);
    }

    var registry = new window.ethers.Contract(contractsCfg.projectRegistry, PROJECT_REGISTRY_ABI, provider);

    function loadProjectRegistrationLogs(startBlock) {
      return queryFilterResilient(registry, registry.filters.ProjectRegistered(), startBlock, 'latest', provider);
    }

    return loadProjectRegistrationLogs(fromBlock)
      .then(function (logs) {
        if (logs.length || fromBlock <= 0) {
          return logs;
        }

        console.warn('[GTPAppDataAdapter] No ProjectRegistered logs found from block ' + fromBlock + '; retrying from genesis.');
        return loadProjectRegistrationLogs(0);
      })
      .then(function (logs) {
        if (!logs.length) return [];

        // De-duplicate by projectId, keeping the last (highest-index) event per ID.
        // The contract prevents re-registration, but this guards against edge cases.
        var latestByProjectId = {};
        logs.forEach(function (log) {
          var pid = log.args && log.args.projectId ? log.args.projectId : null;
          if (pid) {
            latestByProjectId[pid] = log;
          }
        });
        var uniqueLogs = Object.values(latestByProjectId);

        // Build project records from the registration event first.
        // Fall back to getProject() only when the event payload is incomplete.
        var stateFetches = uniqueLogs.map(function (log) {
          var projectId = log.args.projectId;
          var eventRecord = {
            projectId: projectId,
            steward: log.args && log.args.steward ? log.args.steward : null,
            metadataURI: log.args && Object.prototype.hasOwnProperty.call(log.args, 'metadataURI')
              ? log.args.metadataURI
              : null,
            status: Number(log.args && log.args.status !== undefined ? log.args.status : 0)
          };

          if (eventRecord.steward && eventRecord.metadataURI !== null) {
            return Promise.resolve(eventRecord);
          }

          return registry.getProject(projectId)
            .then(function (result) {
              return {
                projectId: projectId,
                steward: result.steward || eventRecord.steward,
                metadataURI: result.metadataURI || eventRecord.metadataURI,
                status: Number(result.status !== undefined ? result.status : eventRecord.status)
              };
            })
            .catch(function (err) {
              console.warn('[GTPAppDataAdapter] getProject(' + projectId + ') failed; using event payload only:', err);
              return eventRecord;
            });
        });

        return Promise.all(stateFetches);
      })
      .then(function (records) {
        var metaFetches = records
          .filter(function (r) { return r !== null; })
          .map(function (record) {
            return resolveMetadata(record.metadataURI)
              .then(function (meta) {
                return buildProjectObject(record, meta);
              })
              .catch(function (err) {
                console.warn('[GTPAppDataAdapter] resolveMetadata failed for ' + record.projectId, err);
                return buildProjectObject(record, {});
              });
          });

        return Promise.all(metaFetches);
      })
      .then(function (projects) {
        return projects.filter(function (p) { return p !== null; });
      })
      .catch(function (err) {
        console.warn('[GTPAppDataAdapter] fetchProjectsFromRegistry failed:', err);
        return [];
      });
  }

  /**
   * Resolves a metadataURI to a plain object.
   * - Inline JSON  ("{ ... }"): parsed directly.
   * - IPFS URI     ("ipfs://..."): fetched via public gateway.
   * - HTTP(S) URL  ("https://..."): fetched directly.
   * - Anything else: treated as the project name.
   */
  function resolveMetadata(uri) {
    if (!uri) return Promise.resolve({});

    var trimmed = uri.trim();

    // Inline JSON
    if (trimmed.charAt(0) === '{') {
      try {
        return Promise.resolve(JSON.parse(trimmed));
      } catch (e) {
        return Promise.resolve({});
      }
    }

    // IPFS URI → public gateway (overridable via GTPConfig.ipfsGateway)
    if (trimmed.indexOf('ipfs://') === 0) {
      var cid = trimmed.slice(7);
      var ipfsGateway = (GTPConfig && GTPConfig.ipfsGateway) || 'https://ipfs.io/ipfs/';
      var gatewayUrl = ipfsGateway.replace(/\/?$/, '/') + cid;
      return fetch(gatewayUrl)
        .then(function (res) { return res.ok ? res.json() : {}; })
        .catch(function () { return {}; });
    }

    // HTTP(S) URL
    if (trimmed.indexOf('http://') === 0 || trimmed.indexOf('https://') === 0) {
      return fetch(trimmed)
        .then(function (res) { return res.ok ? res.json() : {}; })
        .catch(function () { return {}; });
    }

    // Plain string — treat as project name
    return Promise.resolve({ name: trimmed });
  }

  /**
   * Merges on-chain record fields with resolved metadata into the project shape
   * expected by GTPData.normalizeProject().
   * On-chain status is authoritative; metadata status is ignored.
   */
  function buildProjectObject(record, meta) {
    var statusCode = toFiniteNumber(record && record.status, 0);
    var statusLabel = CONTRACT_STATUS_TO_LABEL[statusCode] || 'draft';

    // Use the hex projectId as the canonical id, falling back to a metadata id field
    var id = (meta && meta.id) ? String(meta.id) : String(record.projectId);
    var raised = toFiniteNumber(meta && meta.raised, 0);
    var goal = toFiniteNumber(meta && meta.goal, 0);

    return {
      id: id,
      name: String((meta && meta.name) || id),
      track: normalizeTrackLabel(meta && meta.track),
      layoutTrack: resolveLayoutTrack(meta && meta.track),
      // On-chain status is the source of truth; metadata.status is not used.
      status: statusLabel,
      raised: raised,
      goal: goal,
      lastUpdate: (meta && meta.lastUpdate) || null,
      publicUpdate: (meta && (meta.publicUpdate || meta.lastUpdate)) || null,
      stewards: (meta && typeof meta.stewards === 'number') ? meta.stewards : 1,
      description: String((meta && meta.description) || ''),
      repoUrl: (meta && meta.repoUrl) || null,
      artizenUrl: (meta && meta.artizenUrl) || null,
      ledgerUrl: (meta && meta.ledgerUrl) || null,
      contractUrl: (meta && meta.contractUrl) || null,
      githubPagesUrl: (meta && meta.githubPagesUrl) || null,
      nextAction: (meta && meta.nextAction) || null,
      location: (meta && meta.location) || null,
      // On-chain fields surfaced for the panel/detail views
      onChainSteward: record.steward,
      onChainStatus: record.status,
      projectId: record.projectId
    };
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
      return queryFilterResilient(q.contract, q.contract.filters[q.event](), fromBlock, 'latest', provider)
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
        return fetchProjectsFromRegistry(resolvedChainId()).catch(function (err) {
          console.warn('[GTPAppDataAdapter] fetchProjectsFromRegistry failed:', err);
          return [];
        });
      },
      getAssociations: function () {
        // Associations in app mode come from on-chain metadata when registered.
        // Return empty until projects are present and carry association metadata.
        return Promise.resolve([]);
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
