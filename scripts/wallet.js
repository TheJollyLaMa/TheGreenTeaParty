/* global window, GTPAppState, GTPNetwork */

var GTPWallet = (function () {
  'use strict';

  var provider = null;
  var initialized = false;
  var boundProviders = [];
  var sessionWatchInterval = null;
  var sessionRefreshBound = false;

  function getProvider() {
    var injected = window.ethereum;
    if (!injected) return null;
    if (Array.isArray(injected.providers) && injected.providers.length) {
      var metamask = injected.providers.find(function (item) { return item && item.isMetaMask; });
      return metamask || injected.providers[0];
    }
    return injected;
  }

  function isValidAddress(address) {
    return typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  function resolveActiveAddress(target, accounts) {
    if (target) {
      if (isValidAddress(target.selectedAddress)) {
        return target.selectedAddress;
      }
      if (isValidAddress(target._selectedAddress)) {
        return target._selectedAddress;
      }
    }

    if (Array.isArray(accounts) && accounts.length && isValidAddress(accounts[0])) {
      return accounts[0];
    }

    return null;
  }

  function refreshProvider() {
    var nextProvider = getProvider();
    if (nextProvider) {
      provider = nextProvider;
      bindProviderEvents(nextProvider);
    }
    return provider;
  }

  function updateIdentity(address, chainId) {
    GTPAppState.setState({
      address: address || null,
      chainId: chainId,
      isSupportedNetwork: GTPNetwork.isSupportedChain(chainId),
      connectionStatus: address ? 'connected' : 'disconnected'
    });
  }

  function bindProviderEvents(target) {
    if (!target || typeof target.on !== 'function' || boundProviders.indexOf(target) !== -1) {
      return;
    }

    target.on('accountsChanged', onAccountsChanged);
    target.on('chainChanged', onChainChanged);
    target.on('disconnect', function () {
      disconnect();
    });
    boundProviders.push(target);
  }

  function bindSessionRefreshEvents() {
    if (sessionRefreshBound) {
      return;
    }

    sessionRefreshBound = true;

    if (typeof window.addEventListener === 'function') {
      window.addEventListener('focus', readSession);
    }

    if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) {
          readSession();
        }
      });
    }

    if (typeof window.setInterval === 'function') {
      sessionWatchInterval = window.setInterval(function () {
        if (typeof document !== 'undefined' && document && document.hidden) {
          return Promise.resolve();
        }
        return readSession();
      }, 4000);
    }
  }

  function getRequestProvider() {
    return refreshProvider() || window.ethereum || provider;
  }

  function readSession() {
    var requestProvider = getRequestProvider();
    if (!requestProvider) {
      GTPAppState.setState({ connectionStatus: 'disconnected', lastError: 'Wallet provider unavailable. Install MetaMask to continue.' });
      return Promise.resolve();
    }

    return Promise.all([
      requestProvider.request({ method: 'eth_accounts' }),
      requestProvider.request({ method: 'eth_chainId' })
    ]).then(function (results) {
      var accounts = results[0];
      var chainId = GTPNetwork.parseChainId(results[1]);
      var address = resolveActiveAddress(requestProvider, accounts);
      updateIdentity(address, chainId);
      GTPAppState.setState({ lastError: null });
      console.info('[wallet] session sync', { address: address, chainId: chainId });
    }).catch(function (error) {
      GTPAppState.setState({ connectionStatus: 'error', lastError: 'Could not read wallet session.' });
      console.warn('[wallet] session sync error', error);
    });
  }

  function onAccountsChanged(accounts) {
    var address = Array.isArray(accounts) && accounts.length ? accounts[0] : null;
    var chainId = GTPAppState.getSessionIdentity().chainId;
    updateIdentity(address, chainId);
    if (!address) {
      GTPAppState.setState({ lastError: null });
    }
    console.info('[wallet] accounts changed', accounts);
    readSession();
  }

  function onChainChanged(nextChainId) {
    var parsedChainId = GTPNetwork.parseChainId(nextChainId);
    var identity = GTPAppState.getSessionIdentity();
    updateIdentity(identity.address, parsedChainId);
    console.info('[wallet] chain changed', { chainId: parsedChainId });
    readSession();
  }

  function init() {
    if (initialized) return Promise.resolve();
    initialized = true;
    provider = getProvider();
    bindProviderEvents(provider);
    if (window.ethereum && window.ethereum !== provider) {
      bindProviderEvents(window.ethereum);
    }
    bindSessionRefreshEvents();
    return readSession();
  }

  function connect() {
    var requestProvider = getRequestProvider();
    if (!requestProvider) {
      GTPAppState.setState({ connectionStatus: 'error', lastError: 'Wallet provider unavailable. Install MetaMask to continue.' });
      return Promise.resolve(false);
    }

    GTPAppState.setState({ connectionStatus: 'connecting', lastError: null });

    return requestProvider.request({ method: 'eth_requestAccounts' })
      .then(function (accounts) {
        var address = resolveActiveAddress(requestProvider, accounts);
        if (!address) {
          GTPAppState.setState({ connectionStatus: 'error', lastError: 'No wallet account was returned.' });
          return false;
        }
        return requestProvider.request({ method: 'eth_chainId' }).then(function (rawChainId) {
          var chainId = GTPNetwork.parseChainId(rawChainId);
          updateIdentity(address, chainId);
          GTPAppState.setState({ lastError: null });
          console.info('[wallet] connected', { address: address, chainId: chainId });
          return readSession().then(function () {
            return true;
          });
        });
      })
      .catch(function (error) {
        if (error && error.code === 4001) {
          GTPAppState.setState({ connectionStatus: 'rejected', lastError: 'Wallet connection request was rejected.' });
        } else {
          GTPAppState.setState({ connectionStatus: 'error', lastError: 'Failed to connect wallet.' });
        }
        console.warn('[wallet] connect error', error);
        return false;
      });
  }

  function disconnect() {
    GTPAppState.setState({
      address: null,
      chainId: null,
      isSupportedNetwork: false,
      connectionStatus: 'disconnected',
      profilePresent: false,
      lastError: null
    });
    console.info('[wallet] disconnected');
  }

  return {
    init: init,
    connect: connect,
    disconnect: disconnect
  };
}());

window.GTPWallet = GTPWallet;
