/* global window */

var GTPConfig = (function () {
  'use strict';

  var DEFAULT_MODE = 'prototype';
  var MODES = {
    prototype: {
      label: 'Prototype mode'
    },
    app: {
      label: 'App mode'
    }
  };

  var APP = {
    defaultChainId: 1,
    supportedChainIds: [1, 10, 8453]
  };

  var CONTRACTS = {
    1: {
      projectRegistry: null,
      treasury: null,
      profileRegistry: null
    },
    10: {
      projectRegistry: null,
      treasury: null,
      profileRegistry: null
    },
    8453: {
      projectRegistry: null,
      treasury: null,
      profileRegistry: null
    }
  };

  return {
    defaultMode: DEFAULT_MODE,
    modes: MODES,
    app: APP,
    contracts: CONTRACTS
  };
 }());

window.GTPConfig = GTPConfig;
