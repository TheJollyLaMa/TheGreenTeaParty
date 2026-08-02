/* global window, GTPConfig */

var GTPModeRouter = (function () {
  'use strict';

  function getModeFromSearch(search) {
    var params = new URLSearchParams(search || '');
    var mode = params.get('mode');
    return mode && GTPConfig.modes[mode] ? mode : null;
  }

  function getModeFromPath(pathname) {
    var path = String(pathname || '/').toLowerCase();
    if (path === '/app' || path.indexOf('/app/') === 0) return 'app';
    if (path === '/prototype' || path.indexOf('/prototype/') === 0) return 'prototype';
    return null;
  }

  function resolveMode(locationLike) {
    var searchMode = getModeFromSearch(locationLike && locationLike.search);
    if (searchMode) {
      return { mode: searchMode, source: 'query' };
    }

    var pathMode = getModeFromPath(locationLike && locationLike.pathname);
    if (pathMode) {
      return { mode: pathMode, source: 'path' };
    }

    return {
      mode: GTPConfig.defaultMode,
      source: 'default'
    };
  }

  function getModeInfo(locationLike) {
    var resolved = resolveMode(locationLike || window.location);
    return {
      mode: resolved.mode,
      source: resolved.source,
      label: GTPConfig.modes[resolved.mode].label,
      isPrototype: resolved.mode === 'prototype',
      isApp: resolved.mode === 'app'
    };
  }

  return {
    resolveMode: resolveMode,
    getModeInfo: getModeInfo
  };
}());

window.GTPModeRouter = GTPModeRouter;
