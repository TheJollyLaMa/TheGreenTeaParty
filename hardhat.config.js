import hardhatEthers from '@nomicfoundation/hardhat-ethers';
import hardhatMocha from '@nomicfoundation/hardhat-mocha';
import dotenv from 'dotenv';
dotenv.config();

const _rawKey = process.env.DEPLOYER_PRIVATE_KEY;
// For non-test networks, require a real key at config load time so misconfigurations
// fail fast rather than silently deploying with an insecure placeholder key.
const _isTestNetwork = !_rawKey && (process.env.HARDHAT_NETWORK === 'hardhat' || !process.env.HARDHAT_NETWORK);
if (!_rawKey && !_isTestNetwork) {
  throw new Error('DEPLOYER_PRIVATE_KEY env var is required for non-test network deployments. See .env.example.');
}
const DEPLOYER_PRIVATE_KEY = _rawKey || ('0').repeat(64);
const OP_MAINNET_RPC_URL = process.env.OP_MAINNET_RPC_URL || 'https://mainnet.optimism.io';
const OPTIMISTIC_ETHERSCAN_API_KEY = process.env.OPTIMISTIC_ETHERSCAN_API_KEY || '';

export default {
  plugins: [hardhatEthers, hardhatMocha],
  solidity: {
    version: '0.8.36',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      type: 'edr-simulated'
    },
    localhost: {
      type: 'http',
      url: 'http://127.0.0.1:8545'
    },
    optimism: {
      type: 'http',
      url: OP_MAINNET_RPC_URL,
      chainId: 10,
      accounts: [DEPLOYER_PRIVATE_KEY]
    }
  },
  // Verification via Optimistic Etherscan is done manually with the verify script
  // (scripts/deploy/02_verify.js) or via: npx hardhat verify --network optimism <address>
  // Install @nomicfoundation/hardhat-verify for automated verification support.
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts'
  }
};
