/* global window, GTPContractAdapter */

var GTPAppDataAdapter = (function () {
  'use strict';

  function fetchJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) {
        throw new Error('[GTPAppDataAdapter] Failed to load ' + url + ' (HTTP ' + res.status + ')');
      }
      return res.json();
    });
  }

  function create(options) {
    var basePath = (options && options.basePath) || '';
    var appState = options && options.appState;
    var contractAdapter = GTPContractAdapter.create({
      chainId: appState && typeof appState.getSessionIdentity === 'function'
        ? appState.getSessionIdentity().chainId
        : null
    });

    return {
      getProjects: function () {
        return fetchJson(basePath + 'data/projects.json');
      },
      getAssociations: function () {
        return fetchJson(basePath + 'data/associations.json');
      },
      getActivity: function () {
        return fetch(basePath + 'data/activity.json').then(function (res) {
          if (!res.ok) return [];
          return res.json();
        }).catch(function () {
          return [];
        });
      },
      getMetrics: function () {
        var readiness = appState && typeof appState.getReadiness === 'function'
          ? appState.getReadiness()
          : { ready: false, reason: 'Wallet state unavailable.' };

        return contractAdapter.getContractState().then(function (contractState) {
          var baseReason = readiness.reason || contractState.reason || 'Wallet connection required to load live contract data.';
          return {
            availableFunds: 9200,
            placeholder: true,
            reason: baseReason + ' Showing a fixture-backed fund snapshot until live contract reads are configured.'
          };
        });
      },
      getContractState: function () {
        return contractAdapter.getContractState();
      },
      getProjectRecord: function (projectId) {
        return contractAdapter.getProjectRecord(projectId);
      },
      getProjectBalance: function (projectId) {
        return contractAdapter.getProjectBalance(projectId);
      },
      getProfilePointer: function (account) {
        return contractAdapter.getProfilePointer(account);
      },
      registerProject: function (projectId, steward, metadataURI) {
        return contractAdapter.registerProject(projectId, steward, metadataURI);
      },
      updateProjectMetadataURI: function (projectId, metadataURI) {
        return contractAdapter.updateProjectMetadataURI(projectId, metadataURI);
      },
      updateProjectStatus: function (projectId, nextStatus) {
        return contractAdapter.updateProjectStatus(projectId, nextStatus);
      },
      transferProjectSteward: function (projectId, nextSteward) {
        return contractAdapter.transferProjectSteward(projectId, nextSteward);
      },
      setProfilePointer: function (profileURI) {
        return contractAdapter.setProfilePointer(profileURI);
      },
      contribute: function (projectId, options) {
        return contractAdapter.contribute(projectId, options);
      },
      setPayoutAddress: function (projectId, payoutAddress) {
        return contractAdapter.setPayoutAddress(projectId, payoutAddress);
      },
      withdraw: function (projectId, amountWei) {
        return contractAdapter.withdraw(projectId, amountWei);
      }
    };
  }

  return {
    create: create
  };
}());

window.GTPAppDataAdapter = GTPAppDataAdapter;
