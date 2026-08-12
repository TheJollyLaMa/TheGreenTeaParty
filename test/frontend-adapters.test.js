import { expect } from 'chai';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const repoRoot = '/home/runner/work/TheGreenTeaParty/TheGreenTeaParty';

function readScript(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function createLocalStorage(initialValues = {}) {
  const store = new Map(Object.entries(initialValues));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };
}

function createDocumentStub() {
  return {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement() {
      return {
        className: '',
        textContent: '',
        parentNode: null
      };
    }
  };
}

function loadScriptIntoContext(context, relativePath) {
  vm.runInContext(readScript(relativePath), context, { filename: relativePath });
}

function createBaseContext(overrides = {}) {
  const window = {
    console,
    location: { hash: '', search: '', pathname: '/index.html' },
    localStorage: createLocalStorage(overrides.localStorage),
    ethereum: {},
    setTimeout,
    clearTimeout
  };

  const context = vm.createContext({
    console,
    window,
    document: createDocumentStub(),
    fetch: overrides.fetch || (() => Promise.reject(new Error('Unexpected fetch'))),
    setTimeout,
    clearTimeout
  });

  context.window.window = context.window;
  context.window.document = context.document;
  context.window.fetch = context.fetch;
  context.window.ethers = overrides.ethers || ethers;
  context.ethers = context.window.ethers;

  context.GTPModeRouter = overrides.GTPModeRouter || {
    getModeInfo() {
      return { mode: 'app', isApp: true };
    }
  };
  context.window.GTPModeRouter = context.GTPModeRouter;

  context.GTPAppState = overrides.GTPAppState || {
    getSessionIdentity() {
      return {
        address: '0x00000000000000000000000000000000000000AA',
        chainId: 10,
        connectionStatus: 'connected',
        isSupportedNetwork: true
      };
    },
    getReadiness() {
      return { ready: true, reason: '' };
    },
    assertCanWrite() {},
    subscribe() {},
    setState() {}
  };
  context.window.GTPAppState = context.GTPAppState;

  loadScriptIntoContext(context, 'scripts/config.js');
  context.GTPConfig = context.window.GTPConfig;
  context.window.GTPConfig = context.GTPConfig;
  return context;
}

describe('frontend adapter regressions', function () {
  it('registerProject waits for confirmation, reads back, and persists canonical GreenTeaHut_01 id', async function () {
    const canonicalProjectId = 'GreenTeaHut_01';
    const canonicalProjectIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(canonicalProjectId));
    const signerAddress = '0x00000000000000000000000000000000000000BB';
    let waitedForConfirmations = 0;
    let registerArgs = null;

    class MockBrowserProvider {
      async getSigner() {
        return {
          async getAddress() {
            return signerAddress;
          }
        };
      }
    }

    class MockContract {
      constructor(address) {
        this.address = address;
      }

      async registerProject(projectId, steward, metadataURI) {
        registerArgs = { projectId, steward, metadataURI };
        return {
          hash: '0xdeadbeef',
          async wait(confirmations) {
            waitedForConfirmations = confirmations;
            return { status: 1 };
          }
        };
      }

      async getProject(projectId) {
        expect(projectId).to.equal(canonicalProjectIdBytes32);
        return {
          steward: registerArgs.steward,
          metadataURI: registerArgs.metadataURI,
          status: 0n
        };
      }
    }

    const mockEthers = {
      ...ethers,
      BrowserProvider: MockBrowserProvider,
      JsonRpcProvider: class {},
      Contract: MockContract
    };

    const context = createBaseContext({ ethers: mockEthers });
    loadScriptIntoContext(context, 'scripts/contract-adapter.js');

    const result = await context.window.GTPContractAdapter
      .create({ chainId: 10 })
      .registerProject('green-tea-hut-01', '0x00000000000000000000000000000000000000CC', '{"id":"GreenTeaHut_01"}');

    expect(result.ok).to.equal(true);
    expect(result.projectId).to.equal(canonicalProjectId);
    expect(result.projectIdBytes32).to.equal(canonicalProjectIdBytes32);
    expect(result.readback.metadataURI).to.equal('{"id":"GreenTeaHut_01"}');
    expect(result.diagnostics.chainId).to.equal(10);
    expect(result.diagnostics.contractAddress).to.equal(context.window.GTPConfig.contracts[10].projectRegistry);
    expect(result.diagnostics.signerAddress).to.equal(signerAddress);
    expect(result.diagnostics.txHash).to.equal('0xdeadbeef');
    expect(waitedForConfirmations).to.equal(1);
    expect(registerArgs.projectId).to.equal(canonicalProjectIdBytes32);

    const remembered = JSON.parse(context.window.localStorage.getItem('gtp.registeredProjectIds'));
    expect(remembered).to.include(canonicalProjectId);
  });

  it('keeps the remembered association visible after reload via app adapter filtering', async function () {
    const hutId = 'GreenTeaHut_01';
    const partyId = 'green-tea-party';
    const hutBytes32 = ethers.keccak256(ethers.toUtf8Bytes(hutId));
    const partyBytes32 = ethers.keccak256(ethers.toUtf8Bytes(partyId));

    class MockJsonRpcProvider {}

    class MockContract {
      constructor() {
        this.filters = {
          ProjectRegistered(projectId) {
            return { projectId };
          }
        };
      }

      async queryFilter(filter) {
        if (filter && filter.projectId) return [];
        return [{ args: { projectId: partyBytes32 } }];
      }

      async getProject(projectId) {
        if (projectId === hutBytes32) {
          return {
            steward: '0x0000000000000000000000000000000000000001',
            metadataURI: JSON.stringify({ id: hutId, name: 'Green Tea Hut #1', track: 'Green Tea', goal: 12000, raised: 0 }),
            status: 0n
          };
        }
        if (projectId === partyBytes32) {
          return {
            steward: '0x0000000000000000000000000000000000000002',
            metadataURI: JSON.stringify({ id: partyId, name: 'Green Tea Party', track: 'Green Tea', goal: 25000, raised: 5000 }),
            status: 1n
          };
        }
        throw new Error('Unknown project');
      }
    }

    const mockEthers = {
      ...ethers,
      JsonRpcProvider: MockJsonRpcProvider,
      BrowserProvider: class {},
      Contract: MockContract
    };

    const fetch = async (url) => {
      if (url.endsWith('data/projects.json')) {
        return { ok: true, async json() { return []; } };
      }
      if (url.endsWith('data/associations.json')) {
        return {
          ok: true,
          async json() {
            return [{
              source: partyId,
              target: hutId,
              type: 'shared-equipment',
              direction: 'source-to-target',
              resource: 'cement mixer'
            }];
          }
        };
      }
      if (url.endsWith('data/activity.json')) {
        return { ok: true, async json() { return []; } };
      }
      throw new Error('Unexpected fetch ' + url);
    };

    const context = createBaseContext({
      ethers: mockEthers,
      fetch,
      localStorage: {
        'gtp.registeredProjectIds': JSON.stringify([hutId])
      }
    });
    loadScriptIntoContext(context, 'scripts/contract-adapter.js');
    loadScriptIntoContext(context, 'scripts/data-adapter/app-adapter.js');

    const adapter = context.window.GTPAppDataAdapter.create({
      basePath: '',
      appState: context.window.GTPAppState
    });
    const associations = await adapter.getAssociations();

    expect(associations).to.deep.equal([{
      source: partyId,
      target: hutId,
      type: 'shared-equipment',
      direction: 'source-to-target',
      resource: 'cement mixer'
    }]);
  });

  it('parses configured admin contract functions into read/write diagnostics', async function () {
    const context = createBaseContext();
    loadScriptIntoContext(context, 'scripts/contract-adapter.js');
    loadScriptIntoContext(context, 'scripts/admin-panel.js');

    ['projectRegistry', 'treasury', 'profileRegistry'].forEach((contractKey) => {
      const abi = context.window.GTPContractAdapter.getContractDefinition(contractKey, 10).abi;
      const diagnostics = context.window.GTPAdminPanel.getAdminContractDiagnostics(contractKey, abi);
      expect(diagnostics.parseError).to.equal('');
      expect(diagnostics.functionsParsedCount).to.be.greaterThan(0);
      expect(diagnostics.contractInitialized).to.equal(true);
      expect(diagnostics.chainId).to.equal(10);
      expect(diagnostics.contractAddress).to.be.a('string');
    });
  });

  it('returns a non-empty diagnostic reason when admin ABI parsing cannot initialize', async function () {
    const context = createBaseContext();
    loadScriptIntoContext(context, 'scripts/contract-adapter.js');
    loadScriptIntoContext(context, 'scripts/admin-panel.js');

    const diagnostics = context.window.GTPAdminPanel.getAdminContractDiagnostics('projectRegistry', null);
    expect(diagnostics.parseError).to.equal('ABI is not an array.');
  });

  it('surfaces the Optimism Mainnet wrong-network guidance', async function () {
    const context = createBaseContext({
      GTPAppState: {
        getSessionIdentity() {
          return {
            address: '0x00000000000000000000000000000000000000AA',
            chainId: 1,
            connectionStatus: 'connected',
            isSupportedNetwork: false
          };
        },
        subscribe() {},
        setState() {}
      }
    });
    loadScriptIntoContext(context, 'scripts/app-state.js');

    context.window.GTPAppState.setState({
      chainId: 1,
      connectionStatus: 'connected',
      isSupportedNetwork: false
    });

    expect(context.window.GTPAppState.getReadiness().reason).to.equal(
      'Connected network is unsupported. Switch to Optimism Mainnet to continue.'
    );
  });
});
