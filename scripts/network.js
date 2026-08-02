/* global window, GTPConfig */

var GTPNetwork = (function () {
  'use strict';

  function parseChainId(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;
    if (value.indexOf('0x') === 0 || value.indexOf('0X') === 0) {
      return parseInt(value, 16);
    }
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function isSupportedChain(chainId) {
    return typeof chainId === 'number' && GTPConfig.app.supportedChainIds.indexOf(chainId) !== -1;
  }

  function supportedChainLabel() {
    return GTPConfig.app.supportedChainIds.join(', ');
  }

  return {
    parseChainId: parseChainId,
    isSupportedChain: isSupportedChain,
    supportedChainLabel: supportedChainLabel
  };
}());

window.GTPNetwork = GTPNetwork;
