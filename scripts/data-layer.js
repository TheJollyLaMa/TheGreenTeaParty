/**
 * data-layer.js — Shared client-side data access module
 * The Green Tea Party Fund · v0.4
 *
 * Loads and normalises data/projects.json, data/associations.json, and the
 * optional data/activity.json.  Provides selectors and a shared filter state
 * that both the dashboard (app.js) and the spiral view (spiral.js) can consume.
 *
 * Usage:
 *   GTPData.load().then(({ projects, associations, activity }) => { … });
 *   // or
 *   await GTPData.load();
 *   const projects = GTPData.getProjects();
 */

/* global window */

var GTPData = (function () {
  'use strict';

  // ---- Schema ------------------------------------------------------------------

  /** Fields every project record must have. */
  var REQUIRED_PROJECT_FIELDS = ['id', 'name', 'track', 'status', 'raised', 'goal'];

  /** Fields every association record must have. */
  var REQUIRED_ASSOCIATION_FIELDS = ['source', 'target'];

  /** Days before a project update is considered stale. */
  var FRESHNESS_WINDOW_DAYS = 30;

  /** Days of silence that starts counting a project as at-risk. */
  var AT_RISK_STALE_DAYS = 21;

  // ---- Internal state ----------------------------------------------------------

  var _projects = [];
  var _associations = [];
  var _activity = [];
  var _loadPromise = null;

  // ---- Shared filter state (consumed by dashboard and spiral) ------------------

  var filterState = { track: 'all', status: 'all', search: '' };
  var _filterListeners = [];

  function onFilterChange(fn) {
    if (typeof fn === 'function') _filterListeners.push(fn);
  }

  function setFilter(key, value) {
    filterState[key] = value;
    var snapshot = { track: filterState.track, status: filterState.status, search: filterState.search };
    _filterListeners.forEach(function (fn) { fn(snapshot); });
  }

  // ---- Validation & normalisation ----------------------------------------------

  function validateProject(raw, index) {
    var missing = REQUIRED_PROJECT_FIELDS.filter(function (f) { return !(f in raw); });
    if (missing.length) {
      console.warn('[GTPData] projects[' + index + '] missing required fields: ' + missing.join(', '), raw);
      return false;
    }
    if (typeof raw.raised !== 'number' || typeof raw.goal !== 'number') {
      console.warn('[GTPData] projects[' + index + '] raised/goal must be numbers', raw);
      return false;
    }
    if (!raw.id || typeof raw.id !== 'string') {
      console.warn('[GTPData] projects[' + index + '] id must be a non-empty string', raw);
      return false;
    }
    return true;
  }

  function normalizeProject(raw, index) {
    if (!validateProject(raw, index)) return null;
    return {
      id: raw.id,
      name: String(raw.name || '(Unnamed)'),
      track: String(raw.track || 'Unknown'),
      status: String(raw.status || 'planning'),
      raised: Number(raw.raised) || 0,
      goal: Number(raw.goal) || 0,
      lastUpdate: raw.lastUpdate || null,
      publicUpdate: raw.publicUpdate || raw.lastUpdate || null,
      stewards: Number(raw.stewards) || 0,
      description: String(raw.description || ''),
      repoUrl: raw.repoUrl || null,
      artizenUrl: raw.artizenUrl || null,
      nextAction: raw.nextAction || null,
      location: raw.location || null
    };
  }

  function validateAssociation(raw, index) {
    var missing = REQUIRED_ASSOCIATION_FIELDS.filter(function (f) { return !raw[f]; });
    if (missing.length) {
      console.warn('[GTPData] associations[' + index + '] missing fields: ' + missing.join(', '), raw);
      return false;
    }
    return true;
  }

  function normalizeAssociation(raw, index) {
    if (!validateAssociation(raw, index)) return null;
    return {
      source: String(raw.source),
      target: String(raw.target),
      type: String(raw.type || 'collaboration')
    };
  }

  function normalizeActivity(raw, index) {
    if (!raw.type || !raw.date) {
      console.warn('[GTPData] activity[' + index + '] missing type or date', raw);
      return null;
    }
    return {
      type: String(raw.type),
      title: String(raw.title || ''),
      amount: typeof raw.amount === 'number' ? raw.amount : null,
      date: String(raw.date),
      projectId: raw.projectId || null
    };
  }

  // ---- Data loading ------------------------------------------------------------

  /**
   * Load all data files.  Subsequent calls return the same promise (cached).
   * @param {string} [basePath=''] - Optional path prefix (e.g. '../' when loading from views/).
   * @returns {Promise<{projects: Array, associations: Array, activity: Array}>}
   */
  function load(basePath) {
    basePath = basePath || '';
    if (_loadPromise) return _loadPromise;

    _loadPromise = Promise.all([
      fetch(basePath + 'data/projects.json'),
      fetch(basePath + 'data/associations.json')
    ]).then(function (responses) {
      var pRes = responses[0];
      var aRes = responses[1];
      if (!pRes.ok) throw new Error('[GTPData] Failed to load data/projects.json (HTTP ' + pRes.status + ')');
      if (!aRes.ok) throw new Error('[GTPData] Failed to load data/associations.json (HTTP ' + aRes.status + ')');
      return Promise.all([pRes.json(), aRes.json()]);
    }).then(function (data) {
      var rawProjects = data[0];
      var rawAssociations = data[1];

      if (!Array.isArray(rawProjects)) throw new Error('[GTPData] projects.json must be a JSON array');
      if (!Array.isArray(rawAssociations)) throw new Error('[GTPData] associations.json must be a JSON array');

      _projects = rawProjects
        .map(function (p, i) { return normalizeProject(p, i); })
        .filter(Boolean);

      _associations = rawAssociations
        .map(function (a, i) { return normalizeAssociation(a, i); })
        .filter(Boolean);

      // Validate that association endpoints reference known project IDs
      var knownIds = new Set(_projects.map(function (p) { return p.id; }));
      _associations.forEach(function (a, i) {
        if (!knownIds.has(a.source)) {
          console.warn('[GTPData] associations[' + i + '].source "' + a.source + '" does not match any project id');
        }
        if (!knownIds.has(a.target)) {
          console.warn('[GTPData] associations[' + i + '].target "' + a.target + '" does not match any project id');
        }
      });

      // Load optional activity.json
      return fetch(basePath + 'data/activity.json').then(function (res) {
        if (!res.ok) return [];
        return res.json();
      }).catch(function () {
        return [];
      }).then(function (rawActivity) {
        if (Array.isArray(rawActivity)) {
          _activity = rawActivity
            .map(function (a, i) { return normalizeActivity(a, i); })
            .filter(Boolean);
        } else {
          console.warn('[GTPData] activity.json must be a JSON array — skipping');
        }
        return { projects: _projects, associations: _associations, activity: _activity };
      });
    }).catch(function (err) {
      // Reset so a retry is possible after fixing data files
      _loadPromise = null;
      return Promise.reject(err);
    });

    return _loadPromise;
  }

  // ---- Selectors ---------------------------------------------------------------

  /** Return a copy of the normalised project array. */
  function getProjects() { return _projects.slice(); }

  /** Return a copy of the normalised association array. */
  function getAssociations() { return _associations.slice(); }

  /** Return a copy of the normalised activity array. */
  function getActivity() { return _activity.slice(); }

  /** Look up a single project by its id. */
  function getProjectById(id) {
    return _projects.find(function (p) { return p.id === id; }) || null;
  }

  /**
   * Return the ids of all projects directly connected to the given id.
   * @param {string} id
   * @returns {string[]}
   */
  function getNeighborIds(id) {
    return _associations
      .filter(function (a) { return a.source === id || a.target === id; })
      .map(function (a) { return a.source === id ? a.target : a.source; });
  }

  /**
   * Build an adjacency map: { [projectId]: Set<projectId> }.
   * Useful for the spiral view.
   */
  function buildAdjacency() {
    var adj = {};
    _projects.forEach(function (p) { adj[p.id] = new Set(); });
    _associations.forEach(function (a) {
      if (adj[a.source]) adj[a.source].add(a.target);
      if (adj[a.target]) adj[a.target].add(a.source);
    });
    return adj;
  }

  /** Aggregate totals across all (or a filtered subset of) projects. */
  function getTotals(projects) {
    var list = projects || _projects;
    var raised = 0, goal = 0;
    list.forEach(function (p) { raised += p.raised; goal += p.goal; });
    return { raised: raised, goal: goal };
  }

  /** Count projects by status. */
  function getStatusCounts(projects) {
    var list = projects || _projects;
    var counts = {};
    list.forEach(function (p) {
      counts[p.status] = (counts[p.status] || 0) + 1;
    });
    return counts;
  }

  /**
   * Return unique filter option values from the loaded data.
   * @returns {{ tracks: string[], statuses: string[], locations: string[] }}
   */
  function getFilterOptions() {
    var tracks = [];
    var statuses = [];
    var locations = [];
    var seenTracks = {}, seenStatuses = {}, seenLocations = {};
    _projects.forEach(function (p) {
      if (p.track && !seenTracks[p.track]) { seenTracks[p.track] = 1; tracks.push(p.track); }
      if (p.status && !seenStatuses[p.status]) { seenStatuses[p.status] = 1; statuses.push(p.status); }
      if (p.location && !seenLocations[p.location]) { seenLocations[p.location] = 1; locations.push(p.location); }
    });
    return {
      tracks: tracks.sort(),
      statuses: statuses.sort(),
      locations: locations.sort()
    };
  }

  /**
   * Apply a filter state object and return matching projects.
   * Uses the shared `filterState` when no explicit state is passed.
   * @param {{ track?: string, status?: string, search?: string }} [state]
   * @returns {Array}
   */
  function filterProjects(state) {
    var s = state || filterState;
    var search = (s.search || '').trim().toLowerCase();
    return _projects.filter(function (p) {
      if (s.track && s.track !== 'all' && p.track !== s.track) return false;
      if (s.status && s.status !== 'all' && p.status !== s.status) return false;
      if (search && !p.name.toLowerCase().includes(search) && !p.description.toLowerCase().includes(search)) return false;
      return true;
    });
  }

  // ---- Public API --------------------------------------------------------------

  return {
    // Data loading
    load: load,

    // Raw accessors
    getProjects: getProjects,
    getAssociations: getAssociations,
    getActivity: getActivity,

    // Lookup helpers
    getProjectById: getProjectById,
    getNeighborIds: getNeighborIds,
    buildAdjacency: buildAdjacency,

    // Aggregate selectors
    getTotals: getTotals,
    getStatusCounts: getStatusCounts,
    getFilterOptions: getFilterOptions,
    filterProjects: filterProjects,

    // Shared filter state
    filterState: filterState,
    setFilter: setFilter,
    onFilterChange: onFilterChange,

    // Constants (consumed by kpi.js and views)
    FRESHNESS_WINDOW_DAYS: FRESHNESS_WINDOW_DAYS,
    AT_RISK_STALE_DAYS: AT_RISK_STALE_DAYS
  };
}());
