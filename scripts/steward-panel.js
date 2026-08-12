/* global window, GTPAppState, GTPContractAdapter */

(function () {
  'use strict';

  // ── helpers ──────────────────────────────────────────────────────────────────

  function setStatus(el, kind, text) {
    if (!el) return;
    el.textContent = text;
    el.className = 'steward-form-status steward-form-status--' + kind;
  }

  function clearStatus(el) {
    if (!el) return;
    el.textContent = '';
    el.className = 'steward-form-status';
  }

  function txLink(tx) {
    var hash = tx && tx.hash ? tx.hash : null;
    if (!hash) return '';
    var explorer = 'https://optimistic.etherscan.io/tx/';
    return ' View: ' + explorer + hash;
  }

  function adapter() {
    var identity = GTPAppState.getSessionIdentity();
    return GTPContractAdapter.create({ chainId: identity.chainId });
  }

  function walletReady() {
    var identity = GTPAppState.getSessionIdentity();
    return identity.connectionStatus === 'connected'
      && identity.isSupportedNetwork
      && typeof identity.chainId === 'number';
  }

  // ── Register Project ──────────────────────────────────────────────────────────

  function initRegisterForm() {
    var form = document.getElementById('steward-register-form');
    var statusEl = document.getElementById('steward-register-status');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      if (!walletReady()) {
        setStatus(statusEl, 'error', 'Connect your wallet to Optimism first.');
        return;
      }

      var projectId = (form.elements['project-id'].value || '').trim();
      var steward = (form.elements['steward-address'].value || '').trim();
      var metadataInput = (form.elements['metadata-uri'].value || '').trim();

      if (!projectId) {
        setStatus(statusEl, 'error', 'Project ID is required.');
        return;
      }
      if (!steward) {
        setStatus(statusEl, 'error', 'Steward address is required.');
        return;
      }

      // Build metadataURI: if user left blank, build inline JSON from the helper fields
      var metadataURI = metadataInput;
      if (!metadataURI) {
        var name = (form.elements['meta-name'] ? form.elements['meta-name'].value : '').trim();
        var track = (form.elements['meta-track'] ? form.elements['meta-track'].value : '').trim();
        var goal = (form.elements['meta-goal'] ? form.elements['meta-goal'].value : '').trim();
        var desc = (form.elements['meta-desc'] ? form.elements['meta-desc'].value : '').trim();
        var obj = { id: projectId };
        if (name) obj.name = name;
        if (track) obj.track = track;
        if (goal) obj.goal = Number(goal) || 0;
        if (desc) obj.description = desc;
        metadataURI = JSON.stringify(obj);
      }

      var btn = form.querySelector('.steward-submit-btn');
      if (btn) btn.disabled = true;
      setStatus(statusEl, 'pending', 'Sending transaction…');

      adapter().registerProject(projectId, steward, metadataURI)
        .then(function (result) {
          if (result.ok) {
            setStatus(statusEl, 'success', 'Transaction submitted.' + txLink(result.tx));
            form.reset();
          } else {
            setStatus(statusEl, 'error', result.error || 'Transaction failed.');
          }
        })
        .catch(function (err) {
          setStatus(statusEl, 'error', err.message || 'Unexpected error.');
        })
        .finally(function () {
          if (btn) btn.disabled = false;
        });
    });

    form.addEventListener('reset', function () {
      clearStatus(statusEl);
    });
  }

  // ── Contribute ────────────────────────────────────────────────────────────────

  function initContributeForm() {
    var form = document.getElementById('steward-contribute-form');
    var statusEl = document.getElementById('steward-contribute-status');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      if (!walletReady()) {
        setStatus(statusEl, 'error', 'Connect your wallet to Optimism first.');
        return;
      }

      var projectId = (form.elements['contrib-project-id'].value || '').trim();
      var amount = (form.elements['contrib-amount'].value || '').trim();

      if (!projectId) {
        setStatus(statusEl, 'error', 'Project ID is required.');
        return;
      }
      if (!amount || Number(amount) <= 0) {
        setStatus(statusEl, 'error', 'Enter a positive ETH amount.');
        return;
      }

      var btn = form.querySelector('.steward-submit-btn');
      if (btn) btn.disabled = true;
      setStatus(statusEl, 'pending', 'Sending transaction…');

      adapter().contribute(projectId, { value: amount })
        .then(function (result) {
          if (result.ok) {
            setStatus(statusEl, 'success', 'Contribution submitted.' + txLink(result.tx));
            form.reset();
          } else {
            setStatus(statusEl, 'error', result.error || 'Transaction failed.');
          }
        })
        .catch(function (err) {
          setStatus(statusEl, 'error', err.message || 'Unexpected error.');
        })
        .finally(function () {
          if (btn) btn.disabled = false;
        });
    });

    form.addEventListener('reset', function () {
      clearStatus(statusEl);
    });
  }

  // ── Withdraw ──────────────────────────────────────────────────────────────────

  function initWithdrawForm() {
    var form = document.getElementById('steward-withdraw-form');
    var statusEl = document.getElementById('steward-withdraw-status');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      if (!walletReady()) {
        setStatus(statusEl, 'error', 'Connect your wallet to Optimism first.');
        return;
      }

      var projectId = (form.elements['withdraw-project-id'].value || '').trim();
      var amountEth = (form.elements['withdraw-amount'].value || '').trim();

      if (!projectId) {
        setStatus(statusEl, 'error', 'Project ID is required.');
        return;
      }
      if (!amountEth || Number(amountEth) <= 0) {
        setStatus(statusEl, 'error', 'Enter a positive ETH amount to withdraw.');
        return;
      }

      var amountWei;
      try {
        amountWei = window.ethers.parseEther(amountEth);
      } catch (err) {
        setStatus(statusEl, 'error', 'Invalid ETH amount: ' + (err.message || err));
        return;
      }

      var btn = form.querySelector('.steward-submit-btn');
      if (btn) btn.disabled = true;
      setStatus(statusEl, 'pending', 'Sending transaction…');

      adapter().withdraw(projectId, amountWei)
        .then(function (result) {
          if (result.ok) {
            setStatus(statusEl, 'success', 'Withdrawal submitted.' + txLink(result.tx));
            form.reset();
          } else {
            setStatus(statusEl, 'error', result.error || 'Transaction failed.');
          }
        })
        .catch(function (err) {
          setStatus(statusEl, 'error', err.message || 'Unexpected error.');
        })
        .finally(function () {
          if (btn) btn.disabled = false;
        });
    });

    form.addEventListener('reset', function () {
      clearStatus(statusEl);
    });
  }

  // ── Wallet-state badge ────────────────────────────────────────────────────────

  function updateWalletNotices() {
    var ready = walletReady();
    var notices = document.querySelectorAll('.steward-wallet-notice');
    notices.forEach(function (el) {
      el.textContent = ready
        ? ''
        : 'Connect wallet to Optimism to enable form submission.';
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  function init() {
    initRegisterForm();
    initContributeForm();
    initWithdrawForm();
    updateWalletNotices();

    GTPAppState.subscribe(function () {
      updateWalletNotices();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
