/* global window */

var GTPMockDataAdapter = (function () {
  'use strict';

  function fetchJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) {
        throw new Error('[GTPMockDataAdapter] Failed to load ' + url + ' (HTTP ' + res.status + ')');
      }
      return res.json();
    });
  }

  function create(options) {
    var basePath = (options && options.basePath) || '';

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
        return Promise.resolve({
          availableFunds: 9200,
          placeholder: false
        });
      }
    };
  }

  return {
    create: create
  };
}());

window.GTPMockDataAdapter = GTPMockDataAdapter;
