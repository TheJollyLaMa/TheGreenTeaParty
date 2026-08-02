/* global window */

var GTPDataAdapterInterface = (function () {
  'use strict';

  var REQUIRED_METHODS = ['getProjects', 'getAssociations', 'getMetrics', 'getActivity'];

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
    assertAdapter: assertAdapter
  };
}());

window.GTPDataAdapterInterface = GTPDataAdapterInterface;
