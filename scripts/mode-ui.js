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

  var modeLinks = document.querySelectorAll('[data-mode-link]');
  modeLinks.forEach(function (link) {
    var mode = link.getAttribute('data-mode-link');
    link.setAttribute('href', mode === 'app' ? 'index.html' : 'views/spiral.html');
  });
}());
