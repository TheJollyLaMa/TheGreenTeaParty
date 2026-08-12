/* global window, GTPContractAdapter */

var GTPAppDataAdapter = (function () {
  'use strict';

  function create(options) {
    var appState = options && options.appState;
    var contractAdapter = GTPContractAdapter.create({
      chainId: appState && typeof appState.getSessionIdentity === 'function'
        ? appState.getSessionIdentity().chainId
        : null
    });

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

        return contractAdapter.getContractState().then(function (contractState) {
          return {
            availableFunds: 0,
            placeholder: true,
            reason: readiness.reason || contractState.reason || 'Wallet connection required to load app data.'
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
      updateProjectMetadata: function (projectId, metadataURI) {
        return contractAdapter.updateProjectMetadata(projectId, metadataURI);
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
      contribute: function (projectId, amountWei) {
        return contractAdapter.contribute(projectId, amountWei);
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
