/* global window */

var GTPConfig = (function () {
  'use strict';

  var DEFAULT_MODE = 'app';
  var MODES = {
    prototype: {
      label: 'Prototype mode'
    },
    app: {
      label: 'Unified live view'
    }
  };

  // Optimism Mainnet is the default chain for app mode (chainId 10).
  // Contracts are deployed there for v0.56. See config/deployed-addresses.json
  // and DEPLOYMENT.md for addresses and runbook.
  var APP = {
    defaultChainId: 10,
    supportedChainIds: [10]
  };

  // Contract addresses per chain. Update after each deployment by running
  // scripts/deploy/01_deploy_all.js and copying the output here.
  // PENDING values mean deployment has not yet been performed for that chain.
  var CONTRACTS = {
    10: {
      projectRegistry: null,
      treasury: null,
      profileRegistry: null
    }
  };

  // Optimism Mainnet network metadata used by the UI.
  var NETWORKS = {
    10: {
      name: 'Optimism',
      label: 'Optimism Mainnet',
      rpcUrl: 'https://mainnet.optimism.io',
      blockExplorer: 'https://optimistic.etherscan.io',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }
    }
  };

  return {
    defaultMode: DEFAULT_MODE,
    modes: MODES,
    app: APP,
    contracts: CONTRACTS,
    networks: NETWORKS
  };
 }());

window.GTPConfig = GTPConfig;
