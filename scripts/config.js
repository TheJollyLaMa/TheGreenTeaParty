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

  return {
    defaultMode: DEFAULT_MODE,
    modes: MODES,
    app: APP
  };
 }());

window.GTPConfig = GTPConfig;
