# Decent Agency

Build agency, not attention.

If a feature increases engagement but decreases agency, don’t build it.
If a feature decreases engagement but increases agency, seriously consider building it.

## Vision

Decent Agency is a public, mission-centered platform for organizing real-world stewardship, collaboration, and community projects.

Most social systems optimize for attention. This project optimizes for human agency: helping people leave better equipped to improve their neighborhoods, watersheds, towns, and communities.

## Product Philosophy

- Communication supports action.
- Action is the product.
- Projects, missions, places, resources, skills, teams, and contributions are primary objects.
- Media exists in context of meaningful work.
- Reputation emerges from demonstrated contribution.

## Initial Scope (v0)

Start simple and durable with **vanilla HTML/CSS/JS**.

Phase 1:
- A clear landing page that communicates mission and principles.
- Lightweight navigation placeholders for future sections.
- No feed mechanics.

Phase 2:
- Public project and mission listings.
- Contribution records.
- Place-based discovery (map-first).

Phase 3:
- Verification and stewardship reputation.
- Purpose-driven digital asset experiments.

## v0.4 — Shared Data Layer & Stewardship KPIs

The `scripts/data-layer.js` module is a single shared data-access layer consumed
by all fund views.  It loads and normalises `data/projects.json`,
`data/associations.json`, and the optional `data/activity.json`, then exposes a
consistent API and a shared filter state used by both the dashboard and the
spiral constellation view.

A **Stewardship KPI Panel** (`scripts/kpi.js`) surfaces four agency-first health
metrics to help stewards decide where to act next — no engagement or
attention metrics included.

See [`docs/data-layer.md`](docs/data-layer.md) for the full schema reference,
KPI definitions, and a guide to adding or editing records.

## v0.41 — Prototype vs App Modes

The site now runs in two parallel modes behind a shared UI contract:

- **Prototype mode** (`/prototype/` or `?mode=prototype`) uses local JSON fixtures through `GTPMockDataAdapter`.
- **App mode** (`/app/` or `?mode=app`) uses `GTPAppDataAdapter` stubs for wallet/contract-backed flows.

### Default route behavior

- `index.html` defaults to **prototype mode** when no mode is supplied.
- Path routes (`/prototype/`, `/app/`) redirect to `index.html?mode=...` for static-host compatibility.

### Mode architecture

- `scripts/mode-router.js` resolves mode from path/query/default.
- `scripts/config.js` stores mode and network defaults.
- `scripts/data-adapter/interface.js` defines adapter requirements:
  - `getProjects()`
  - `getAssociations()`
  - `getMetrics()`
  - `getActivity()`
- `scripts/data-adapter/mock-adapter.js` powers deterministic offline prototype rendering.
- `scripts/data-adapter/app-adapter.js` returns safe placeholders until wallet/contract integrations are implemented.
- `scripts/app-state.js` scaffolds app wallet state (`disconnected`/`connecting`/`connected`), chain id, and profile presence, with guardrails to block writes outside ready app mode.

### Roadmap linkage

Wallet connection and contract read/write hooks are intentionally out of scope for this milestone and land in follow-up wallet/contracts issues.

## Core Principle Test

Before shipping any feature, ask:

1. Does this increase a person's ability to contribute meaningfully?
2. Does this improve local coordination and stewardship?
3. Does this reduce passive consumption?

If not, reconsider.

## Development

This repository intentionally favors minimal dependencies at the beginning.

To run locally, open `index.html` in a browser — or use any static file server
(e.g. `npx serve .`) so that `fetch()` can resolve the `data/` files.

(We can introduce a bundler/tooling later only when it clearly improves maintainability without compromising simplicity.)

