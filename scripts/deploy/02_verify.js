// Verify already-deployed contracts on Optimistic Etherscan.
// Reads config/deployed-addresses.json written by the deploy script.
//
// Usage:
//   npx hardhat run scripts/deploy/02_verify.js --network optimism

import { run } from 'hardhat';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const addressFile = path.join(__dirname, '../../config/deployed-addresses.json');
  if (!fs.existsSync(addressFile)) {
    throw new Error('deployed-addresses.json not found. Run the deploy script first.');
  }

  const data = JSON.parse(fs.readFileSync(addressFile, 'utf8'));
  const { contracts, owner: initialOwner } = data;

  console.log('Verifying on chain', data.chainId, '/', data.network);
  console.log('Addresses:', JSON.stringify(contracts, null, 2));

  // ProjectRegistry
  console.log('\n[1/3] Verifying ProjectRegistry…');
  await run('verify:verify', {
    address: contracts.projectRegistry,
    constructorArguments: [initialOwner]
  });

  // ProfileRegistry (no constructor args)
  console.log('\n[2/3] Verifying ProfileRegistry…');
  await run('verify:verify', {
    address: contracts.profileRegistry,
    constructorArguments: []
  });

  // TheGreenTeaPartyTreasury
  console.log('\n[3/3] Verifying TheGreenTeaPartyTreasury…');
  await run('verify:verify', {
    address: contracts.treasury,
    constructorArguments: [contracts.projectRegistry, initialOwner]
  });

  console.log('\nVerification complete.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
