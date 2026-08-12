# DEPLOYMENT.md — Green Tea Party Ledger Contracts

## Overview

This runbook documents the deployment, verification, and rollback procedures for
the Green Tea Party ledger contracts on Optimism Mainnet.

### Contracts

| Contract | Purpose |
|---|---|
| `ProjectRegistry` | Register projects, assign stewards, manage lifecycle status |
| `ProfileRegistry` | Store per-address IPFS profile URI pointers |
| `Treasury` | Hold ETH by project, route contributions and steward withdrawals |

---

## Prerequisites

1. **Node.js ≥ 18** and **npm ≥ 9**
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in all values:
   ```bash
   cp .env.example .env
   ```

### Required environment variables

| Variable | Description |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | 64-char hex private key of the deployer wallet (no `0x` prefix) |
| `OP_MAINNET_RPC_URL` | Optimism Mainnet RPC endpoint (Alchemy / Infura / public) |
| `OPTIMISTIC_ETHERSCAN_API_KEY` | API key from [optimistic.etherscan.io](https://optimistic.etherscan.io/apis) |
| `INITIAL_OWNER` | Wallet address that will own `ProjectRegistry` and `Treasury` (defaults to deployer) |

> **Never commit `.env` to source control.** It is listed in `.gitignore`.

---

## Deployment Steps

### 1. Compile contracts

```bash
npx hardhat compile
```

Artifacts land in `./artifacts/`. ABIs can be exported for the frontend with:

```bash
node scripts/deploy/03_export_abis.js
```

### 2. Run tests

```bash
npx hardhat test
```

All tests must pass before deploying.

### Remix manual deployment note

The contracts are packaged to compile cleanly as standalone files in Remix for
manual deployment. You do **not** deploy interfaces separately.

- Deploy `ProjectRegistry.sol` first with `initialOwner`
- Deploy `ProfileRegistry.sol`
- Deploy `Treasury.sol` with `registryAddress` set to the deployed
  `ProjectRegistry` address and `initialOwner`

If you upload files into Remix manually, `Treasury.sol` already embeds the small
registry interface it needs for cross-contract calls, so no extra interface file
deployment step is required.

### 3. Deploy to Optimism Mainnet

```bash
npx hardhat run scripts/deploy/01_deploy_all.js --network optimism
```

The script deploys in order:

1. `ProjectRegistry(initialOwner)`
2. `ProfileRegistry()` — no constructor args
3. `Treasury(registryAddress, initialOwner)`

On success it writes `config/deployed-addresses.json` with all addresses.

### 4. Verify on Optimistic Etherscan

**Option A — automated (requires `@nomicfoundation/hardhat-verify` plugin):**

```bash
npx hardhat verify --network optimism <ProjectRegistry address> "<INITIAL_OWNER>"
npx hardhat verify --network optimism <ProfileRegistry address>
npx hardhat verify --network optimism <Treasury address> "<ProjectRegistry address>" "<INITIAL_OWNER>"
```

**Option B — via script (reads `config/deployed-addresses.json` automatically):**

```bash
npx hardhat run scripts/deploy/02_verify.js --network optimism
```

### 5. Update frontend config

Edit `scripts/config.js` and replace the `PENDING` placeholders in the `chainId: 10` block
with the addresses from `config/deployed-addresses.json`.

```js
10: {
  projectRegistry: '0x…',
  treasury:         '0x…',
  profileRegistry:  '0x…'
}
```

Commit this change. GitHub Pages will serve the updated config automatically.

---

## Deployed Addresses (Optimism Mainnet)

> Update this section after each production deployment.

| Contract | Address | Etherscan |
|---|---|---|
| `ProjectRegistry` | PENDING | — |
| `ProfileRegistry` | PENDING | — |
| `Treasury` | PENDING | — |

See `config/deployed-addresses.json` for the machine-readable record.

---

## Post-Deployment Checklist

- [ ] All three contracts verified on [Optimistic Etherscan](https://optimistic.etherscan.io)
- [ ] `config/deployed-addresses.json` committed
- [ ] `scripts/config.js` updated with live addresses
- [ ] Frontend reads ledger data in app mode (chainId 10)
- [ ] Initial `ProjectRegistry` entries seeded for v0.57:
  - [ ] Seed funding pending entry
  - [ ] Equipment rental request (GreenTeaHut_01 → GreenTeaParty)
  - [ ] Labor payout entry

---

## Rollback Notes

The contracts use **no proxy or upgrade framework** (see `docs/contracts-mvp.md`).

To roll back:

1. **Pause** the affected contracts immediately:
   ```bash
   # Call pause() on Treasury and/or ProjectRegistry via the owner wallet
   ```

2. **Deploy new contract versions** with the corrected logic.

3. **Migrate project state** explicitly — re-register projects in the new registry
   using the same `projectId` bytes, then update `Treasury` with the new registry address.

4. **Update `scripts/config.js`** with the new contract addresses and redeploy
   the GitHub Pages site.

5. **Communicate** the migration to all active project stewards.

> Because project balances live in `Treasury`, migration of funds requires either
> steward withdrawals before migration or a separate transfer mechanism.
> Plan this carefully before deploying a replacement.

---

## Seeding v0.57 Initial State

After deployment, run these Hardhat tasks (or manual transactions) to seed initial data.

### 1. Register The Green Tea Party project

```js
const projectId = ethers.keccak256(ethers.toUtf8Bytes('green-tea-party'));
await registry.registerProject(projectId, stewardAddress, 'ipfs://<metadata-cid>');
await registry.updateProjectStatus(projectId, 1 /* Active */);
```

### 2. Equipment rental request (GreenTeaHut_01 → GreenTeaParty)

Record a `ContributionReceived` event by calling `contribute(projectId)` with the
rental amount in ETH, sent from the GreenTeaHut_01 wallet.

### 3. Labor payout entry

Call `setPayoutAddress(projectId, laborWallet)` then `withdraw(projectId, amount)`
from the steward wallet.

---

## Architecture Note

### What existed

Three Solidity contracts scaffolded in a prior issue: `ProjectRegistry`,
`ProfileRegistry`, and `Treasury`, plus their interfaces and frontend ABI stubs.
No toolchain, deploy scripts, or tests existed.

### What changed for v0.56

- Added Hardhat 3 toolchain (`hardhat.config.js`, `package.json` devDependencies)
- Added `scripts/deploy/01_deploy_all.js` — reproducible deploy script
- Added `scripts/deploy/02_verify.js` — Etherscan verification script
- Added `scripts/deploy/03_export_abis.js` — ABI JSON export for frontend
- Added `test/contracts.test.js` — unit tests for all three contracts
- Added `config/deployed-addresses.json` — machine-readable address record
- Added `config/abis/` — ABI JSON files for frontend consumption
- Updated `scripts/config.js` with Optimism Mainnet network config
- Updated `scripts/config.js` — defaultChainId changed to 10 (Optimism), supportedChainIds narrowed to `[10]`, added NETWORKS metadata block for Optimism Mainnet RPC/explorer URLs
- Added `.env.example` with all required environment variables

### Deployed vs. deferred

| Item | Status |
|---|---|
| `ProjectRegistry` | ✅ Deploy now |
| `ProfileRegistry` | ✅ Deploy now |
| `Treasury` | ✅ Deploy now |
| Governance token | ⏸ Deferred — out of scope for v0.56 |
| Multi-chain deployment | ⏸ Deferred — out of scope for v0.56 |
| Admin moderation dashboard | ⏸ Deferred — out of scope for v0.56 |
| Proxy/upgrade framework | ⏸ Deferred — deploy fresh + migrate per runbook |

---

## Follow-up Issues (Deferred Hardening)

- **Install `@nomicfoundation/hardhat-verify`** for automated Etherscan verification
- **Add `hardhat-gas-reporter`** for gas profiling
- **Add coverage reporting** (`hardhat coverage`)
- **Add Solidity NatSpec** to all public functions
- **Add event-indexed field review** — consider indexing `amount` on `ContributionReceived`
- **Governance / multi-sig** — replace single `owner` with a Gnosis Safe for production
- **v0.57 seeding script** — automate initial project registrations
