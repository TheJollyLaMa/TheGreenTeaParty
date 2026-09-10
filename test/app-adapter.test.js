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
        10: {
          projectRegistry: '0x799A97231685d91fdbB03A635B965971A8c71a84',
          treasury: '0x14c1E69309C96569bBA0423507DA6AFE6FD30DdC',
          profileRegistry: '0xd66AdB0E70303D4e6daf8C963c7947f9ae722446',
          fromBlock: 0
        }
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
          withdraw: async function () {},
          updateRegistry: async function () {},
          updateProfileRegistry: async function () {}
        };
      }
    }
  };

  sandbox.window.ethers = {
    JsonRpcProvider: class {
      constructor() {}
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
  it('hydrates projects from getAllProjectIds()', async function () {
    const sandbox = await loadAppAdapterSandbox();
    let getProjectCalls = 0;

    sandbox.setRegistryStub({
      getAllProjectIds: async function () {
        return ['0xproject1'];
      },
      getProject: async function (projectId) {
        getProjectCalls += 1;
        expect(projectId).to.equal('0xproject1');
        return {
          steward: '0x0000000000000000000000000000000000000002',
          metadataURI: '{"id":"green-tea-hut-01","name":"The Green Tea Hut #1","track":"Green Tea","goal":"12000"}',
          status: 1n
        };
      }
    });

    const projects = await sandbox.adapter.create({}).getProjects();

    expect(getProjectCalls).to.equal(1);
    expect(projects).to.have.lengthOf(1);
    expect(projects[0]).to.include({
      id: 'green-tea-hut-01',
      name: 'The Green Tea Hut #1',
      track: 'Green Tea',
      status: 'active',
      raised: 0,
      goal: 12000,
      metadataURI: '{"id":"green-tea-hut-01","name":"The Green Tea Hut #1","track":"Green Tea","goal":"12000"}'
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
      artizenUrl: 'https://artizen.fund/projects/green-tea-hut-1',
      website: 'https://example.com/green-tea-hut-1',
      steward: '0x0000000000000000000000000000000000000002'
    };

    sandbox.setRegistryStub({
      getAllProjectIds: async function () {
        return ['0xproject1'];
      },
      getProject: async function () {
        return {
          steward: '0x0000000000000000000000000000000000000002',
          metadataURI: JSON.stringify(JSON.stringify(metadata)),
          status: 1n
        };
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
      artizenUrl: 'https://artizen.fund/projects/green-tea-hut-1',
      githubPagesUrl: 'https://example.com/green-tea-hut-1',
      metadataURI: JSON.stringify(JSON.stringify(metadata))
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
      getAllProjectIds: async function () {
        return ['0xproject1'];
      },
      getProject: async function () {
        return {
          steward: '0x0000000000000000000000000000000000000002',
          metadataURI: 'https://example.com/metadata.json',
          status: 1n
        };
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
      goal: 12000,
      metadataURI: 'https://example.com/metadata.json'
    });
  });

  it('falls back to projectList enumeration when getAllProjectIds is unavailable', async function () {
    const sandbox = await loadAppAdapterSandbox();
    const calls = [];

    sandbox.setRegistryStub({
      getProjectCount: async function () {
        return 1;
      },
      projectList: async function (index) {
        calls.push(index);
        return '0xproject1';
      },
      getProject: async function () {
        return {
          steward: '0x0000000000000000000000000000000000000002',
          metadataURI: '{"id":"green-tea-hut-01","name":"The Green Tea Hut #1","track":"Green Tea","goal":"12000"}',
          status: 1n
        };
      }
    });

    const projects = await sandbox.adapter.create({}).getProjects();

    expect(calls).to.deep.equal([0]);
    expect(projects).to.have.lengthOf(1);
    expect(projects[0].id).to.equal('green-tea-hut-01');
    expect(projects[0].status).to.equal('active');
    expect(projects[0].metadataURI).to.equal('{"id":"green-tea-hut-01","name":"The Green Tea Hut #1","track":"Green Tea","goal":"12000"}');
  });
});
