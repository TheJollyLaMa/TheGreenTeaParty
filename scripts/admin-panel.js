/* global window, ethers, GTPAppState, GTPContractAdapter, GTPConfig */

(function () {
  'use strict';

  // ── helpers ───────────────────────────────────────────────────────────────────

  function toBytes32(value) {
    if (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)) return value;
    return window.ethers.keccak256(window.ethers.toUtf8Bytes(String(value)));
  }

  function currentChainId() {
    if (GTPAppState && typeof GTPAppState.getSessionIdentity === 'function') {
      return GTPAppState.getSessionIdentity().chainId;
    }
    return null;
  }

  function walletReady() {
    if (!GTPAppState || typeof GTPAppState.getSessionIdentity !== 'function') return false;
    var id = GTPAppState.getSessionIdentity();
    return id.connectionStatus === 'connected'
      && id.isSupportedNetwork
      && typeof id.chainId === 'number';
  }

  function getReadProvider() {
    var chainId = currentChainId();
    if (!chainId) return null;
    var networks = GTPConfig && GTPConfig.networks ? GTPConfig.networks : {};
    var net = networks[chainId];
    if (!net || !net.rpcUrl) return null;
    try {
      return new window.ethers.JsonRpcProvider(net.rpcUrl, chainId);
    } catch (e) {
      return null;
    }
  }

  function getSignerProvider() {
    if (!window.ethereum) throw new Error('No injected wallet found.');
    return new window.ethers.BrowserProvider(window.ethereum);
  }

  function contractAddresses() {
    var chainId = currentChainId();
    if (!chainId) return {};
    if (GTPContractAdapter && typeof GTPContractAdapter.getContractsForChain === 'function') {
      return GTPContractAdapter.getContractsForChain(chainId) || {};
    }
    var contracts = GTPConfig && GTPConfig.contracts ? GTPConfig.contracts : {};
    return contracts[chainId] || {};
  }

  var FALLBACK_PROJECT_REGISTRY_ABI = [
    'function owner() view returns (address)',
    'function paused() view returns (bool)',
    'function projectExists(bytes32) view returns (bool)',
    'function getSteward(bytes32) view returns (address)',
    'function getStatus(bytes32) view returns (uint8)',
    'function getProject(bytes32) view returns (address steward, string metadataURI, uint8 status)',
    'function registerProject(bytes32, address, string)',
    'function updateProjectMetadataURI(bytes32, string)',
    'function updateProjectStatus(bytes32, uint8)',
    'function transferSteward(bytes32, address)',
    'function transferOwnership(address)',
    'function pause()',
    'function unpause()'
  ];

  var FALLBACK_TREASURY_ABI = [
    'function owner() view returns (address)',
    'function paused() view returns (bool)',
    'function projectBalances(bytes32) view returns (uint256)',
    'function payoutAddresses(bytes32) view returns (address)',
    'function contribute(bytes32) payable',
    'function setPayoutAddress(bytes32, address)',
    'function withdraw(bytes32, uint256)',
    'function transferOwnership(address)',
    'function pause()',
    'function unpause()'
  ];

  var FALLBACK_PROFILE_REGISTRY_ABI = [
    'function getProfileURI(address) view returns (string)',
    'function setProfileURI(string)'
  ];

  var PROJECT_REGISTRY_ABI = (GTPContractAdapter && GTPContractAdapter.PROJECT_REGISTRY_ABI)
    ? GTPContractAdapter.PROJECT_REGISTRY_ABI.slice()
    : FALLBACK_PROJECT_REGISTRY_ABI.slice();
  var TREASURY_ABI = (GTPContractAdapter && GTPContractAdapter.TREASURY_ABI)
    ? GTPContractAdapter.TREASURY_ABI.slice()
    : FALLBACK_TREASURY_ABI.slice();
  var PROFILE_REGISTRY_ABI = (GTPContractAdapter && GTPContractAdapter.PROFILE_REGISTRY_ABI)
    ? GTPContractAdapter.PROFILE_REGISTRY_ABI.slice()
    : FALLBACK_PROFILE_REGISTRY_ABI.slice();

  var CONTRACT_INTROSPECTION_META = [
    { key: 'projectRegistry', label: 'ProjectRegistry', abi: PROJECT_REGISTRY_ABI },
    { key: 'treasury', label: 'Treasury', abi: TREASURY_ABI },
    { key: 'profileRegistry', label: 'ProfileRegistry', abi: PROFILE_REGISTRY_ABI }
  ];

  var OWNABLE_READ_ABI = [
    'function owner() view returns (address)'
  ];

  function networkName() {
    var chainId = currentChainId();
    var networks = GTPConfig && GTPConfig.networks ? GTPConfig.networks : {};
    return (networks[chainId] && networks[chainId].name) ? networks[chainId].name : 'Optimism';
  }

  function readContract(abi, addrKey) {
    var addr = contractAddresses()[addrKey];
    if (!addr) throw new Error('Contract address not configured for this network.');
    var provider = getReadProvider();
    if (!provider) throw new Error('Read provider unavailable.');
    return new window.ethers.Contract(addr, abi, provider);
  }

  function writeContract(abi, addrKey) {
    return getSignerProvider().getSigner().then(function (signer) {
      var addr = contractAddresses()[addrKey];
      if (!addr) throw new Error('Contract address not configured for this network.');
      return new window.ethers.Contract(addr, abi, signer);
    });
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────────

  function setStatus(el, kind, text) {
    if (!el) return;
    el.textContent = text;
    el.className = 'admin-fn-status admin-fn-status--' + kind;
  }

  function clearStatus(el) {
    if (!el) return;
    el.textContent = '';
    el.className = 'admin-fn-status';
  }

  function showOutput(el, text) {
    if (!el) return;
    el.textContent = text;
    el.classList.add('visible');
  }

  function clearOutput(el) {
    if (!el) return;
    el.textContent = '';
    el.classList.remove('visible');
  }

  function txLink(tx) {
    var hash = tx && tx.hash ? tx.hash : null;
    if (!hash) return '';
    var chainId = currentChainId();
    var networks = GTPConfig && GTPConfig.networks ? GTPConfig.networks : {};
    var explorer = (networks[chainId] && networks[chainId].blockExplorer)
      ? networks[chainId].blockExplorer
      : 'https://optimistic.etherscan.io';
    return ' View: ' + explorer + '/tx/' + hash;
  }

  function val(form, name) {
    var el = form.elements[name];
    return el ? (el.value || '').trim() : '';
  }

  function updateWriteButtonsEnabled() {
    var disabled = !walletReady();
    var buttons = document.querySelectorAll('.admin-write-btn');
    buttons.forEach(function (btn) {
      btn.disabled = disabled;
      btn.title = disabled ? ('Connect wallet to ' + networkName() + ' to enable writes.') : '';
    });
  }

  function parseFunctionFragments(abi) {
    try {
      var iface = new window.ethers.Interface(abi);
      return {
        functions: iface.fragments.filter(function (fragment) { return fragment.type === 'function'; }),
        error: null
      };
    } catch (err) {
      return { functions: [], error: err.message || String(err) };
    }
  }

  function describeParams(params) {
    return params.map(function (param) {
      return param.name ? (param.type + ' ' + param.name) : param.type;
    }).join(', ');
  }

  function renderIntroFunctionCard(fragment, isRead) {
    var card = document.createElement('div');
    card.className = 'admin-fn-card' + (isRead ? ' admin-fn-read' : '');

    var title = document.createElement('h4');
    title.textContent = fragment.name + '(' + describeParams(fragment.inputs || []) + ')';
    card.appendChild(title);

    var meta = document.createElement('p');
    meta.className = 'admin-introspection-fn-meta';
    meta.textContent = 'outputs: '
      + ((fragment.outputs && fragment.outputs.length) ? describeParams(fragment.outputs) : 'void')
      + ' · mutability: '
      + fragment.stateMutability;
    card.appendChild(meta);

    return card;
  }

  function renderIntrospectionGroup(label, functions, isRead) {
    var wrapper = document.createElement('div');
    var title = document.createElement('p');
    title.className = 'admin-fn-group-label';
    title.textContent = label;
    wrapper.appendChild(title);

    var grid = document.createElement('div');
    grid.className = 'admin-fn-grid';
    functions.forEach(function (fragment) {
      grid.appendChild(renderIntroFunctionCard(fragment, isRead));
    });
    wrapper.appendChild(grid);
    return wrapper;
  }

  function renderContractIntrospection(container, context) {
    var chainId = context.chainId;
    var activeContracts = context.contracts;
    var providerStatus = context.providerStatus;
    var providerError = context.providerError;
    var anyErrors = false;
    var diagnostics = [];

    CONTRACT_INTROSPECTION_META.forEach(function (meta) {
      var parse = parseFunctionFragments(meta.abi);
      var functions = parse.functions;
      var readFns = functions.filter(function (fn) {
        return fn.stateMutability === 'view' || fn.stateMutability === 'pure';
      });
      var writeFns = functions.filter(function (fn) {
        return fn.stateMutability === 'nonpayable' || fn.stateMutability === 'payable';
      });
      var address = activeContracts && activeContracts[meta.key] ? activeContracts[meta.key] : '';

      var section = document.createElement('section');
      section.className = 'admin-contract-group admin-introspection-contract-group';

      var header = document.createElement('div');
      header.className = 'admin-contract-header';
      var heading = document.createElement('h3');
      heading.textContent = meta.label + ' (introspection)';
      header.appendChild(heading);

      var addressPill = document.createElement('span');
      addressPill.className = 'admin-contract-address admin-contract-address--inline';
      addressPill.textContent = address || 'address missing';
      header.appendChild(addressPill);
      section.appendChild(header);

      var initStatus = 'ready';
      if (!address || parse.error || providerStatus === 'error') {
        initStatus = 'error';
        anyErrors = true;
      }

      diagnostics.push(
        meta.label + ' addr=' + (address || 'missing')
          + ' fn=' + functions.length
          + ' init=' + initStatus
      );

      if (!address) {
        var missingState = document.createElement('p');
        missingState.className = 'admin-introspection-state admin-introspection-state--error';
        missingState.textContent = 'Error: contract address not configured for active chain.';
        section.appendChild(missingState);
      } else if (parse.error) {
        var parseState = document.createElement('p');
        parseState.className = 'admin-introspection-state admin-introspection-state--error';
        parseState.textContent = 'Error parsing ABI: ' + parse.error;
        section.appendChild(parseState);
      } else if (!functions.length) {
        var emptyState = document.createElement('p');
        emptyState.className = 'admin-introspection-state admin-introspection-state--empty';
        emptyState.textContent = 'No callable functions found in ABI.';
        section.appendChild(emptyState);
      } else {
        section.appendChild(renderIntrospectionGroup('Read', readFns, true));
        section.appendChild(renderIntrospectionGroup('Write', writeFns, false));
      }

      container.appendChild(section);
    });

    var diagnosticsLine = document.createElement('p');
    diagnosticsLine.className = 'admin-introspection-diagnostics';
    diagnosticsLine.textContent = 'Diagnostics · chainId='
      + (typeof chainId === 'number' ? chainId : 'n/a')
      + ' · provider=' + providerStatus
      + (providerError ? (' (' + providerError + ')') : '')
      + ' · ' + diagnostics.join(' · ');
    container.prepend(diagnosticsLine);

    if (anyErrors && providerStatus === 'error') {
      var providerState = document.createElement('p');
      providerState.className = 'admin-introspection-state admin-introspection-state--error';
      providerState.textContent = 'Initialization error: ' + providerError;
      container.prepend(providerState);
    }
  }

  function refreshContractIntrospection(container) {
    if (!container) return;
    container.innerHTML = '';

    var loadingState = document.createElement('p');
    loadingState.className = 'admin-introspection-state admin-introspection-state--loading';
    loadingState.textContent = 'Loading contract introspection…';
    container.appendChild(loadingState);

    var chainId = currentChainId();
    var contracts = contractAddresses();
    var provider = getReadProvider();
    if (!provider) {
      container.innerHTML = '';
      renderContractIntrospection(container, {
        chainId: chainId,
        contracts: contracts,
        providerStatus: 'error',
        providerError: chainId
          ? ('RPC provider unavailable for chainId ' + chainId + '.')
          : 'No network selected.',
      });
      return;
    }

    provider.getNetwork()
      .then(function (network) {
        container.innerHTML = '';
        renderContractIntrospection(container, {
          chainId: Number(network.chainId),
          contracts: contracts,
          providerStatus: 'ready',
          providerError: '',
        });
      })
      .catch(function (err) {
        container.innerHTML = '';
        renderContractIntrospection(container, {
          chainId: chainId,
          contracts: contracts,
          providerStatus: 'error',
          providerError: err && err.message ? err.message : 'Could not initialize provider.',
        });
      });
  }

  // ── Read call wrapper ─────────────────────────────────────────────────────────

  function bindRead(formId, handler) {
    var form = document.getElementById(formId);
    if (!form) return;
    var outputEl = form.querySelector('.admin-read-output');
    var statusEl = form.querySelector('.admin-fn-status');
    var btn = form.querySelector('.admin-call-btn');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearOutput(outputEl);
      clearStatus(statusEl);
      if (btn) btn.disabled = true;
      setStatus(statusEl, 'pending', 'Calling…');

      var promise;
      try {
        promise = handler(form);
      } catch (err) {
        setStatus(statusEl, 'error', err.message || String(err));
        if (btn) btn.disabled = false;
        return;
      }

      promise
        .then(function (result) {
          clearStatus(statusEl);
          showOutput(outputEl, result);
        })
        .catch(function (err) {
          setStatus(statusEl, 'error', err.message || String(err));
        })
        .finally(function () {
          if (btn) btn.disabled = false;
        });
    });

    form.addEventListener('reset', function () {
      clearStatus(statusEl);
      clearOutput(outputEl);
    });
  }

  // ── Write call wrapper ────────────────────────────────────────────────────────

  function bindWrite(formId, handler) {
    var form = document.getElementById(formId);
    if (!form) return;
    var statusEl = form.querySelector('.admin-fn-status');
    var btn = form.querySelector('.admin-write-btn');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!walletReady()) {
        setStatus(statusEl, 'error', 'Connect wallet to ' + networkName() + ' first.');
        return;
      }
      clearStatus(statusEl);
      if (btn) btn.disabled = true;
      setStatus(statusEl, 'pending', 'Sending transaction…');

      var promise;
      try {
        promise = handler(form);
      } catch (err) {
        setStatus(statusEl, 'error', err.message || String(err));
        if (btn) btn.disabled = false;
        return;
      }

      promise
        .then(function (tx) {
          setStatus(statusEl, 'success', 'Submitted.' + txLink(tx));
          form.reset();
        })
        .catch(function (err) {
          setStatus(statusEl, 'error', err.message || String(err));
        })
        .finally(function () {
          if (btn) btn.disabled = false;
        });
    });

    form.addEventListener('reset', function () {
      clearStatus(statusEl);
    });
  }

  // ── ProjectRegistry reads ─────────────────────────────────────────────────────

  function initPROwner() {
    bindRead('admin-pr-owner-form', function () {
      return readContract(PROJECT_REGISTRY_ABI, 'projectRegistry').owner();
    });
  }

  function initPRPaused() {
    bindRead('admin-pr-paused-form', function () {
      return readContract(PROJECT_REGISTRY_ABI, 'projectRegistry').paused()
        .then(function (v) { return String(v); });
    });
  }

  function initPRExists() {
    bindRead('admin-pr-exists-form', function (form) {
      var pid = val(form, 'pr-exists-id');
      if (!pid) throw new Error('Project ID is required.');
      return readContract(PROJECT_REGISTRY_ABI, 'projectRegistry').projectExists(toBytes32(pid))
        .then(function (v) { return String(v); });
    });
  }

  function initPRGetSteward() {
    bindRead('admin-pr-steward-form', function (form) {
      var pid = val(form, 'pr-steward-id');
      if (!pid) throw new Error('Project ID is required.');
      return readContract(PROJECT_REGISTRY_ABI, 'projectRegistry').getSteward(toBytes32(pid));
    });
  }

  function initPRGetStatus() {
    var STATUS_NAMES = ['Draft', 'Active', 'Paused', 'Completed'];
    bindRead('admin-pr-status-form', function (form) {
      var pid = val(form, 'pr-status-id');
      if (!pid) throw new Error('Project ID is required.');
      return readContract(PROJECT_REGISTRY_ABI, 'projectRegistry').getStatus(toBytes32(pid))
        .then(function (v) {
          var n = Number(v);
          return n + ' (' + (STATUS_NAMES[n] || 'Unknown') + ')';
        });
    });
  }

  function initPRGetProject() {
    bindRead('admin-pr-get-form', function (form) {
      var pid = val(form, 'pr-get-id');
      if (!pid) throw new Error('Project ID is required.');
      var STATUS_NAMES = ['Draft', 'Active', 'Paused', 'Completed'];
      return readContract(PROJECT_REGISTRY_ABI, 'projectRegistry').getProject(toBytes32(pid))
        .then(function (r) {
          var n = Number(r.status);
          return JSON.stringify({
            steward: r.steward,
            metadataURI: r.metadataURI,
            status: n + ' (' + (STATUS_NAMES[n] || 'Unknown') + ')'
          }, null, 2);
        });
    });
  }

  // ── ProjectRegistry writes ────────────────────────────────────────────────────

  function initPRRegister() {
    bindWrite('admin-pr-register-form', function (form) {
      var pid = val(form, 'pr-reg-id');
      var steward = val(form, 'pr-reg-steward');
      var uri = val(form, 'pr-reg-uri');
      if (!pid) throw new Error('Project ID is required.');
      if (!steward) throw new Error('Steward address is required.');
      if (!uri) throw new Error('Metadata URI is required.');
      return writeContract(PROJECT_REGISTRY_ABI, 'projectRegistry').then(function (c) {
        return c.registerProject(toBytes32(pid), steward, uri);
      });
    });
  }

  function initPRUpdateMetadata() {
    bindWrite('admin-pr-updatemeta-form', function (form) {
      var pid = val(form, 'pr-updatemeta-id');
      var uri = val(form, 'pr-updatemeta-uri');
      if (!pid) throw new Error('Project ID is required.');
      if (!uri) throw new Error('Metadata URI is required.');
      return writeContract(PROJECT_REGISTRY_ABI, 'projectRegistry').then(function (c) {
        return c.updateProjectMetadataURI(toBytes32(pid), uri);
      });
    });
  }

  function initPRUpdateStatus() {
    bindWrite('admin-pr-updatestatus-form', function (form) {
      var pid = val(form, 'pr-updatestatus-id');
      var next = val(form, 'pr-updatestatus-next');
      if (!pid) throw new Error('Project ID is required.');
      if (next === '') throw new Error('Next status is required.');
      return writeContract(PROJECT_REGISTRY_ABI, 'projectRegistry').then(function (c) {
        return c.updateProjectStatus(toBytes32(pid), Number(next));
      });
    });
  }

  function initPRTransferSteward() {
    bindWrite('admin-pr-xfersteward-form', function (form) {
      var pid = val(form, 'pr-xfersteward-id');
      var next = val(form, 'pr-xfersteward-next');
      if (!pid) throw new Error('Project ID is required.');
      if (!next) throw new Error('New steward address is required.');
      return writeContract(PROJECT_REGISTRY_ABI, 'projectRegistry').then(function (c) {
        return c.transferSteward(toBytes32(pid), next);
      });
    });
  }

  function initPRTransferOwnership() {
    bindWrite('admin-pr-xferowner-form', function (form) {
      var next = val(form, 'pr-xferowner-next');
      if (!next) throw new Error('New owner address is required.');
      return writeContract(PROJECT_REGISTRY_ABI, 'projectRegistry').then(function (c) {
        return c.transferOwnership(next);
      });
    });
  }

  function initPRPause() {
    bindWrite('admin-pr-pause-form', function () {
      return writeContract(PROJECT_REGISTRY_ABI, 'projectRegistry').then(function (c) {
        return c.pause();
      });
    });
  }

  function initPRUnpause() {
    bindWrite('admin-pr-unpause-form', function () {
      return writeContract(PROJECT_REGISTRY_ABI, 'projectRegistry').then(function (c) {
        return c.unpause();
      });
    });
  }

  // ── Treasury reads ────────────────────────────────────────────────────────────

  function initTROwner() {
    bindRead('admin-tr-owner-form', function () {
      return readContract(TREASURY_ABI, 'treasury').owner();
    });
  }

  function initTRPaused() {
    bindRead('admin-tr-paused-form', function () {
      return readContract(TREASURY_ABI, 'treasury').paused()
        .then(function (v) { return String(v); });
    });
  }

  function initTRBalance() {
    bindRead('admin-tr-balance-form', function (form) {
      var pid = val(form, 'tr-balance-id');
      if (!pid) throw new Error('Project ID is required.');
      return readContract(TREASURY_ABI, 'treasury').projectBalances(toBytes32(pid))
        .then(function (wei) {
          return window.ethers.formatEther(wei) + ' ETH (' + wei.toString() + ' wei)';
        });
    });
  }

  function initTRPayoutAddr() {
    bindRead('admin-tr-payout-form', function (form) {
      var pid = val(form, 'tr-payout-id');
      if (!pid) throw new Error('Project ID is required.');
      return readContract(TREASURY_ABI, 'treasury').payoutAddresses(toBytes32(pid));
    });
  }

  // ── Treasury writes ───────────────────────────────────────────────────────────

  function initTRContribute() {
    bindWrite('admin-tr-contribute-form', function (form) {
      var pid = val(form, 'tr-contribute-id');
      var amtEth = val(form, 'tr-contribute-amount');
      if (!pid) throw new Error('Project ID is required.');
      if (!amtEth || Number(amtEth) <= 0) throw new Error('Enter a positive ETH amount.');
      var valueWei = window.ethers.parseEther(amtEth);
      return writeContract(TREASURY_ABI, 'treasury').then(function (c) {
        return c.contribute(toBytes32(pid), { value: valueWei });
      });
    });
  }

  function initTRSetPayout() {
    bindWrite('admin-tr-setpayout-form', function (form) {
      var pid = val(form, 'tr-setpayout-id');
      var addr = val(form, 'tr-setpayout-addr');
      if (!pid) throw new Error('Project ID is required.');
      if (!addr) throw new Error('Payout address is required.');
      return writeContract(TREASURY_ABI, 'treasury').then(function (c) {
        return c.setPayoutAddress(toBytes32(pid), addr);
      });
    });
  }

  function initTRWithdraw() {
    bindWrite('admin-tr-withdraw-form', function (form) {
      var pid = val(form, 'tr-withdraw-id');
      var amtEth = val(form, 'tr-withdraw-amount');
      if (!pid) throw new Error('Project ID is required.');
      if (!amtEth || Number(amtEth) <= 0) throw new Error('Enter a positive ETH amount.');
      var amtWei = window.ethers.parseEther(amtEth);
      return writeContract(TREASURY_ABI, 'treasury').then(function (c) {
        return c.withdraw(toBytes32(pid), amtWei);
      });
    });
  }

  function initTRTransferOwnership() {
    bindWrite('admin-tr-xferowner-form', function (form) {
      var next = val(form, 'tr-xferowner-next');
      if (!next) throw new Error('New owner address is required.');
      return writeContract(TREASURY_ABI, 'treasury').then(function (c) {
        return c.transferOwnership(next);
      });
    });
  }

  function initTRPause() {
    bindWrite('admin-tr-pause-form', function () {
      return writeContract(TREASURY_ABI, 'treasury').then(function (c) { return c.pause(); });
    });
  }

  function initTRUnpause() {
    bindWrite('admin-tr-unpause-form', function () {
      return writeContract(TREASURY_ABI, 'treasury').then(function (c) { return c.unpause(); });
    });
  }

  // ── ProfileRegistry reads / writes ────────────────────────────────────────────

  function initPFGetURI() {
    bindRead('admin-pf-geturi-form', function (form) {
      var addr = val(form, 'pf-geturi-addr');
      if (!addr) throw new Error('Address is required.');
      return readContract(PROFILE_REGISTRY_ABI, 'profileRegistry').getProfileURI(addr);
    });
  }

  function initPFSetURI() {
    bindWrite('admin-pf-seturi-form', function (form) {
      var uri = val(form, 'pf-seturi-uri');
      if (!uri) throw new Error('Profile URI is required.');
      return writeContract(PROFILE_REGISTRY_ABI, 'profileRegistry').then(function (c) {
        return c.setProfileURI(uri);
      });
    });
  }

  // ── Wallet notice ─────────────────────────────────────────────────────────────

  function updateWalletNotice() {
    var el = document.getElementById('admin-wallet-notice');
    if (!el) return;
    if (!GTPAppState || typeof GTPAppState.getSessionIdentity !== 'function') {
      el.textContent = 'Wallet state unavailable.';
      return;
    }
    var id = GTPAppState.getSessionIdentity();
    if (id.connectionStatus !== 'connected') {
      el.textContent = 'Connect wallet to ' + networkName() + ' to enable write functions.';
      return;
    }
    if (!id.isSupportedNetwork) {
      el.textContent = 'Switch to Optimism Mainnet to enable write functions.';
      return;
    }
    if (typeof id.chainId !== 'number') {
      el.textContent = 'Wallet chain is unavailable. Reconnect and try again.';
      return;
    }
    el.textContent = '';
  }

  // ── Access guard ──────────────────────────────────────────────────────────────

  /**
   * Checks whether the currently connected wallet is the owner of the
   * ProjectRegistry. Returns a promise resolving to true/false.
   */
  function isOwner() {
    if (!walletReady()) return Promise.resolve(false);
    var id = GTPAppState.getSessionIdentity();
    var connectedAddress = id && id.address ? id.address.toLowerCase() : null;
    if (!connectedAddress) return Promise.resolve(false);
    try {
      return readContract(OWNABLE_READ_ABI, 'projectRegistry').owner()
        .then(function (ownerAddr) {
          return ownerAddr.toLowerCase() === connectedAddress;
        })
        .catch(function () { return false; });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  /**
   * Shows or hides the panel body based on owner check.
   * Renders a notice inside the summary when access is denied.
   */
  function updateAccessGate(details, accessNotice, gateNotice) {
    var body = details.querySelector('.admin-panel-body');
    var content = body ? body.querySelector('.container') : null;
    if (body) body.removeAttribute('hidden');
    if (content) content.removeAttribute('hidden');
    if (!walletReady()) {
      if (accessNotice) accessNotice.textContent = '';
      if (body) body.hidden = false;
      if (content) content.hidden = false;
      if (gateNotice) gateNotice.textContent = 'Connect wallet on Optimism Mainnet for write access.';
      return;
    }
    isOwner().then(function (owner) {
      if (owner) {
        if (accessNotice) accessNotice.textContent = '';
        if (body) body.hidden = false;
        if (content) content.hidden = false;
        if (gateNotice) gateNotice.textContent = '';
      } else {
        if (accessNotice) accessNotice.textContent = '';
        if (body) body.hidden = false;
        if (content) content.hidden = false;
        if (gateNotice) gateNotice.textContent = 'Connected wallet is not the ProjectRegistry owner. Writes may fail onchain.';
      }
    });
  }


  function init() {
    // Only wire up when the panel is actually opened (lazy)
    var details = document.getElementById('admin-panel');
    if (!details) return;

    // Small notice injected into the summary for access feedback
    var accessNotice = document.createElement('span');
    accessNotice.className = 'admin-access-notice';
    var summary = details.querySelector('summary');
    if (summary) summary.appendChild(accessNotice);

    // Hide the contract content until owner is verified on first open
    var body = details.querySelector('.admin-panel-body');
    var content = body ? body.querySelector('.container') : null;
    if (body) body.removeAttribute('hidden');
    if (content) content.removeAttribute('hidden');
    if (content) content.hidden = false;
    var gateNotice = body ? body.querySelector('#admin-access-gate-notice') : null;
    if (gateNotice) gateNotice.textContent = 'Connect your wallet to verify owner access.';
    var introspectionMount = document.createElement('div');
    introspectionMount.className = 'admin-introspection-root';
    introspectionMount.id = 'admin-introspection-root';
    if (content) {
      content.insertBefore(introspectionMount, content.firstChild);
    }

    var wired = false;
    function wireAll() {
      if (wired) return;
      wired = true;

      // ProjectRegistry
      initPROwner();
      initPRPaused();
      initPRExists();
      initPRGetSteward();
      initPRGetStatus();
      initPRGetProject();
      initPRRegister();
      initPRUpdateMetadata();
      initPRUpdateStatus();
      initPRTransferSteward();
      initPRTransferOwnership();
      initPRPause();
      initPRUnpause();

      // Treasury
      initTROwner();
      initTRPaused();
      initTRBalance();
      initTRPayoutAddr();
      initTRContribute();
      initTRSetPayout();
      initTRWithdraw();
      initTRTransferOwnership();
      initTRPause();
      initTRUnpause();

      // ProfileRegistry
      initPFGetURI();
      initPFSetURI();
    }

    details.addEventListener('toggle', function () {
      if (details.open) {
        updateAccessGate(details, accessNotice, gateNotice);
        wireAll();
        refreshContractIntrospection(introspectionMount);
        updateWriteButtonsEnabled();
      }
    });

    updateWalletNotice();
    updateWriteButtonsEnabled();
    refreshContractIntrospection(introspectionMount);

    if (GTPAppState && typeof GTPAppState.subscribe === 'function') {
      GTPAppState.subscribe(function () {
        updateWalletNotice();
        updateWriteButtonsEnabled();
        if (details.open) refreshContractIntrospection(introspectionMount);
        // Re-evaluate access whenever wallet state changes while panel is open
        if (details.open) updateAccessGate(details, accessNotice, gateNotice);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
