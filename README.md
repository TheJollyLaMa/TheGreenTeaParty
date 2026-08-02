# Green Tea Party

A grounded home for real-world stewardship — build agency, not attention.

> If a feature increases engagement but decreases agency, don't build it.
> If a feature decreases engagement but increases agency, seriously consider building it.

## Vision

**Green Tea Party** is a public, mission-centered platform for organizing real-world stewardship, collaboration, and community projects under the Green Tea Party fund.

Most social systems optimize for attention. Green Tea Party optimizes for human agency: helping people leave better equipped to improve their neighborhoods, watersheds, towns, and communities.

## Principles

- **Communication supports action.** Action is the product.
- **Projects, missions, places, resources, skills, teams, and contributions** are primary objects.
- **Media exists in context of meaningful work.** Not the other way around.
- **Reputation emerges from demonstrated contribution**, not follower counts.
- **Stewardship is measurable.** We surface health metrics that prompt action, not engagement.

## Roadmap

### Phase 1 — Foundation ✅
- Clear landing page communicating mission and principles.
- Lightweight navigation placeholders for future sections.
- No feed mechanics.

### Phase 2 — Stewardship Dashboard ✅ (v0.4)
- Public project and mission listings with filtering.
- Stewardship KPI panel surfacing health metrics.
- Place-based fund dashboard (prototype mode).
- Spiral constellation view for project relationships.

### Phase 3 — Identity & Contracts (upcoming)
- Wallet connection and session identity in app mode. → [#11 Wallet Connect + Session Identity](https://github.com/TheJollyLaMa/TheGreenTeaParty/issues/11)
- Smart contract backbone: Project Registry, Treasury, Profile pointers. → [#12 Starter Contracts MVP](https://github.com/TheJollyLaMa/TheGreenTeaParty/issues/12)
- Contribution records and stewardship reputation on-chain.

### Phase 4 — Verification & Scale (future)
- Purpose-driven digital asset experiments.
- Quadratic funding and governance primitives.
- Cross-project discovery and map-first place browsing.

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

The site runs in two parallel modes behind a shared UI contract:

| Mode | Route | Data source |
|---|---|---|
| **Prototype** | `/prototype/` or `?mode=prototype` | Local JSON fixtures via `GTPMockDataAdapter` |
| **App** | `/app/` or `?mode=app` | `GTPAppDataAdapter` stubs for wallet/contract-backed flows |

- `index.html` defaults to **prototype mode** when no mode is supplied.
- Path routes (`/prototype/`, `/app/`) redirect to `index.html?mode=...` for static-host compatibility.

### Mode architecture

- `scripts/mode-router.js` resolves mode from path/query/default.
- `scripts/config.js` stores mode and network defaults.
- `scripts/data-adapter/interface.js` defines adapter requirements:
  - `getProjects()` · `getAssociations()` · `getMetrics()` · `getActivity()`
- `scripts/data-adapter/mock-adapter.js` powers deterministic offline prototype rendering.
- `scripts/data-adapter/app-adapter.js` returns safe placeholders until wallet/contract integrations land.
- `scripts/app-state.js` scaffolds app wallet state (`disconnected`/`connecting`/`connected`), chain id, and profile presence, with guardrails to block writes outside ready app mode.

Wallet connection and contract read/write hooks land in [#11](https://github.com/TheJollyLaMa/TheGreenTeaParty/issues/11) and [#12](https://github.com/TheJollyLaMa/TheGreenTeaParty/issues/12).

## Core Principle Test

Before shipping any feature, ask:

1. Does this increase a person's ability to contribute meaningfully?
2. Does this improve local coordination and stewardship?
3. Does this reduce passive consumption?

If not, reconsider.

## Open Issues & Milestones

| Issue | Title | Status |
|---|---|---|
| [#11](https://github.com/TheJollyLaMa/TheGreenTeaParty/issues/11) | v0.42 Wallet Connect + Session Identity (App Mode) | Open |
| [#12](https://github.com/TheJollyLaMa/TheGreenTeaParty/issues/12) | v0.43 Starter Contracts MVP: Project Registry + Treasury + Profile Pointers | Open |

## Asset Map

All public image/icon assets live under `assets/`:

| File | Used by | Purpose |
|---|---|---|
| `assets/favicon.png` | all pages (`index.html`, `app/`, `prototype/`, `views/spiral.html`) | Browser tab icon |
| `assets/GreenTeaParty_underground.jpeg` | `styles.css` (`.site-header` background) | Hero background image |

## Development

This repository intentionally favors minimal dependencies.

**Run locally:**

```sh
# Option 1 — open directly in a browser (some fetch() calls may not work)
open index.html

# Option 2 — use a simple static server (recommended)
npx serve .
```

Then visit `http://localhost:3000` (or the port shown by `serve`).

Prototype mode works fully offline with local JSON fixtures.
App mode requires a wallet provider (e.g. MetaMask) once wallet integration lands.

(A bundler or tooling will be introduced only when it clearly improves maintainability without compromising simplicity.)

