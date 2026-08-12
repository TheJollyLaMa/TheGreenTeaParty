import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const artifactsDir = path.join(__dirname, '../../artifacts/contracts');
const outDir = path.join(__dirname, '../../config/abis');

const CONTRACTS = ['ProjectRegistry', 'ProfileRegistry', 'TheGreenTeaPartyTreasury'];

function main() {
  if (!fs.existsSync(artifactsDir)) {
    console.error('Artifacts not found. Run: npx hardhat compile');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });

  for (const name of CONTRACTS) {
    const src = path.join(artifactsDir, `${name}.sol`, `${name}.json`);
    if (!fs.existsSync(src)) {
      console.error(`Artifact missing: ${src}`);
      process.exitCode = 1;
      continue;
    }
    const artifact = JSON.parse(fs.readFileSync(src, 'utf8'));
    const dest = path.join(outDir, `${name}.json`);
    fs.writeFileSync(dest, JSON.stringify(artifact.abi, null, 2));
    console.log('Exported', dest);
  }

  console.log('ABI export complete.');
}

main();
