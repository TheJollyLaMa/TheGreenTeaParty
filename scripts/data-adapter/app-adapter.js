/* global window */

var GTPAppDataAdapter = (function () {
  'use strict';

  function create(options) {
    var appState = options && options.appState;

    return {
      getProjects: function () {
        return Promise.resolve([]);
      },
      getAssociations: function () {
        return Promise.resolve([]);
      },
      getActivity: function () {
        return Promise.resolve([]);
      },
      getMetrics: function () {
        var readiness = appState && typeof appState.getReadiness === 'function'
          ? appState.getReadiness()
          : { ready: false, reason: 'Wallet state unavailable.' };

        return Promise.resolve({
          availableFunds: 0,
          placeholder: true,
          reason: readiness.reason || 'Wallet connection required to load app data.'
        });
      }
    };
  }

  return {
    create: create
  };
}());

window.GTPAppDataAdapter = GTPAppDataAdapter;
