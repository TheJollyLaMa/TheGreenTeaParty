// Deploy script: TheGreenTeaPartyProjectRegistry → TheGreenTeaPartyProfileRegistry → TheGreenTeaPartyTreasury
// Usage: npx hardhat run scripts/deploy/01_deploy_all.js --network optimism
//
// Required env vars (see .env.example):
//   DEPLOYER_PRIVATE_KEY
//   OP_MAINNET_RPC_URL
//   OPTIMISTIC_ETHERSCAN_API_KEY
//   INITIAL_OWNER

import { ethers } from 'hardhat';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const [deployer] = await ethers.getSigners();

  const initialOwner = process.env.INITIAL_OWNER || deployer.address;

  console.log('Deployer  :', deployer.address);
  console.log('Owner     :', initialOwner);
  console.log('Network   :', (await ethers.provider.getNetwork()).name);

  // ── 1. TheGreenTeaPartyProjectRegistry ──────────────────────────────────────────────────
  console.log('\n[1/3] Deploying TheGreenTeaPartyProjectRegistry…');
  const TheGreenTeaPartyProjectRegistry = await ethers.getContractFactory('TheGreenTeaPartyProjectRegistry');
  const registry = await TheGreenTeaPartyProjectRegistry.deploy(initialOwner);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log('TheGreenTeaPartyProjectRegistry :', registryAddress);

  // ── 2. TheGreenTeaPartyProfileRegistry ──────────────────────────────────────────────────
  console.log('\n[2/3] Deploying TheGreenTeaPartyProfileRegistry…');
  const TheGreenTeaPartyProfileRegistry = await ethers.getContractFactory('TheGreenTeaPartyProfileRegistry');
  const profile = await TheGreenTeaPartyProfileRegistry.deploy();
  await profile.waitForDeployment();
  const profileAddress = await profile.getAddress();
  console.log('TheGreenTeaPartyProfileRegistry :', profileAddress);

  // ── 3. TheGreenTeaPartyTreasury ─────────────────────────────────────────
  console.log('\n[3/3] Deploying TheGreenTeaPartyTreasury…');
  const TheGreenTeaPartyTreasury = await ethers.getContractFactory('TheGreenTeaPartyTreasury');
  const treasury = await TheGreenTeaPartyTreasury.deploy(registryAddress, initialOwner);
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log('TheGreenTeaPartyTreasury :', treasuryAddress);

  // ── Persist addresses ────────────────────────────────────────────────────
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  const addresses = {
    chainId,
    network: network.name,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    owner: initialOwner,
    contracts: {
      projectRegistry: registryAddress,
      profileRegistry: profileAddress,
      treasury: treasuryAddress
    }
  };

  const outPath = path.join(__dirname, '../../config/deployed-addresses.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log('\nAddresses written to', outPath);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n=== Deployment complete ===');
  console.log('TheGreenTeaPartyProjectRegistry :', registryAddress);
  console.log('TheGreenTeaPartyProfileRegistry :', profileAddress);
  console.log('TheGreenTeaPartyTreasury :', treasuryAddress);
  console.log('\nNext steps:');
  console.log('  npx hardhat verify --network optimism', registryAddress, `"${initialOwner}"`);
  console.log('  npx hardhat verify --network optimism', profileAddress);
  console.log('  npx hardhat verify --network optimism', treasuryAddress, `"${registryAddress}"`, `"${initialOwner}"`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
