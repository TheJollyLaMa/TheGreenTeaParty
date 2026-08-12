/* global window, ethers, GTPAppState, GTPContractAdapter, GTPConfig */

(function () {
  'use strict';

  // ── helpers ───────────────────────────────────────────────────────────────────

  function toBytes32(value) {
    var canonicalValue = canonicalProjectId(value);
    if (typeof canonicalValue === 'string' && /^0x[0-9a-fA-F]{64}$/.test(canonicalValue)) return canonicalValue;
    return window.ethers.keccak256(window.ethers.toUtf8Bytes(String(canonicalValue)));
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
    var contracts = GTPConfig && GTPConfig.contracts ? GTPConfig.contracts : {};
    return contracts[chainId] || {};
  }

  function networkName() {
    var chainId = currentChainId();
    var networks = GTPConfig && GTPConfig.networks ? GTPConfig.networks : {};
    return (networks[chainId] && networks[chainId].label) ? networks[chainId].label : 'Optimism Mainnet';
  }

  function getContractDefinition(contractKey) {
    return GTPContractAdapter.getContractDefinition(contractKey, currentChainId());
  }

  function getContractAbi(contractKey) {
    var definition = getContractDefinition(contractKey);
    return definition ? definition.abi : [];
  }

  function readContract(abi, addrKey) {
    var definition = getContractDefinition(addrKey);
    var addr = definition && definition.address ? definition.address : contractAddresses()[addrKey];
    if (!addr) throw new Error('Contract address not configured for this network.');
    var provider = getReadProvider();
    if (!provider) throw new Error('Read provider unavailable.');
    return new window.ethers.Contract(addr, abi, provider);
  }

  function writeContract(abi, addrKey) {
    return getSignerProvider().getSigner().then(function (signer) {
      var definition = getContractDefinition(addrKey);
      var addr = definition && definition.address ? definition.address : contractAddresses()[addrKey];
      if (!addr) throw new Error('Contract address not configured for this network.');
      return new window.ethers.Contract(addr, abi, signer);
    });
  }

  function canonicalProjectId(value) {
    return GTPContractAdapter.getCanonicalProjectId(value);
  }

  function getAdminContractDiagnostics(contractKey, abi) {
    var chainId = currentChainId();
    var definition = getContractDefinition(contractKey);
    var identity = GTPAppState && typeof GTPAppState.getSessionIdentity === 'function'
      ? GTPAppState.getSessionIdentity()
      : {};
    var diagnostics = {
      contractKey: contractKey,
      chainId: chainId,
      contractAddress: definition && definition.address ? definition.address : null,
      contractInitialized: false,
      functionsParsedCount: 0,
      parseError: '',
      readMethods: [],
      writeMethods: []
    };

    if (!Array.isArray(abi)) {
      diagnostics.parseError = 'ABI is not an array.';
      return diagnostics;
    }

    try {
      var fragments = new window.ethers.Interface(abi).fragments.filter(function (fragment) {
        return fragment && fragment.type === 'function';
      });
      diagnostics.contractInitialized = !!diagnostics.contractAddress;
      diagnostics.functionsParsedCount = fragments.length;
      diagnostics.readMethods = fragments.filter(function (fragment) {
        return fragment.constant || fragment.stateMutability === 'view' || fragment.stateMutability === 'pure';
      });
      diagnostics.writeMethods = fragments.filter(function (fragment) {
        return fragment.stateMutability === 'nonpayable' || fragment.stateMutability === 'payable';
      });
      diagnostics.walletConnected = identity.connectionStatus === 'connected';
      diagnostics.walletSupported = !!identity.isSupportedNetwork;
      return diagnostics;
    } catch (error) {
      diagnostics.parseError = error.message || String(error);
      return diagnostics;
    }
  }

  var PROJECT_REGISTRY_ABI = GTPContractAdapter.PROJECT_REGISTRY_ABI.slice();
  var TREASURY_ABI = GTPContractAdapter.TREASURY_ABI.slice();
  var PROFILE_REGISTRY_ABI = GTPContractAdapter.PROFILE_REGISTRY_ABI.slice();

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
        setStatus(statusEl, 'error', 'Connect wallet and switch to ' + networkName() + ' first.');
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
          var diagnostics = tx && tx.diagnostics
            ? ' [' + [
              tx.diagnostics.chainId !== undefined && tx.diagnostics.chainId !== null ? 'chainId ' + tx.diagnostics.chainId : '',
              tx.diagnostics.contractAddress ? 'contract ' + tx.diagnostics.contractAddress : '',
              tx.diagnostics.signerAddress ? 'signer ' + tx.diagnostics.signerAddress : '',
              tx.diagnostics.txHash ? 'tx ' + tx.diagnostics.txHash : ''
            ].filter(Boolean).join(' · ') + ']'
            : '';
          setStatus(statusEl, 'success', 'Submitted.' + txLink(tx.tx || tx) + diagnostics);
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
      return GTPContractAdapter.create({ chainId: currentChainId() }).registerProject(pid, steward, uri);
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
    var identity = GTPAppState && typeof GTPAppState.getSessionIdentity === 'function'
      ? GTPAppState.getSessionIdentity()
      : {};
    if (!identity.connectionStatus || identity.connectionStatus === 'disconnected') {
      el.textContent = 'Connect wallet to enable write functions.';
      return;
    }
    el.textContent = walletReady()
      ? ''
      : 'Switch to Optimism Mainnet to enable write functions.';
  }

  function ensureDiagnosticsEl(group) {
    if (!group) return null;
    var diagnosticsEl = group.querySelector('.admin-contract-diagnostics');
    if (!diagnosticsEl) {
      diagnosticsEl = document.createElement('p');
      diagnosticsEl.className = 'admin-contract-diagnostics';
      var header = group.querySelector('.admin-contract-header');
      if (header && header.parentNode) {
        header.parentNode.insertBefore(diagnosticsEl, header.nextSibling);
      }
    }
    return diagnosticsEl;
  }

  function updateContractHeader(group, contractKey, diagnostics) {
    var addressLink = group ? group.querySelector('.admin-contract-address') : null;
    if (!addressLink || !diagnostics) return;
    var address = diagnostics.contractAddress || 'Not configured';
    addressLink.textContent = address === 'Not configured'
      ? address
      : address.slice(0, 10) + '…' + address.slice(-4);
    var networks = GTPConfig && GTPConfig.networks ? GTPConfig.networks : {};
    var chainId = diagnostics.chainId;
    var explorer = networks[chainId] && networks[chainId].blockExplorer
      ? networks[chainId].blockExplorer
      : 'https://optimistic.etherscan.io';
    if (diagnostics.contractAddress) {
      addressLink.href = explorer + '/address/' + diagnostics.contractAddress;
    } else {
      addressLink.removeAttribute('href');
    }
  }

  function renderContractDiagnostics(group, contractKey) {
    var abi = getContractAbi(contractKey);
    var diagnostics = getAdminContractDiagnostics(contractKey, abi);
    var diagnosticsEl = ensureDiagnosticsEl(group);
    updateContractHeader(group, contractKey, diagnostics);
    if (!diagnosticsEl) return diagnostics;

    if (!Array.isArray(abi)) {
      diagnosticsEl.textContent = 'No functions parsed · reason: ABI is not an array.';
      diagnosticsEl.className = 'admin-contract-diagnostics admin-contract-diagnostics--error';
      return diagnostics;
    }

    if (diagnostics.parseError) {
      diagnosticsEl.textContent = 'No functions parsed · reason: ' + diagnostics.parseError;
      diagnosticsEl.className = 'admin-contract-diagnostics admin-contract-diagnostics--error';
      return diagnostics;
    }

    if (!diagnostics.functionsParsedCount) {
      diagnosticsEl.textContent = 'No functions parsed · reason: ABI has zero function entries.';
      diagnosticsEl.className = 'admin-contract-diagnostics admin-contract-diagnostics--warning';
      return diagnostics;
    }

    diagnosticsEl.textContent = [
      'functions parsed ' + diagnostics.functionsParsedCount,
      'contract initialized ' + String(diagnostics.contractInitialized),
      'active chainId ' + (diagnostics.chainId !== null && diagnostics.chainId !== undefined ? diagnostics.chainId : '—'),
      'active contract address ' + (diagnostics.contractAddress || '—')
    ].join(' · ');
    diagnosticsEl.className = 'admin-contract-diagnostics';
    return diagnostics;
  }

  function updateAllContractDiagnostics() {
    var groups = document.querySelectorAll('.admin-contract-group[data-contract-key]');
    groups.forEach(function (group) {
      renderContractDiagnostics(group, group.getAttribute('data-contract-key'));
    });
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
      return readContract(PROJECT_REGISTRY_ABI, 'projectRegistry').owner()
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
    if (!walletReady()) {
      if (accessNotice) accessNotice.textContent = '';
      if (body) body.hidden = false;
      if (content) content.hidden = true;
      if (gateNotice) gateNotice.textContent = 'Connect your wallet to verify owner access.';
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
        if (content) content.hidden = true;
        if (gateNotice) gateNotice.textContent = 'Access restricted — connected wallet is not the contract owner.';
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
    if (content) content.hidden = true;
    var gateNotice = body ? body.querySelector('#admin-access-gate-notice') : null;
    if (gateNotice) gateNotice.textContent = 'Connect your wallet to verify owner access.';

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
        updateAllContractDiagnostics();
        wireAll();
      }
    });

    updateWalletNotice();
    updateAllContractDiagnostics();

    if (GTPAppState && typeof GTPAppState.subscribe === 'function') {
      GTPAppState.subscribe(function () {
        updateWalletNotice();
        updateAllContractDiagnostics();
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

  window.GTPAdminPanel = {
    getAdminContractDiagnostics: getAdminContractDiagnostics,
    renderContractDiagnostics: renderContractDiagnostics
  };

}());
