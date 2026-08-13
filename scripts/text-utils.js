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

  function hasTextValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
  }

  window.formatTextValue = formatTextValue;
  window.hasTextValue = hasTextValue;
}());
