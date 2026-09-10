import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadAppAdapterSandbox(options = {}) {
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
    fetch: options.fetch || (async function () {
      throw new Error('Unexpected fetch call in app-adapter test');
    }),
    keccak256: function (value) {
      return 'hash:' + value;
    },
    toUtf8Bytes: function (value) {
      return value;
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
    },
    keccak256: function (value) {
      return 'hash:' + value;
    },
    toUtf8Bytes: function (value) {
      return value;
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

  it('uses the registration event payload when it is complete', async function () {
    const sandbox = await loadAppAdapterSandbox();
    let getProjectCalled = false;

    sandbox.setRegistryStub({
      filters: {
        ProjectRegistered: function () {
          return {};
        }
      },
      queryFilter: async function () {
        return [
          {
            args: {
              projectId: '0xproject1',
              steward: '0x0000000000000000000000000000000000000002',
              metadataURI: '{"id":"green-tea-hut-01","name":"The Green Tea Hut #1","track":"Green Tea","goal":"12000"}',
              status: 1
            }
          }
        ];
      },
      getProject: async function () {
        getProjectCalled = true;
        return {
          steward: '0x0000000000000000000000000000000000000002',
          metadataURI: '{"id":"green-tea-hut-01","name":"The Green Tea Hut #1","track":"Green Tea","goal":"12000"}',
          status: 1n
        };
      }
    });

    const projects = await sandbox.adapter.create({}).getProjects();

    expect(getProjectCalled).to.equal(false);
    expect(projects).to.have.lengthOf(1);
    expect(projects[0]).to.include({
      id: 'green-tea-hut-01',
      name: 'The Green Tea Hut #1',
      track: 'Green Tea',
      status: 'active',
      raised: 0,
      goal: 12000
    });
  });

  it('normalizes registry metadata aliases and stringified JSON payloads', async function () {
    const sandbox = await loadAppAdapterSandbox();
    const metadata = {
      id: 'green-tea-hut-001',
      title: 'The Green Tea Hut #1',
      category: 'Green Tea',
      fundingGoalUsd: '12000',
      raisedUsd: '4500',
      summary: 'A community tea house',
      website: 'https://example.com/green-tea-hut-1',
      steward: '0x0000000000000000000000000000000000000002'
    };

    sandbox.setRegistryStub({
      filters: {
        ProjectRegistered: function () {
          return {};
        }
      },
      queryFilter: async function () {
        return [
          {
            args: {
              projectId: '0xproject1',
              steward: '0x0000000000000000000000000000000000000002',
              metadataURI: JSON.stringify(JSON.stringify(metadata)),
              status: 1
            }
          }
        ];
      },
      getProject: async function () {
        throw new Error('getProject should not be called when event payload is complete');
      }
    });

    const projects = await sandbox.adapter.create({}).getProjects();

    expect(projects).to.have.lengthOf(1);
    expect(projects[0]).to.include({
      id: 'green-tea-hut-001',
      name: 'The Green Tea Hut #1',
      track: 'Green Tea',
      status: 'active',
      raised: 4500,
      goal: 12000,
      description: 'A community tea house',
      githubPagesUrl: 'https://example.com/green-tea-hut-1'
    });
  });

  it('accepts metadata fetched as raw JSON text', async function () {
    const sandbox = await loadAppAdapterSandbox({
      fetch: async function () {
        return {
          ok: true,
          text: async function () {
            return '{"id":"green-tea-hut-001","name":"The Green Tea Hut #1","track":"Green Tea","fundingGoalUsd":12000,"raised":500}';
          }
        };
      }
    });

    sandbox.setRegistryStub({
      filters: {
        ProjectRegistered: function () {
          return {};
        }
      },
      queryFilter: async function () {
        return [
          {
            args: {
              projectId: '0xproject1',
              steward: '0x0000000000000000000000000000000000000002',
              metadataURI: 'https://example.com/metadata.json',
              status: 1
            }
          }
        ];
      },
      getProject: async function () {
        throw new Error('getProject should not be called when event payload is complete');
      }
    });

    const projects = await sandbox.adapter.create({}).getProjects();

    expect(projects).to.have.lengthOf(1);
    expect(projects[0]).to.include({
      id: 'green-tea-hut-001',
      name: 'The Green Tea Hut #1',
      track: 'Green Tea',
      status: 'active',
      raised: 500,
      goal: 12000
    });
  });

  it('retries the registry scan from genesis when the configured start block misses the project', async function () {
    const sandbox = await loadAppAdapterSandbox();
    const queryCalls = [];

    sandbox.setRegistryStub({
      filters: {
        ProjectRegistered: function () {
          return {};
        }
      },
      queryFilter: async function (filter, fromBlock, toBlock) {
        queryCalls.push({ fromBlock, toBlock });
        if (fromBlock === 0) {
          return [
            {
              args: { projectId: '0xproject1' }
            }
          ];
        }
        return [];
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
    expect(queryCalls.some(({ fromBlock }) => fromBlock === 0)).to.equal(true);
  });

  it('probes candidate ids when registry logs are empty', async function () {
    const sandbox = await loadAppAdapterSandbox();
    const targetHash = 'hash:green-tea-hut-01';

    sandbox.setRegistryStub({
      filters: {
        ProjectRegistered: function () {
          return {};
        }
      },
      queryFilter: async function () {
        return [];
      },
      projectExists: async function (bytes32ProjectId) {
        return bytes32ProjectId === targetHash;
      },
      getProject: async function (bytes32ProjectId) {
        if (bytes32ProjectId !== targetHash) {
          throw new Error('ProjectNotFound');
        }
        return {
          steward: '0x0000000000000000000000000000000000000002',
          metadataURI: '{"id":"green-tea-hut-01","name":"The Green Tea Hut #1","track":"Green Tea","goal":"12000"}',
          status: 1n
        };
      }
    });

    const projects = await sandbox.adapter.create({}).getProjects();

    expect(projects).to.have.lengthOf(1);
    expect(projects[0].id).to.equal('green-tea-hut-01');
    expect(projects[0].status).to.equal('active');
  });

  it('falls back to candidate ids when the registry scan is rate limited', async function () {
    const sandbox = await loadAppAdapterSandbox();
    const targetHash = 'hash:green-tea-hut-01';

    sandbox.setRegistryStub({
      filters: {
        ProjectRegistered: function () {
          return {};
        }
      },
      queryFilter: async function () {
        throw new Error('Your IP has exceeded its requests per second capacity');
      },
      projectExists: async function (bytes32ProjectId) {
        return bytes32ProjectId === targetHash;
      },
      getProject: async function (bytes32ProjectId) {
        if (bytes32ProjectId !== targetHash) {
          throw new Error('ProjectNotFound');
        }
        return {
          steward: '0x0000000000000000000000000000000000000002',
          metadataURI: '{"id":"green-tea-hut-01","name":"The Green Tea Hut #1","track":"Green Tea","goal":"12000"}',
          status: 1n
        };
      }
    });

    const projects = await sandbox.adapter.create({}).getProjects();

    expect(projects).to.have.lengthOf(1);
    expect(projects[0].id).to.equal('green-tea-hut-01');
    expect(projects[0].status).to.equal('active');
  });
});
