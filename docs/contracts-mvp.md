# Contracts MVP — TheGreenTeaPartyProjectRegistry, TheGreenTeaPartyTreasury, TheGreenTeaPartyProfileRegistry

## Scope

This MVP adds three intentionally small Solidity contracts for app mode:

- `contracts/TheGreenTeaPartyProjectRegistry.sol`
- `contracts/TheGreenTeaPartyTreasury.sol`
- `contracts/TheGreenTeaPartyProfileRegistry.sol`

The goal is one safe, easy-to-reason-about onchain backbone for Green Tea Party before broader multi-project expansion.

## Storage model

### `TheGreenTeaPartyProjectRegistry`

- `mapping(bytes32 => Project)` keyed by deterministic `projectId`
- `Project` stores:
  - `steward`
  - `metadataURI`
  - `status` (`Draft`, `Active`, `Paused`, `Completed`)
  - `exists`
- contract-wide `owner` for initial registration / emergency pause

### `TheGreenTeaPartyProfileRegistry`

- `mapping(address => string)` from wallet address to profile metadata URI
- each caller owns and updates only their own pointer

### `TheGreenTeaPartyTreasury`

- immutable `registry` reference for project existence + steward checks
- `mapping(bytes32 => uint256) projectBalances`
- `mapping(bytes32 => address) payoutAddresses`
- contract-wide `owner` for pause control

## Event model

### Registry events

- `ProjectRegistered`
- `ProjectMetadataUpdated`
- `ProjectStatusUpdated`
- `ProjectStewardTransferred`

### Profile events

- `ProfileURIUpdated`

### TheGreenTeaPartyTreasury events

- `ContributionReceived`
- `PayoutAddressUpdated`
- `Withdrawal`

Pause/unpause and ownership transfer events are also emitted for operational visibility.

## Trust and safety assumptions

- Registry `owner` is trusted to create initial projects and trigger emergency pause.
- A project `steward` is trusted to maintain metadata/status and control payouts for that project.
- TheGreenTeaPartyTreasury only accepts contributions for existing projects in `Active` status.
- Withdrawals are limited to the steward or a steward-configured payout address.
- TheGreenTeaPartyTreasury uses a simple reentrancy lock and checks-effects-interactions ordering.
- Registry status transitions are intentionally narrow:
  - `Draft -> Active | Paused`
  - `Active -> Paused | Completed`
  - `Paused -> Active | Completed`
  - `Completed` is terminal

## Upgrade strategy

No proxy or upgrade framework is introduced in this MVP.

This keeps the surface area small and easier to review. Future upgrades should prefer:

1. deploying a new contract version,
2. migrating project state explicitly,
3. updating front-end contract addresses in config,
4. avoiding implicit storage-coupled upgrade assumptions.

## Front-end adapter stubs

App mode now includes `scripts/contract-adapter.js`, which defines:

- human-readable ABI fragments for all three contracts,
- chain-aware address config lookup via `GTPConfig.contracts`,
- placeholder read wrappers for:
  - project record lookup
  - project balance lookup
  - profile pointer lookup
- placeholder write wrappers for:
  - project registration
  - metadata/status/steward updates
  - profile updates
  - treasury contributions
  - payout address updates
  - withdrawals

`scripts/data-adapter/app-adapter.js` forwards those app-mode contract calls while still returning safe placeholder data until deployment addresses and a real client library are wired in.

## Local dev / compile notes

No Solidity toolchain was added in this issue because the repository currently has no package manager, build system, or contract test framework.

For now:

- front-end files remain runnable as a static site,
- contract sources are scaffolded for later integration,
- ABI usage is documented in plain JavaScript stubs.

When a contract toolchain is introduced later, recommended first checks are:

1. compile all three contracts,
2. add focused tests for invalid status transitions, unauthorized updates, zero-value contributions, and withdrawal authorization,
3. wire deployed addresses into `GTPConfig.contracts`.
