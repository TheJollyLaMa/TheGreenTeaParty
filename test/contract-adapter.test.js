import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadContractAdapterSandbox() {
  const source = await readFile(path.join(__dirname, '..', 'scripts', 'contract-adapter.js'), 'utf8');
  let capturedAddress = null;

  const sandbox = {
    window: {},
    console,
    Promise,
    Object,
    Number,
    String,
    Array,
    JSON,
    Math,
    Date,
    RegExp,
    Error,
    Set,
    Map,
    WeakMap,
    WeakSet,
    Symbol,
    BigInt,
    parseInt,
    parseFloat,
    isFinite,
    GTPConfig: {
      app: {
        defaultChainId: 10,
        supportedChainIds: [10]
      },
      networks: {
        10: { rpcUrl: 'https://example.invalid', blockExplorer: 'https://optimistic.etherscan.io' }
      },
      contracts: {
        10: {
          projectRegistry: '0x0000000000000000000000000000000000000001',
          treasury: '0x0000000000000000000000000000000000000002',
          profileRegistry: '0x0000000000000000000000000000000000000003'
        }
      }
    },
    GTPAppState: {
      getSessionIdentity() {
        return { chainId: null };
      },
      getReadiness() {
        return { ready: false, reason: 'Connect wallet to load app data.' };
      },
      assertCanWrite() {}
    }
  };

  sandbox.window.ethers = {
    JsonRpcProvider: class {
      constructor(url, chainId) {
        this.url = url;
        this.chainId = chainId;
      }

      getNetwork() {
        return Promise.resolve({ chainId: this.chainId });
      }
    },
    Contract: class {
      constructor(address) {
        capturedAddress = address;
        return {
          getProject: async function () {
            return {
              steward: '0x0000000000000000000000000000000000000004',
              metadataURI: '{"name":"Demo","track":"Green Tea","goal":1000}',
              status: 1n
            };
          }
        };
      }
    },
    keccak256: function (value) {
      return value;
    },
    toUtf8Bytes: function (value) {
      return value;
    },
    formatEther: function () {
      return '0';
    }
  };

  vm.runInNewContext(source, sandbox, { filename: 'contract-adapter.js' });

  return {
    adapter: sandbox.window.GTPContractAdapter.create({}),
    getCapturedAddress() {
      return capturedAddress;
    }
  };
}

describe('GTPContractAdapter', function () {
  it('defaults read contract resolution to Optimism when no wallet network is selected', async function () {
    const sandbox = await loadContractAdapterSandbox();
    const state = await sandbox.adapter.getContractState();
    expect(state.chainId).to.equal(10);
    expect(state.ready).to.equal(true);
    expect(state.reason).to.equal('');
  });

  it('reads registry projects from the default chain address', async function () {
    const sandbox = await loadContractAdapterSandbox();
    const record = await sandbox.adapter.getProjectRecord('green-tea-hut-001');
    expect(sandbox.getCapturedAddress()).to.equal('0x0000000000000000000000000000000000000001');
    expect(record.ok).to.equal(true);
    expect(record.projectId).to.equal('green-tea-hut-001');
    expect(record.status).to.equal(1);
  });

  it('exposes the updated treasury write and event surface', async function () {
    const sandbox = await loadContractAdapterSandbox();
    const treasuryAbi = sandbox.window.GTPContractAdapter.TREASURY_ABI.join('\n');

    expect(treasuryAbi).to.include('function sweepUnassignedETH(address payable recipient, uint256 amount)');
    expect(treasuryAbi).to.include('function sweepERC20(address token, address recipient, uint256 amount)');
    expect(treasuryAbi).to.include('event DirectDepositReceived(address indexed sender, uint256 amount)');
    expect(treasuryAbi).to.include('event UnassignedETHSwept(address indexed recipient, uint256 amount)');
    expect(treasuryAbi).to.include('event ERC20TokensSwept(address indexed token, address indexed recipient, uint256 amount)');
  });
});
