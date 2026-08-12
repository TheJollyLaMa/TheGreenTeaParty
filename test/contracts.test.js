import { expect } from 'chai';
import hre from 'hardhat';

// Helper: deterministic bytes32 project ID from a string slug
function projectId(ethers, slug) {
  return ethers.keccak256(ethers.toUtf8Bytes(slug));
}

// Helper: assert that a promise rejects with a message matching a substring
async function expectRevert(promise, pattern) {
  try {
    await promise;
    throw new Error('Expected transaction to revert, but it succeeded');
  } catch (err) {
    if (err.message === 'Expected transaction to revert, but it succeeded') throw err;
    if (pattern && !err.message.includes(pattern)) {
      throw new Error(`Expected revert containing "${pattern}" but got: ${err.message}`);
    }
  }
}

describe('ProjectRegistry', function () {
  let ethers, registry;
  let owner, steward, other;
  let PID, META;

  before(async function () {
    const conn = await hre.network.getOrCreate();
    ethers = conn.ethers;
    META = 'ipfs://QmExampleMetadataCID';
    PID = projectId(ethers, 'green-tea-party');
  });

  beforeEach(async function () {
    [owner, steward, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('ProjectRegistry');
    registry = await Factory.deploy(owner.address);
  });

  describe('registerProject', function () {
    it('allows owner to register a project', async function () {
      const tx = await registry.connect(owner).registerProject(PID, steward.address, META);
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
      expect(await registry.projectExists(PID)).to.be.true;
    });

    it('reverts when non-owner tries to register', async function () {
      await expectRevert(
        registry.connect(other).registerProject(PID, steward.address, META),
        'Unauthorized'
      );
    });

    it('reverts on duplicate project ID', async function () {
      await registry.connect(owner).registerProject(PID, steward.address, META);
      await expectRevert(
        registry.connect(owner).registerProject(PID, steward.address, META),
        'ProjectAlreadyExists'
      );
    });

    it('reverts on zero steward address', async function () {
      await expectRevert(
        registry.connect(owner).registerProject(PID, ethers.ZeroAddress, META),
        'InvalidSteward'
      );
    });

    it('reverts on empty metadataURI', async function () {
      await expectRevert(
        registry.connect(owner).registerProject(PID, steward.address, ''),
        'InvalidMetadataURI'
      );
    });
  });

  describe('getProject', function () {
    beforeEach(async function () {
      await registry.connect(owner).registerProject(PID, steward.address, META);
    });

    it('returns correct project fields', async function () {
      const [s, m, status] = await registry.getProject(PID);
      expect(s).to.equal(steward.address);
      expect(m).to.equal(META);
      expect(status).to.equal(0n);
    });

    it('reverts on unknown project', async function () {
      const unknownId = projectId(ethers, 'nonexistent');
      await expectRevert(registry.getProject(unknownId), 'ProjectNotFound');
    });
  });

  describe('updateProjectStatus', function () {
    beforeEach(async function () {
      await registry.connect(owner).registerProject(PID, steward.address, META);
    });

    it('steward can transition Draft → Active', async function () {
      await registry.connect(steward).updateProjectStatus(PID, 1);
      const [, , status] = await registry.getProject(PID);
      expect(status).to.equal(1n);
    });

    it('owner can transition Draft → Paused', async function () {
      await registry.connect(owner).updateProjectStatus(PID, 2);
      const [, , status] = await registry.getProject(PID);
      expect(status).to.equal(2n);
    });

    it('rejects invalid transition Draft → Completed', async function () {
      await expectRevert(
        registry.connect(steward).updateProjectStatus(PID, 3),
        'InvalidStatusTransition'
      );
    });

    it('rejects same-status update', async function () {
      await expectRevert(
        registry.connect(steward).updateProjectStatus(PID, 0),
        'InvalidStatusTransition'
      );
    });

    it('unauthorized address cannot update status', async function () {
      await expectRevert(
        registry.connect(other).updateProjectStatus(PID, 1),
        'Unauthorized'
      );
    });
  });

  describe('pause / unpause', function () {
    it('owner can pause and unpause', async function () {
      await registry.connect(owner).pause();
      expect(await registry.paused()).to.be.true;
      await registry.connect(owner).unpause();
      expect(await registry.paused()).to.be.false;
    });

    it('non-owner cannot pause', async function () {
      await expectRevert(registry.connect(other).pause(), 'Unauthorized');
    });

    it('blocks registration while paused', async function () {
      await registry.connect(owner).pause();
      await expectRevert(
        registry.connect(owner).registerProject(PID, steward.address, META),
        'RegistryIsPaused'
      );
    });
  });
});

describe('ProfileRegistry', function () {
  let ethers, profile;
  let user, other;

  before(async function () {
    const conn = await hre.network.getOrCreate();
    ethers = conn.ethers;
  });

  beforeEach(async function () {
    [user, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('ProfileRegistry');
    profile = await Factory.deploy();
  });

  it('allows setting and getting a profile URI', async function () {
    const uri = 'ipfs://QmProfileCID';
    await profile.connect(user).setProfileURI(uri);
    expect(await profile.getProfileURI(user.address)).to.equal(uri);
  });

  it('returns empty string for unknown address', async function () {
    expect(await profile.getProfileURI(other.address)).to.equal('');
  });

  it('rejects empty profileURI', async function () {
    await expectRevert(profile.connect(user).setProfileURI(''), 'InvalidProfileURI');
  });

  it('allows user to update their own URI', async function () {
    await profile.connect(user).setProfileURI('ipfs://v1');
    await profile.connect(user).setProfileURI('ipfs://v2');
    expect(await profile.getProfileURI(user.address)).to.equal('ipfs://v2');
  });
});

describe('Treasury', function () {
  let ethers, registry, treasury;
  let owner, steward, contributor, other;
  let PID, META;

  before(async function () {
    const conn = await hre.network.getOrCreate();
    ethers = conn.ethers;
    META = 'ipfs://QmTreasuryMeta';
    PID = projectId(ethers, 'gtp-treasury-test');
  });

  beforeEach(async function () {
    [owner, steward, contributor, other] = await ethers.getSigners();

    const RegistryFactory = await ethers.getContractFactory('ProjectRegistry');
    registry = await RegistryFactory.deploy(owner.address);

    const TreasuryFactory = await ethers.getContractFactory('Treasury');
    treasury = await TreasuryFactory.deploy(await registry.getAddress(), owner.address);

    await registry.connect(owner).registerProject(PID, steward.address, META);
    await registry.connect(steward).updateProjectStatus(PID, 1 /* Active */);
  });

  describe('contribute', function () {
    it('accepts ETH for an active project', async function () {
      const amount = ethers.parseEther('0.1');
      await treasury.connect(contributor).contribute(PID, { value: amount });
      expect(await treasury.projectBalances(PID)).to.equal(amount);
    });

    it('reverts with zero value', async function () {
      await expectRevert(
        treasury.connect(contributor).contribute(PID, { value: 0 }),
        'InvalidAmount'
      );
    });

    it('reverts for unknown project', async function () {
      const unknownId = projectId(ethers, 'unknown');
      await expectRevert(
        treasury.connect(contributor).contribute(unknownId, { value: ethers.parseEther('0.1') }),
        'ProjectNotFound'
      );
    });

    it('reverts for non-Active project', async function () {
      const draftPid = projectId(ethers, 'draft-project');
      await registry.connect(owner).registerProject(draftPid, steward.address, META);
      await expectRevert(
        treasury.connect(contributor).contribute(draftPid, { value: ethers.parseEther('0.1') }),
        'InvalidProjectState'
      );
    });
  });

  describe('withdraw', function () {
    let deposit;

    beforeEach(async function () {
      deposit = ethers.parseEther('1');
      await treasury.connect(contributor).contribute(PID, { value: deposit });
    });

    it('steward can withdraw to default recipient (self)', async function () {
      const before = await ethers.provider.getBalance(steward.address);
      const tx = await treasury.connect(steward).withdraw(PID, deposit);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * tx.gasPrice;
      const after = await ethers.provider.getBalance(steward.address);
      expect(after + gasUsed).to.be.greaterThanOrEqual(before + deposit - ethers.parseEther('0.001'));
      expect(await treasury.projectBalances(PID)).to.equal(0n);
    });

    it('steward can set a payout address and withdraw routes to it', async function () {
      await treasury.connect(steward).setPayoutAddress(PID, other.address);
      const before = await ethers.provider.getBalance(other.address);
      await treasury.connect(steward).withdraw(PID, deposit);
      const after = await ethers.provider.getBalance(other.address);
      expect(after - before).to.equal(deposit);
    });

    it('reverts when non-steward/non-payout-addr tries to withdraw', async function () {
      await expectRevert(
        treasury.connect(other).withdraw(PID, deposit),
        'Unauthorized'
      );
    });

    it('reverts on insufficient balance', async function () {
      await expectRevert(
        treasury.connect(steward).withdraw(PID, deposit + ethers.parseEther('1')),
        'InsufficientProjectBalance'
      );
    });

    it('reverts on zero amount', async function () {
      await expectRevert(
        treasury.connect(steward).withdraw(PID, 0n),
        'InvalidAmount'
      );
    });
  });

  describe('pause / unpause', function () {
    it('owner can pause and unpause', async function () {
      await treasury.connect(owner).pause();
      expect(await treasury.paused()).to.be.true;
      await treasury.connect(owner).unpause();
      expect(await treasury.paused()).to.be.false;
    });

    it('blocks contributions while paused', async function () {
      await treasury.connect(owner).pause();
      await expectRevert(
        treasury.connect(contributor).contribute(PID, { value: ethers.parseEther('0.1') }),
        'TreasuryIsPaused'
      );
    });

    it('blocks withdrawals while paused', async function () {
      await treasury.connect(contributor).contribute(PID, { value: ethers.parseEther('0.1') });
      await treasury.connect(owner).pause();
      await expectRevert(
        treasury.connect(steward).withdraw(PID, ethers.parseEther('0.1')),
        'TreasuryIsPaused'
      );
    });
  });

  describe('constructor validation', function () {
    it('reverts with zero registry address', async function () {
      const Factory = await ethers.getContractFactory('Treasury');
      await expectRevert(
        Factory.deploy(ethers.ZeroAddress, owner.address),
        'InvalidRegistry'
      );
    });
  });
});
