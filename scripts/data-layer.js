/**
 * data-layer.js — Shared client-side data access module
 * The Green Tea Party Fund · v0.4+
 *
 * Loads and normalises project data through mode-specific adapters.
 */

/* global window, GTPDataAdapterInterface, GTPMockDataAdapter, GTPAppDataAdapter, GTPModeRouter, GTPAppState */

var GTPData = (function () {
  'use strict';

  // ---- Schema ------------------------------------------------------------------

  var REQUIRED_PROJECT_FIELDS = ['id', 'name', 'track', 'status', 'raised', 'goal'];
  var REQUIRED_ASSOCIATION_FIELDS = ['source', 'target'];
  var FRESHNESS_WINDOW_DAYS = 30;
  var AT_RISK_STALE_DAYS = 21;
  var CONTRACT_EVENT_MAP = {
    ProjectRegistered: { type: 'project-registered', category: 'project-registry', direction: 'incoming' },
    ProjectMetadataUpdated: { type: 'project-metadata-updated', category: 'project-registry', direction: 'incoming' },
    ProjectStatusUpdated: { type: 'project-status-updated', category: 'project-registry', direction: 'incoming' },
    ProjectStewardTransferred: { type: 'project-steward-transferred', category: 'project-registry', direction: 'incoming' },
    ContributionReceived: { type: 'contribution-received', category: 'treasury', direction: 'incoming' },
    PayoutAddressUpdated: { type: 'payout-address-updated', category: 'treasury', direction: 'incoming' },
    Withdrawal: { type: 'withdrawal', category: 'treasury', direction: 'outgoing' },
    ProfileURIUpdated: { type: 'profile-uri-updated', category: 'profile-registry', direction: 'incoming' }
  };
  var PROJECT_STATUS_BY_CODE = {
    0: 'draft',
    1: 'active',
    2: 'paused',
    3: 'completed'
  };

  // ---- Internal state ----------------------------------------------------------

  var _projects = [];
  var _associations = [];
  var _activity = [];
  var _loadPromise = null;
  var _modeInfo = null;
  var _adapter = null;
  var _adapterMetrics = { availableFunds: 0, placeholder: false, reason: '' };

  // ---- Shared filter state -----------------------------------------------------

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

  function getSafeObject(value) {
    return value && typeof value === 'object' ? value : {};
  }

  function toFiniteNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      var trimmed = value.trim();
      if (!trimmed) return null;
      var parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function normalizeTimestamp(value, index, raw) {
    if (value === undefined || value === null || value === '') {
      console.warn('[GTPData] activity[' + index + '] missing timestamp/date', raw);
      return { date: '—', timestamp: null, sortTime: 0 };
    }

    var date = null;
    if (typeof value === 'number') {
      var millis = value > 9999999999 ? value : value * 1000;
      date = new Date(millis);
    } else {
      date = new Date(value);
    }

    if (Number.isNaN(date.getTime())) {
      console.warn('[GTPData] activity[' + index + '] has invalid timestamp/date', raw);
      return {
        date: String(value),
        timestamp: null,
        sortTime: 0
      };
    }

    return {
      date: date.toISOString().slice(0, 10),
      timestamp: date.toISOString(),
      sortTime: date.getTime()
    };
  }

  function normalizeDirection(rawDirection, amount, fallbackDirection) {
    if (rawDirection === 'incoming' || rawDirection === 'outgoing') return rawDirection;
    if (fallbackDirection === 'incoming' || fallbackDirection === 'outgoing') return fallbackDirection;
    if (amount === null) return 'incoming';
    return amount < 0 ? 'outgoing' : 'incoming';
  }

  function normalizeStatus(value) {
    var raw = String(value || 'confirmed').trim().toLowerCase();
    if (!raw) return 'confirmed';
    if (raw === 'ok' || raw === 'success' || raw === 'succeeded') return 'confirmed';
    if (raw === 'pending' || raw === 'queued' || raw === 'in-progress' || raw === 'processing') return 'pending';
    if (raw === 'failed' || raw === 'failure' || raw === 'error' || raw === 'reverted') return 'failed';
    return raw;
  }

  function buildContractDescription(eventName, args, fallbackTitle) {
    var projectId = args.projectId || null;
    var statusLabel = Object.prototype.hasOwnProperty.call(PROJECT_STATUS_BY_CODE, args.nextStatus)
      ? PROJECT_STATUS_BY_CODE[args.nextStatus]
      : null;

    switch (eventName) {
      case 'ContributionReceived':
        return projectId ? 'Contribution received for project ' + projectId : 'Contribution received';
      case 'Withdrawal':
        return projectId ? 'Withdrawal executed for project ' + projectId : 'Withdrawal executed';
      case 'ProjectStatusUpdated':
        if (projectId && statusLabel) return 'Project ' + projectId + ' status updated to ' + statusLabel;
        return projectId ? 'Project ' + projectId + ' status updated' : 'Project status updated';
      case 'ProjectRegistered':
        return projectId ? 'Project ' + projectId + ' registered' : 'Project registered';
      case 'ProjectMetadataUpdated':
        return projectId ? 'Project ' + projectId + ' metadata updated' : 'Project metadata updated';
      case 'ProjectStewardTransferred':
        return projectId ? 'Project ' + projectId + ' steward transferred' : 'Project steward transferred';
      case 'PayoutAddressUpdated':
        return projectId ? 'Payout address updated for project ' + projectId : 'Payout address updated';
      case 'ProfileURIUpdated':
        return 'Profile pointer updated';
      default:
        return fallbackTitle || '';
    }
  }

  function buildLedgerId(raw, index, eventName, timestampInfo, amount, projectId) {
    if (raw.id) return String(raw.id);

    var parts = [];
    var txHash = raw.transactionHash || raw.txHash || null;
    if (txHash) parts.push(String(txHash));
    if (raw.logIndex !== undefined && raw.logIndex !== null) parts.push(String(raw.logIndex));
    if (raw.blockNumber !== undefined && raw.blockNumber !== null) parts.push(String(raw.blockNumber));
    if (eventName) parts.push(String(eventName));
    if (projectId) parts.push(String(projectId));
    if (timestampInfo && timestampInfo.timestamp) parts.push(timestampInfo.timestamp);
    if (amount !== null) parts.push(String(amount));

    if (!parts.length) {
      return 'entry-' + String(index + 1).padStart(4, '0');
    }

    return 'ledger-' + parts.join(':').replace(/[^a-zA-Z0-9:_-]+/g, '-').slice(0, 180);
  }

  function normalizeActivity(raw, index) {
    if (!raw || typeof raw !== 'object') {
      console.warn('[GTPData] activity[' + index + '] must be an object', raw);
      return null;
    }

    var args = getSafeObject(raw.args);
    var eventName = raw.eventName || raw.event || null;
    var eventDefaults = eventName ? CONTRACT_EVENT_MAP[eventName] : null;

    var typeValue = raw.type || (eventDefaults && eventDefaults.type) || eventName;
    if (!typeValue) {
      console.warn('[GTPData] activity[' + index + '] missing type/event name', raw);
      return null;
    }

    var timestampInfo = normalizeTimestamp(raw.timestamp !== undefined ? raw.timestamp : (raw.blockTimestamp !== undefined ? raw.blockTimestamp : raw.date), index, raw);
    var rawAmount = raw.amount;
    if (rawAmount === undefined || rawAmount === null) {
      rawAmount = args.amount;
    }
    var amount = toFiniteNumber(rawAmount);
    if (rawAmount !== undefined && rawAmount !== null && amount === null) {
      console.warn('[GTPData] activity[' + index + '] has non-numeric amount', raw);
    }

    var projectIdValue = raw.projectId !== undefined && raw.projectId !== null ? raw.projectId : args.projectId;
    var projectId = projectIdValue === undefined || projectIdValue === null ? null : String(projectIdValue);
    var direction = normalizeDirection(raw.direction, amount, eventDefaults && eventDefaults.direction);
    var status = normalizeStatus(raw.status);
    var title = String(raw.title || eventName || typeValue);
    var category = String(raw.category || (eventDefaults && eventDefaults.category) || typeValue || 'general');
    var description = String(raw.description || buildContractDescription(eventName, args, title));
    var ledgerId = buildLedgerId(raw, index, eventName || typeValue, timestampInfo, amount, projectId);

    return {
      id: ledgerId,
      type: String(typeValue),
      eventName: eventName ? String(eventName) : null,
      title: title,
      amount: amount,
      date: timestampInfo.date,
      timestamp: timestampInfo.timestamp,
      projectId: projectId,
      direction: direction,
      status: status,
      category: category,
      description: description,
      notes: String(raw.notes || ''),
      proofUrl: typeof raw.proofUrl === 'string' ? raw.proofUrl : null,
      sortTime: timestampInfo.sortTime,
      sortIndex: index
    };
  }

  function normalizeActivityRows(rawRows) {
    if (!Array.isArray(rawRows)) {
      console.warn('[GTPData] activity payload must be an array', rawRows);
      return [];
    }

    var seenIds = {};
    var normalized = rawRows
      .map(function (entry, i) { return normalizeActivity(entry, i); })
      .filter(Boolean)
      .map(function (entry) {
        var baseId = entry.id;
        var count = (seenIds[baseId] || 0) + 1;
        seenIds[baseId] = count;
        if (count > 1) {
          return Object.assign({}, entry, { id: baseId + '--' + String(count) });
        }
        return entry;
      });

    normalized.sort(function (entryA, entryB) {
      if (entryA.sortTime !== entryB.sortTime) {
        return entryB.sortTime - entryA.sortTime;
      }

      if (entryA.id !== entryB.id) {
        return String(entryA.id).localeCompare(String(entryB.id));
      }

      return Number(entryA.sortIndex || 0) - Number(entryB.sortIndex || 0);
    });

    return normalized;
  }

  function createAdapter(basePath) {
    _modeInfo = GTPModeRouter.getModeInfo(window.location);

    var adapter = _modeInfo.mode === 'app'
      ? GTPAppDataAdapter.create({ basePath: basePath, appState: GTPAppState })
      : GTPMockDataAdapter.create({ basePath: basePath });

    return GTPDataAdapterInterface.assertAdapter(adapter, _modeInfo.mode);
  }

  // ---- Data loading ------------------------------------------------------------

  function load(basePath) {
    basePath = basePath || '';
    if (_loadPromise) return _loadPromise;

    _adapter = createAdapter(basePath);

    _loadPromise = Promise.all([
      _adapter.getProjects(),
      _adapter.getAssociations(),
      _adapter.getActivity(),
      _adapter.getMetrics()
    ]).then(function (data) {
      var rawProjects = data[0];
      var rawAssociations = data[1];
      var rawActivity = data[2];
      _adapterMetrics = data[3] || _adapterMetrics;

      if (!Array.isArray(rawProjects)) throw new Error('[GTPData] adapter.getProjects() must return an array');
      if (!Array.isArray(rawAssociations)) throw new Error('[GTPData] adapter.getAssociations() must return an array');
      if (!Array.isArray(rawActivity)) rawActivity = [];

      _projects = rawProjects
        .map(function (p, i) { return normalizeProject(p, i); })
        .filter(Boolean);

      _associations = rawAssociations
        .map(function (a, i) { return normalizeAssociation(a, i); })
        .filter(Boolean);

      var knownIds = new Set(_projects.map(function (p) { return p.id; }));
      _associations.forEach(function (a, i) {
        if (!knownIds.has(a.source)) {
          console.warn('[GTPData] associations[' + i + '].source "' + a.source + '" does not match any project id');
        }
        if (!knownIds.has(a.target)) {
          console.warn('[GTPData] associations[' + i + '].target "' + a.target + '" does not match any project id');
        }
      });

      _activity = normalizeActivityRows(rawActivity);

      return { projects: _projects, associations: _associations, activity: _activity };
    }).catch(function (err) {
      _loadPromise = null;
      return Promise.reject(err);
    });

    return _loadPromise;
  }

  // ---- Selectors ---------------------------------------------------------------

  function getProjects() { return _projects.slice(); }
  function getAssociations() { return _associations.slice(); }
  function getActivity() { return _activity.slice(); }
  function getModeInfo() { return _modeInfo ? Object.assign({}, _modeInfo) : GTPModeRouter.getModeInfo(window.location); }
  function getAdapterMetrics() {
    return {
      availableFunds: Number(_adapterMetrics.availableFunds) || 0,
      placeholder: !!_adapterMetrics.placeholder,
      reason: _adapterMetrics.reason || ''
    };
  }

  function getProjectById(id) {
    return _projects.find(function (p) { return p.id === id; }) || null;
  }

  function getNeighborIds(id) {
    return _associations
      .filter(function (a) { return a.source === id || a.target === id; })
      .map(function (a) { return a.source === id ? a.target : a.source; });
  }

  function buildAdjacency() {
    var adj = {};
    _projects.forEach(function (p) { adj[p.id] = new Set(); });
    _associations.forEach(function (a) {
      if (adj[a.source]) adj[a.source].add(a.target);
      if (adj[a.target]) adj[a.target].add(a.source);
    });
    return adj;
  }

  function getTotals(projects) {
    var list = projects || _projects;
    var raised = 0;
    var goal = 0;
    list.forEach(function (p) {
      raised += p.raised;
      goal += p.goal;
    });
    return { raised: raised, goal: goal };
  }

  function getStatusCounts(projects) {
    var list = projects || _projects;
    var counts = {};
    list.forEach(function (p) {
      counts[p.status] = (counts[p.status] || 0) + 1;
    });
    return counts;
  }

  function getMetrics(projects) {
    var list = projects || _projects;
    var allTotals = getTotals(_projects);
    var totalStewards = _projects.reduce(function (sum, project) { return sum + project.stewards; }, 0);
    var activeProjects = list.filter(function (project) { return project.status === 'active'; }).length;
    var adapterMetrics = getAdapterMetrics();

    return {
      totalRaised: allTotals.raised,
      availableFunds: adapterMetrics.availableFunds,
      activeProjects: activeProjects,
      totalStewards: totalStewards,
      placeholder: adapterMetrics.placeholder,
      reason: adapterMetrics.reason
    };
  }

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

  return {
    load: load,
    getProjects: getProjects,
    getAssociations: getAssociations,
    getActivity: getActivity,
    getModeInfo: getModeInfo,
    getAdapterMetrics: getAdapterMetrics,

    getProjectById: getProjectById,
    getNeighborIds: getNeighborIds,
    buildAdjacency: buildAdjacency,

    getTotals: getTotals,
    getStatusCounts: getStatusCounts,
    getMetrics: getMetrics,
    getFilterOptions: getFilterOptions,
    filterProjects: filterProjects,
    normalizeActivityRow: normalizeActivity,
    normalizeActivityRows: normalizeActivityRows,

    filterState: filterState,
    setFilter: setFilter,
    onFilterChange: onFilterChange,

    FRESHNESS_WINDOW_DAYS: FRESHNESS_WINDOW_DAYS,
    AT_RISK_STALE_DAYS: AT_RISK_STALE_DAYS
  };
}());
