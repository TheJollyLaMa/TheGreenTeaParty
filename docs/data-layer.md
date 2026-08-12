# Data Layer — Schema, KPIs, and How-To Guide

> **v0.4 · Decent Agency / The Green Tea Party Fund**

## Overview

`scripts/data-layer.js` is a single shared data-access module consumed by all
fund views (dashboard `index.html` and constellation `views/spiral.html`).  It
loads three JSON files, normalises records, validates required fields, and
exposes a common set of selectors and a shared filter state.

No build step is required — the module is a plain IIFE that attaches `GTPData`
to `window`.

As of v0.43, `GTPData` resolves mode via `scripts/mode-router.js` and hydrates from
a mode-specific adapter implementing the shared contract:
`getProjects()`, `getAssociations()`, `getMetrics()`, and `getActivity()`.

App mode also exposes optional contract-facing wrapper methods through
`scripts/contract-adapter.js` and `scripts/data-adapter/app-adapter.js` for the
starter `ProjectRegistry`, `Treasury`, and `ProfileRegistry` MVP.

---

## File Map

| File | Purpose |
|---|---|
| `scripts/data-layer.js` | Shared data access module |
| `scripts/kpi.js` | Stewardship KPI panel renderer |
| `data/projects.json` | Canonical project records |
| `data/associations.json` | Project relationship edges |
| `data/activity.json` | Ledger activity feed (optional) |

---

## Project Schema (`data/projects.json`)

Each entry in the array must be a JSON object.  Required fields are validated at
runtime; missing or malformed records are skipped and a `console.warn` is emitted
— the app keeps rendering with the remaining valid records.

### Required fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier, e.g. `"proj-001"` |
| `name` | `string` | Human-readable project name |
| `track` | `string` | Thematic track (e.g. `"Green Tea"`, `"Blue Tea"`) |
| `status` | `string` | Lifecycle status: `active` · `planning` · `completed` · `paused` |
| `raised` | `number` | Funds raised to date (USD) |
| `goal` | `number` | Funding target (USD) |

### Optional fields

| Field | Type | Description |
|---|---|---|
| `lastUpdate` | `string` (ISO date) | Date of the last recorded update (`YYYY-MM-DD`) |
| `publicUpdate` | `string` (ISO date) | Date of the last *public*-facing update; falls back to `lastUpdate` for KPI freshness |
| `stewards` | `number` | Number of active stewards |
| `description` | `string` | Plain-text project description |
| `repoUrl` | `string` (URL) | Link to the project's source repository |
| `artizenUrl` | `string` (URL) | Link to the Artizen funding page |
| `nextAction` | `string` | Short description of the steward's next concrete action |
| `location` | `string` | Place name (city, region) for map/filter use |

### Example record

```json
{
  "id": "proj-001",
  "name": "Green Tea Hut",
  "track": "Green Tea",
  "status": "active",
  "raised": 7800,
  "goal": 12000,
  "lastUpdate": "2026-07-28",
  "stewards": 8,
  "description": "Community tea house and garden for local gathering.",
  "repoUrl": "https://github.com/TheJollyLaMa/GreenTeaHut_01",
  "nextAction": "Schedule August volunteer orientation",
  "location": "Portland, OR"
}
```

---

## Association Schema (`data/associations.json`)

Edges connecting two projects.  Both `source` and `target` must reference a
valid project `id`; unknown IDs produce a `console.warn`.

| Field | Type | Description |
|---|---|---|
| `source` | `string` | ID of the source project |
| `target` | `string` | ID of the target project |
| `type` | `string` | Relationship type (see below) |

### Relationship types

| Type | Description |
|---|---|
| `parent-child` | One project is a sub-project of the other |
| `shared-steward` | Two projects share one or more stewards |
| `collaboration` | Active collaboration between projects |
| `funding-pool` | Projects draw from a shared funding pool |
| `research-link` | One project informs or studies the other |
| `same-track` | Implicit same-track grouping (lowest priority) |

---

## Ledger Row Normalization (`data/activity.json` + contract events)

The ledger UI consumes a **canonical row model** produced by
`GTPData.normalizeActivityRows()`. Input can be either:

- Existing `data/activity.json` entries, or
- Contract event-shaped records (`eventName`/`event`, optional `args`,
  `txHash`/`transactionHash`, `logIndex`, `blockNumber`, `timestamp`).

If the source file is absent or unreachable the app renders without ledger
rows and KPI calculations that depend on activity return safe defaults.

### Canonical ledger row schema

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Stable row id (`raw.id` when present; otherwise deterministic event-derived id) |
| `type` | `string` | Canonical row type used by UI |
| `eventName` | `string \| null` | Original contract event name when provided |
| `title` | `string` | Short human-readable title |
| `amount` | `number \| null` | Normalized numeric amount |
| `date` | `string` | Normalized display date (`YYYY-MM-DD`) |
| `timestamp` | `string \| null` | ISO timestamp when parseable |
| `projectId` | `string \| null` | Linked project id |
| `direction` | `"incoming"` \| `"outgoing"` | Flow direction for ledger type/amount rendering |
| `status` | `string` | Canonical status label (for badge styling) |
| `category` | `string` | Ledger category |
| `description` | `string` | Detailed ledger description |
| `notes` | `string` | Steward notes |
| `proofUrl` | `string \| null` | Optional external proof URL |
| `sortTime` | `number` | Millisecond sort key (0 for missing/invalid timestamps) |
| `sortIndex` | `number` | Original source index tie-breaker |

### Mapping rules

- Known contract events are mapped to canonical `type`/`category`/`direction`:
  - `ProjectRegistered`, `ProjectMetadataUpdated`, `ProjectStatusUpdated`,
    `ProjectStewardTransferred`
  - `ContributionReceived`, `PayoutAddressUpdated`, `Withdrawal`
  - `ProfileURIUpdated`
- Timestamp normalization accepts `timestamp`, `blockTimestamp`, or `date`.
  - Parseable values become `timestamp` (ISO) + `date` (`YYYY-MM-DD`).
  - Missing/invalid values are kept non-fatal (`date` fallback, `sortTime=0`) with warnings.
- Amount normalization accepts numeric/string values from `amount` or `args.amount`.
- Status normalization folds aliases (e.g. `success` → `confirmed`,
  `processing` → `pending`, `error` → `failed`).
- Rows are always sorted deterministically: newest first, then `id`, then source index.
- Duplicate ids are disambiguated by deterministic suffixes (`--2`, `--3`, …).
- Malformed records log `console.warn` and are skipped only when minimum identity
  (`type`/event name) is missing; ledger UI never throws due to bad records.

### Entry types

| Type | Used by KPI |
|---|---|
| `mission-complete` | **Active missions completed** counter |
| `Contribution` | Display in activity feed |
| `Boost` | Display in activity feed |
| `Milestone` | Display in activity feed |
| `Steward Update` | Display in activity feed |

---

## Stewardship KPI Definitions

KPIs are rendered by `scripts/kpi.js` into a `<ul id="kpi-panel">` element.
All calculations are deterministic from local data — no external calls are made.

> **Design principle**: these metrics help stewards decide *where to act next*,
> not measure engagement or attention.

### 1 · Active missions completed _(last 30 days)_

**Calculation**: Count of `activity.json` entries with `type === "mission-complete"` whose
`date` falls within the past 30 days.

**Why it matters**: Shows recent forward momentum from the stewardship collective.

---

### 2 · Median days since last action

**Calculation**: Take all projects with `status === "active"` or `"planning"` that have
**no `nextAction` field**.  Compute the number of days since each project's `lastUpdate`.
Return the median of that list.  Returns `—` when every active/planning project has a
`nextAction`.

**Why it matters**: A rising number indicates stewards haven't logged their next step.
Projects without a declared next action are more likely to stall.

---

### 3 · Projects with current update

**Calculation**: Count non-completed projects whose `publicUpdate` (or `lastUpdate`) is
within the past `FRESHNESS_WINDOW_DAYS` (default: 30 days).  Express as a percentage
of all non-completed projects.

**Why it matters**: Measures whether the community can see recent progress on active work.

---

### 4 · At-risk projects

**Calculation**: Count non-completed projects matching **either** of these heuristics:
- No update in `AT_RISK_STALE_DAYS` (default: 21) days, **or**
- Over 80 % of the funding goal is still unmet *and* less than $1,000 has been raised
  (very low early-stage runway).

**Why it matters**: Rule-based early warning for projects that may need immediate
steward attention.  This is not a failure signal — it is an action prompt.

---

## `GTPData` API Reference

```js
// Load all data files (idempotent — safe to call multiple times)
GTPData.load()                 // → Promise<{projects, associations, activity}>

// Raw accessors (copies of the internal arrays)
GTPData.getProjects()          // → normalised project[]
GTPData.getAssociations()      // → normalised association[]
GTPData.getActivity()          // → normalised activity[]
GTPData.normalizeActivityRow(raw, index)   // → canonical ledger row | null
GTPData.normalizeActivityRows(rows)        // → canonical ledger row[] (sorted)

// Lookup helpers
GTPData.getProjectById(id)     // → project | null
GTPData.getNeighborIds(id)     // → string[]  (directly connected project IDs)
GTPData.buildAdjacency()       // → { [id]: Set<id> }  (full adjacency map)

// Aggregate selectors
GTPData.getTotals(projects?)   // → { raised, goal }
GTPData.getStatusCounts(projects?)  // → { active, planning, completed, … }
GTPData.getFilterOptions()     // → { tracks, statuses, locations }
GTPData.filterProjects(state?) // → project[]  (applies shared filterState by default)

// Shared filter state
GTPData.filterState            // { track, status, search }
GTPData.setFilter(key, value)  // update one key and notify listeners
GTPData.onFilterChange(fn)     // subscribe; fn receives snapshot of filterState

// Constants
GTPData.FRESHNESS_WINDOW_DAYS  // 30
GTPData.AT_RISK_STALE_DAYS     // 21
```

---

## How to Add or Edit Project Records

1. Open `data/projects.json` in any text editor.
2. Each project is a JSON object in the top-level array.
3. Copy an existing entry as a template and change the values.
4. **Always assign a unique `id`** (e.g. `"proj-XXX"` where XXX continues the
   sequence).
5. If you want the project to appear in the constellation view, add at least one
   entry in `data/associations.json` linking it to an existing project.
6. Run validation in browser DevTools: open `index.html` and check the console
   for any `[GTPData]` warnings.

### Removing a project

1. Delete its entry from `data/projects.json`.
2. Remove any edges in `data/associations.json` that reference its `id`
   (otherwise the data layer will log warnings, but the app will continue).

### Adding activity entries

Append a new object to `data/activity.json`.  The minimum required fields are
`type` and `date`.  Use `"type": "mission-complete"` for entries that should
count towards the KPI.

---

## Running Locally

Open `index.html` directly in a browser **or** use a simple static server
(e.g. `npx serve .`) — the only requirement is that the `fetch()` calls can
resolve relative paths to the `data/` folder.  No build step is needed.
