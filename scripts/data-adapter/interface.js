/* global window */

var GTPDataAdapterInterface = (function () {
  'use strict';

  var REQUIRED_METHODS = ['getProjects', 'getAssociations', 'getMetrics', 'getActivity'];
  var OPTIONAL_APP_METHODS = [
    'getContractState',
    'getProjectRecord',
    'getProjectBalance',
    'getProfilePointer',
    'registerProject',
    'updateProjectMetadata',
    'updateProjectStatus',
    'transferProjectSteward',
    'setProfilePointer',
    'contribute',
    'setPayoutAddress',
    'withdraw'
  ];

  function assertAdapter(adapter, adapterName) {
    if (!adapter) {
      throw new Error('[GTPData] Missing adapter: ' + (adapterName || 'unknown'));
    }

    var missing = REQUIRED_METHODS.filter(function (method) {
      return typeof adapter[method] !== 'function';
    });

    if (missing.length) {
      throw new Error('[GTPData] Adapter "' + (adapterName || 'unknown') + '" missing methods: ' + missing.join(', '));
    }

    return adapter;
  }

  return {
    REQUIRED_METHODS: REQUIRED_METHODS.slice(),
    OPTIONAL_APP_METHODS: OPTIONAL_APP_METHODS.slice(),
    assertAdapter: assertAdapter
  };
}());

window.GTPDataAdapterInterface = GTPDataAdapterInterface;
