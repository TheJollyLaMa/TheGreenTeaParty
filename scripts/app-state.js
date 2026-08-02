/* global window, GTPModeRouter, GTPConfig */

var GTPAppState = (function () {
  'use strict';

  var state = {
    walletStatus: 'disconnected',
    connectionStatus: 'disconnected',
    address: null,
    chainId: null,
    isSupportedNetwork: false,
    profilePresent: false,
    lastError: null
  };
  var listeners = [];

  function cloneState() {
    return {
      walletStatus: state.connectionStatus,
      connectionStatus: state.connectionStatus,
      address: state.address,
      chainId: state.chainId,
      isSupportedNetwork: state.isSupportedNetwork,
      profilePresent: state.profilePresent,
      lastError: state.lastError
    };
  }

  function getState() {
    return cloneState();
  }

  function getSessionIdentity() {
    return {
      address: state.address,
      chainId: state.chainId,
      connectionStatus: state.connectionStatus,
      isSupportedNetwork: state.isSupportedNetwork
    };
  }

  function notifyListeners() {
    var snapshot = cloneState();
    listeners.forEach(function (listener) {
      listener(snapshot);
    });
  }

  function setState(patch) {
    if (!patch) return;
    if (Object.prototype.hasOwnProperty.call(patch, 'connectionStatus')) {
      state.connectionStatus = patch.connectionStatus;
    } else if (Object.prototype.hasOwnProperty.call(patch, 'walletStatus')) {
      state.connectionStatus = patch.walletStatus;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'address')) {
      state.address = patch.address;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'chainId')) {
      state.chainId = patch.chainId;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'isSupportedNetwork')) {
      state.isSupportedNetwork = !!patch.isSupportedNetwork;
    } else if (Object.prototype.hasOwnProperty.call(patch, 'chainId')) {
      state.isSupportedNetwork = typeof patch.chainId === 'number' && GTPConfig.app.supportedChainIds.indexOf(patch.chainId) !== -1;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'profilePresent')) {
      state.profilePresent = patch.profilePresent;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'lastError')) {
      state.lastError = patch.lastError;
    }

    state.walletStatus = state.connectionStatus;
    notifyListeners();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {};
    listeners.push(listener);
    return function () {
      listeners = listeners.filter(function (fn) { return fn !== listener; });
    };
  }

  function getReadiness() {
    if (state.connectionStatus !== 'connected') {
      return { ready: false, reason: 'Connect wallet to load app data.' };
    }
    if (typeof state.chainId !== 'number') {
      return { ready: false, reason: 'Select a supported network to continue.' };
    }
    if (!state.isSupportedNetwork) {
      return { ready: false, reason: 'Connected network is unsupported. Switch to a supported network to continue.' };
    }
    if (!state.profilePresent) {
      return { ready: false, reason: 'Create or load your profile to continue.' };
    }
    return { ready: true, reason: '' };
  }

  function assertCanWrite() {
    var modeInfo = GTPModeRouter.getModeInfo(window.location);
    if (modeInfo.mode !== 'app') {
      throw new Error('Writes are disabled in prototype mode. Switch to app mode to continue.');
    }

    var readiness = getReadiness();
    if (!readiness.ready) {
      throw new Error(readiness.reason);
    }
  }

  return {
    getState: getState,
    getSessionIdentity: getSessionIdentity,
    setState: setState,
    subscribe: subscribe,
    getReadiness: getReadiness,
    assertCanWrite: assertCanWrite
  };
}());

window.GTPAppState = GTPAppState;
