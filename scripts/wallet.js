/* global window, GTPAppState, GTPNetwork */

var GTPWallet = (function () {
  'use strict';

  var provider = null;
  var initialized = false;

  function getProvider() {
    var injected = window.ethereum;
    if (!injected) return null;
    if (Array.isArray(injected.providers) && injected.providers.length) {
      var metamask = injected.providers.find(function (item) { return item && item.isMetaMask; });
      return metamask || injected.providers[0];
    }
    return injected;
  }

  function updateIdentity(address, chainId) {
    GTPAppState.setState({
      address: address || null,
      chainId: chainId,
      isSupportedNetwork: GTPNetwork.isSupportedChain(chainId),
      connectionStatus: address ? 'connected' : 'disconnected'
    });
  }

  function readSession() {
    if (!provider) {
      GTPAppState.setState({ connectionStatus: 'disconnected', lastError: 'Wallet provider unavailable. Install MetaMask to continue.' });
      return Promise.resolve();
    }

    return Promise.all([
      provider.request({ method: 'eth_accounts' }),
      provider.request({ method: 'eth_chainId' })
    ]).then(function (results) {
      var accounts = results[0];
      var chainId = GTPNetwork.parseChainId(results[1]);
      var address = Array.isArray(accounts) && accounts.length ? accounts[0] : null;
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
  }

  function onChainChanged(nextChainId) {
    var parsedChainId = GTPNetwork.parseChainId(nextChainId);
    var identity = GTPAppState.getSessionIdentity();
    updateIdentity(identity.address, parsedChainId);
    console.info('[wallet] chain changed', { chainId: parsedChainId });
  }

  function init() {
    if (initialized) return Promise.resolve();
    initialized = true;
    provider = getProvider();
    if (provider && typeof provider.on === 'function') {
      provider.on('accountsChanged', onAccountsChanged);
      provider.on('chainChanged', onChainChanged);
      provider.on('disconnect', function () {
        disconnect();
      });
    }
    return readSession();
  }

  function connect() {
    if (!provider) {
      GTPAppState.setState({ connectionStatus: 'error', lastError: 'Wallet provider unavailable. Install MetaMask to continue.' });
      return Promise.resolve(false);
    }

    GTPAppState.setState({ connectionStatus: 'connecting', lastError: null });

    return provider.request({ method: 'eth_requestAccounts' })
      .then(function (accounts) {
        var address = Array.isArray(accounts) && accounts.length ? accounts[0] : null;
        if (!address) {
          GTPAppState.setState({ connectionStatus: 'error', lastError: 'No wallet account was returned.' });
          return false;
        }
        return provider.request({ method: 'eth_chainId' }).then(function (rawChainId) {
          var chainId = GTPNetwork.parseChainId(rawChainId);
          updateIdentity(address, chainId);
          GTPAppState.setState({ lastError: null });
          console.info('[wallet] connected', { address: address, chainId: chainId });
          return true;
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
