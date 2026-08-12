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

### Phase 2 — Stewardship Dashboard ✅ (v0.58)
- Root route opens directly into the Green Tea Party fractal view.
- Public Ledger lives directly below the fractal in the same page flow.
- Stewardship KPI panel and project pages remain available on the unified route.
- Spiral constellation view remains available as a standalone experimental page.

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

## v0.58 — Unified Fractal + Ledger Route

The canonical Green Tea Party experience now lives on the root route:

| Route | Purpose | Data source |
|---|---|---|
| **`/`** | Unified fractal-first route with inline Public Ledger | `GTPAppDataAdapter` using wallet-aware, fixture-backed fund snapshots until live contract reads are wired |
| **`/app/`** | Redirects to the canonical root route | Redirect |
| **`/prototype/`** | Redirects to the canonical root route | Redirect |
| **`/views/spiral.html`** | Standalone experimental constellation page (secondary, non-canonical) | Local JSON fixtures via `GTPMockDataAdapter` |

- `index.html` now defaults to the unified app path.
- The Green Tea Party fractal is the first screen and the Public Ledger sits directly below on scroll.
- `assets/Yantra_01C_compressed.mp4` stays fixed behind the page with reduced-motion fallback.
- `/app/` and `/prototype/` are retained only as compatibility redirects.
- Redirect routes and the standalone spiral page are marked non-canonical so the root route remains the only primary entry path.

### Mode architecture

- `scripts/mode-router.js` resolves mode from path/query/default.
- `scripts/config.js` stores mode and network defaults.
- `scripts/data-adapter/interface.js` defines adapter requirements:
  - `getProjects()` · `getAssociations()` · `getMetrics()` · `getActivity()`
- `scripts/data-adapter/mock-adapter.js` powers deterministic offline prototype rendering.
- `scripts/data-adapter/app-adapter.js` merges canonical JSON ingest with live contract reads so seeded ledger rows and remembered project registrations stay visible while onchain state catches up.
- `scripts/app-state.js` scaffolds app wallet state (`disconnected`/`connecting`/`connected`), chain id, and profile presence, with guardrails to block writes outside ready app mode.

Wallet connection and contract read/write hooks land in [#11](https://github.com/TheJollyLaMa/TheGreenTeaParty/issues/11) and [#12](https://github.com/TheJollyLaMa/TheGreenTeaParty/issues/12).

## v0.42 — Wallet Connect + Session Identity (App mode)

App mode now includes a client-side wallet/session identity layer for entering the
real product path without backend auth.

### Wallet assumptions

- Browser-injected EVM wallet provider (`window.ethereum`) is expected.
- MetaMask is the primary supported wallet UX (icon CTA uses `assets/metamask.png`).
- Prototype mode never requests wallet access.

### Supported network config

- Supported chain IDs are configured in `scripts/config.js`.
- Current defaults: `1` (Ethereum), `10` (Optimism), `8453` (Base).
- App write-intent guardrails remain blocked when wallet is disconnected or on an unsupported chain.

### Troubleshooting

- **No connect prompt appears:** ensure you are on the root route and a wallet extension is installed.
- **Unsupported network warning:** switch wallet network to one of the configured supported chain IDs.
- **Rejected connection:** reconnect and approve the wallet permission prompt.
- **Wrong account shown:** switch account in wallet; account/chain changes are observed live without reload.

## v0.43 — Starter Contracts MVP scaffolding

App mode now includes a minimal contract scaffold for the planned onchain path:

- `contracts/TheGreenTeaPartyProjectRegistry.sol`
- `contracts/TheGreenTeaPartyTreasury.sol`
- `contracts/TheGreenTeaPartyProfileRegistry.sol`
- `scripts/contract-adapter.js`

### Optimism deployed contract addresses

- `TheGreenTeaPartyProjectRegistry`: `0x1b093804d9BF8572F9ea58e24E051580Ed608F64`
- `TheGreenTeaPartyProfileRegistry`: `0xd66AdB0E70303D4e6daf8C963c7947f9ae722446`
- `TheGreenTeaPartyTreasury`: `0xebE0D6Fa315CeA75D491219d5D9CC13136580144`

### Current contract adapter behavior

- `scripts/contract-adapter.js` defines human-readable ABI fragments and safe placeholder read/write wrappers for registry, treasury, and profile operations.
- `scripts/data-adapter/app-adapter.js` forwards those wrappers without changing prototype mode behavior.
- `scripts/config.js` now reserves per-chain contract address slots for Ethereum (`1`), Optimism (`10`), and Base (`8453`).

No deployment or Solidity toolchain is added in this issue; the repo remains a minimal static site while the contract surface is documented and ready for later wiring.

See [`docs/contracts-mvp.md`](docs/contracts-mvp.md) for architecture notes, trust assumptions, and the MVP storage/event model.

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
