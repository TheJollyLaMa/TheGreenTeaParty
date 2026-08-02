/* global window, GTPModeRouter */

var GTPAppState = (function () {
  'use strict';

  var state = {
    walletStatus: 'disconnected',
    chainId: null,
    profilePresent: false,
    lastError: null
  };

  function getState() {
    return {
      walletStatus: state.walletStatus,
      chainId: state.chainId,
      profilePresent: state.profilePresent,
      lastError: state.lastError
    };
  }

  function setState(patch) {
    state.walletStatus = patch.walletStatus || state.walletStatus;
    state.chainId = patch.chainId === undefined ? state.chainId : patch.chainId;
    state.profilePresent = patch.profilePresent === undefined ? state.profilePresent : patch.profilePresent;
    state.lastError = patch.lastError === undefined ? state.lastError : patch.lastError;
  }

  function getReadiness() {
    if (state.walletStatus !== 'connected') {
      return { ready: false, reason: 'Connect wallet to load app data.' };
    }
    if (typeof state.chainId !== 'number') {
      return { ready: false, reason: 'Select a supported network to continue.' };
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
    setState: setState,
    getReadiness: getReadiness,
    assertCanWrite: assertCanWrite
  };
}());

window.GTPAppState = GTPAppState;
