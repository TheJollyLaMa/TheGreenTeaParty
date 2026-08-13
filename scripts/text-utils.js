/* global window */

(function () {
  'use strict';

  function formatTextValue(value, fallback = 'Not provided') {
    if (value === null || value === undefined) {
      return fallback;
    }

    const text = String(value).trim();
    return text ? text : fallback;
  }

  window.formatTextValue = formatTextValue;
}());
