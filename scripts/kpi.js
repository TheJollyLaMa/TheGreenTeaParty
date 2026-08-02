/**
 * kpi.js — Stewardship KPI Panel
 * The Green Tea Party Fund · v0.4
 *
 * Renders an agency-first KPI panel showing project health and action readiness.
 * Depends on GTPData (scripts/data-layer.js) being loaded first.
 *
 * Usage:
 *   GTPKpi.render(document.getElementById('kpi-panel'));
 */

/* global GTPData */

var GTPKpi = (function () {
  'use strict';

  // ---- Helpers -----------------------------------------------------------------

  /**
   * Return the number of whole days elapsed since the given ISO date string.
   * Returns Infinity for null/undefined/unparseable dates.
   */
  function daysSince(dateStr) {
    if (!dateStr) return Infinity;
    var ms = Date.now() - new Date(dateStr).getTime();
    if (isNaN(ms)) return Infinity;
    return Math.floor(ms / 86400000);
  }

  // ---- KPI calculations --------------------------------------------------------

  /**
   * Count activity entries of type "mission-complete" within the past windowDays.
   * @param {Array} activity
   * @param {number} [windowDays=30]
   * @returns {number}
   */
  function calcCompletedMissions(activity, windowDays) {
    var days = windowDays !== undefined ? windowDays : 30;
    var cutoff = Date.now() - days * 86400000;
    return activity.filter(function (a) {
      return a.type === 'mission-complete' && new Date(a.date).getTime() >= cutoff;
    }).length;
  }

  /**
   * Median days since last update for active/planning projects that have no
   * nextAction defined.  Returns null when every such project has a nextAction.
   * @param {Array} projects
   * @returns {number|null}
   */
  function calcMedianDaysToNextAction(projects) {
    var needsAction = projects.filter(function (p) {
      return (p.status === 'active' || p.status === 'planning') && !p.nextAction;
    });
    if (!needsAction.length) return null;
    var days = needsAction
      .map(function (p) { return daysSince(p.lastUpdate); })
      .sort(function (a, b) { return a - b; });
    var mid = Math.floor(days.length / 2);
    return days.length % 2 === 0
      ? Math.round((days[mid - 1] + days[mid]) / 2)
      : days[mid];
  }

  /**
   * Percentage of non-completed projects whose publicUpdate (or lastUpdate) falls
   * within the freshness window.
   * @param {Array} projects
   * @param {number} [windowDays]
   * @returns {number} 0-100
   */
  function calcFreshnessPercent(projects, windowDays) {
    var days = windowDays !== undefined ? windowDays : GTPData.FRESHNESS_WINDOW_DAYS;
    var active = projects.filter(function (p) { return p.status !== 'completed'; });
    if (!active.length) return 100;
    var fresh = active.filter(function (p) {
      return daysSince(p.publicUpdate || p.lastUpdate) <= days;
    });
    return Math.round((fresh.length / active.length) * 100);
  }

  /**
   * Count projects that are at risk based on rule-based heuristics:
   *   - No update in AT_RISK_STALE_DAYS+ days, OR
   *   - Over 80% of goal still unraised and under $1,000 raised (very low runway).
   * Completed projects are excluded.
   * @param {Array} projects
   * @param {number} [staleDays]
   * @returns {number}
   */
  function calcAtRiskCount(projects, staleDays) {
    var stale = staleDays !== undefined ? staleDays : GTPData.AT_RISK_STALE_DAYS;
    return projects.filter(function (p) {
      if (p.status === 'completed') return false;
      var isStale = daysSince(p.lastUpdate) > stale;
      var runway = p.goal > 0 ? (p.goal - p.raised) / p.goal : 0;
      var isLowRunway = runway > 0.8 && p.raised < 1000;
      return isStale || isLowRunway;
    }).length;
  }

  // ---- Rendering ---------------------------------------------------------------

  /**
   * Render the KPI panel into containerEl.
   * @param {HTMLElement} containerEl  - The <ul> or container to fill.
   */
  function render(containerEl) {
    if (!containerEl) return;

    var projects = GTPData.getProjects();
    var activity = GTPData.getActivity();
    var freshnessWindowDays = GTPData.FRESHNESS_WINDOW_DAYS;
    var atRiskStaleDays = GTPData.AT_RISK_STALE_DAYS;

    var missionsCompleted = calcCompletedMissions(activity, 30);
    var medianDays = calcMedianDaysToNextAction(projects);
    var freshnessPercent = calcFreshnessPercent(projects, freshnessWindowDays);
    var atRiskCount = calcAtRiskCount(projects, atRiskStaleDays);

    var kpis = [
      {
        label: 'Active missions completed',
        value: String(missionsCompleted),
        subtext: 'last 30 days',
        tooltip: 'Count of activity entries with type \u201cmission-complete\u201d in the past 30 days. Sourced from data/activity.json.'
      },
      {
        label: 'Median days since last action',
        value: medianDays === null ? '\u2014' : String(medianDays) + 'd',
        subtext: medianDays === null ? 'all active projects have a next action' : 'for projects without a next action',
        tooltip: 'Median days since the last recorded update for active or planning projects that have no \u201cnextAction\u201d field set. A rising number signals stewards need to schedule their next step.'
      },
      {
        label: 'Projects with current update',
        value: freshnessPercent + '%',
        subtext: 'updated within ' + freshnessWindowDays + ' days',
        tooltip: 'Percentage of non-completed projects with a publicUpdate (or lastUpdate) within the past ' + freshnessWindowDays + ' days. Measures whether the community can see recent progress.'
      },
      {
        label: 'At-risk projects',
        value: String(atRiskCount),
        subtext: 'stale update or low runway',
        tooltip: 'Projects with no update in ' + atRiskStaleDays + '+ days, or with over 80% of funding goal unmet and under $1,000 raised. These need steward attention.'
      }
    ];

    containerEl.innerHTML = kpis.map(function (kpi) {
      return '<li class="kpi-card">' +
        '<div class="kpi-header">' +
          '<span class="kpi-label">' + kpi.label + '</span>' +
          '<button class="kpi-info-btn" type="button" aria-label="About this metric: ' + kpi.label + '" title="' + kpi.tooltip + '">\u24d8</button>' +
        '</div>' +
        '<p class="kpi-value">' + kpi.value + '</p>' +
        '<p class="kpi-subtext">' + kpi.subtext + '</p>' +
        '</li>';
    }).join('');
  }

  // ---- Public API --------------------------------------------------------------

  return {
    render: render,
    calcCompletedMissions: calcCompletedMissions,
    calcMedianDaysToNextAction: calcMedianDaysToNextAction,
    calcFreshnessPercent: calcFreshnessPercent,
    calcAtRiskCount: calcAtRiskCount,
    daysSince: daysSince
  };
}());
