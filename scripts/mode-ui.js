/* global window, GTPModeRouter */

(function () {
  'use strict';

  var modeInfo = GTPModeRouter.getModeInfo(window.location);
  var badge = document.getElementById('mode-badge');

  if (badge) {
    badge.textContent = modeInfo.label;
    badge.classList.toggle('mode-badge--prototype', modeInfo.isPrototype);
    badge.classList.toggle('mode-badge--app', modeInfo.isApp);
  }

  var canonicalRootHref = new URL('../index.html', document.currentScript.src).href;
  var modeLinks = document.querySelectorAll('[data-mode-link]');
  modeLinks.forEach(function (link) {
    var mode = link.getAttribute('data-mode-link');
    if (mode !== 'app' && mode !== 'prototype') {
      return;
    }

    link.setAttribute('href', canonicalRootHref);
  });
}());
