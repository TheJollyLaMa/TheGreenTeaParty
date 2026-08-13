import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadAppAdapterSandbox() {
  const source = await readFile(path.join(__dirname, '..', 'scripts', 'data-adapter', 'app-adapter.js'), 'utf8');
  let registryStub = null;

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
    fetch: async function () {
      throw new Error('Unexpected fetch call in app-adapter test');
    },
    GTPConfig: {
      networks: {
        10: { rpcUrl: 'http://localhost:8545' }
      },
      contracts: {
        10: { projectRegistry: '0x0000000000000000000000000000000000000001', fromBlock: 0 }
      }
    },
    GTPContractAdapter: {
      PROJECT_REGISTRY_ABI: [],
      create: function () {
        return {
          getContractState: async function () { return { ready: true }; },
          getProjectRecord: async function () { return null; },
          getProjectBalance: async function () { return 0; },
          getProfilePointer: async function () { return ''; },
          registerProject: async function () {},
          updateProjectMetadataURI: async function () {},
          updateProjectStatus: async function () {},
          transferProjectSteward: async function () {},
          setProfilePointer: async function () {},
          contribute: async function () {},
          setPayoutAddress: async function () {},
          withdraw: async function () {}
        };
      }
    }
  };

  sandbox.window.ethers = {
    JsonRpcProvider: class {
      constructor() {}
      getBlockNumber() {
        return Promise.resolve(123);
      }
    },
    Contract: class {
      constructor() {
        return registryStub;
      }
    }
  };

  vm.runInNewContext(source, sandbox, { filename: 'app-adapter.js' });

  return {
    adapter: sandbox.window.GTPAppDataAdapter,
    setRegistryStub(stub) {
      registryStub = stub;
    }
  };
}

describe('GTPAppDataAdapter', function () {
  it('fills safe defaults for registry-backed inline metadata', async function () {
    const sandbox = await loadAppAdapterSandbox();
    sandbox.setRegistryStub({
      filters: {
        ProjectRegistered: function () {
          return {};
        }
      },
      queryFilter: async function () {
        return [
          {
            args: { projectId: '0xproject1' }
          }
        ];
      },
      getProject: async function () {
        return {
          steward: '0x0000000000000000000000000000000000000002',
          metadataURI: '{"id":"green-tea-hut-01","name":"The Green Tea Hut #1","track":"Green Tea","goal":"12000"}',
          status: 0n
        };
      }
    });

    const projects = await sandbox.adapter.create({}).getProjects();

    expect(projects).to.have.lengthOf(1);
    expect(projects[0]).to.include({
      id: 'green-tea-hut-01',
      name: 'The Green Tea Hut #1',
      track: 'Green Tea',
      status: 'draft',
      raised: 0,
      goal: 12000
    });
  });
});
