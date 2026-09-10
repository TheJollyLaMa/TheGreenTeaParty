import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createEventTarget(requestAccountRef, selectedAddressRef) {
  const listeners = {};
  const addressRef = selectedAddressRef || requestAccountRef;

  return {
    isMetaMask: true,
    get selectedAddress() {
      return addressRef.value;
    },
    listeners,
    on(event, handler) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    },
    emit(event, payload) {
      (listeners[event] || []).forEach((handler) => handler(payload));
    },
    request({ method }) {
      if (method === 'eth_accounts') {
        return Promise.resolve(requestAccountRef.value ? [requestAccountRef.value] : []);
      }
      if (method === 'eth_requestAccounts') {
        return Promise.resolve(requestAccountRef.value ? [requestAccountRef.value] : []);
      }
      if (method === 'eth_chainId') {
        return Promise.resolve('0xa');
      }
      return Promise.reject(new Error(`Unexpected method: ${method}`));
    }
  };
}

async function loadWalletSandbox() {
  const source = await readFile(path.join(__dirname, '..', 'scripts', 'wallet.js'), 'utf8');
  const staleAccountRef = { value: '0x0000000000000000000000000000000000000001' };
  const liveAccountRef = { value: '0x0000000000000000000000000000000000000001' };
  const liveSelectedRef = { value: '0x0000000000000000000000000000000000000001' };
  const selectedProvider = createEventTarget(staleAccountRef, liveSelectedRef);
  const windowListeners = {};
  const documentListeners = {};
  const intervalCallbacks = [];

  const state = {
    connectionStatus: 'disconnected',
    address: null,
    chainId: null,
    isSupportedNetwork: false,
    profilePresent: false,
    lastError: null
  };

  const sandbox = {
    window: {
      ethereum: Object.assign(selectedProvider, {
        providers: [selectedProvider]
      }),
      addEventListener(event, handler) {
        windowListeners[event] = handler;
      },
      setInterval(handler) {
        intervalCallbacks.push(handler);
        return intervalCallbacks.length;
      }
    },
    document: {
      hidden: false,
      addEventListener(event, handler) {
        documentListeners[event] = handler;
      }
    },
    console,
    Promise,
    Array,
    Object,
    JSON,
    Math,
    Date,
    RegExp,
    Error,
    setTimeout,
    clearTimeout,
    GTPNetwork: {
      parseChainId(value) {
        return Number(BigInt(value));
      },
      isSupportedChain(chainId) {
        return chainId === 10;
      }
    },
    GTPAppState: {
      setState(patch) {
        Object.assign(state, patch);
      },
      getState() {
        return { ...state };
      },
      getSessionIdentity() {
        return {
          address: state.address,
          chainId: state.chainId,
          connectionStatus: state.connectionStatus,
          isSupportedNetwork: state.isSupportedNetwork
        };
      }
    }
  };

  vm.runInNewContext(source, sandbox, { filename: 'wallet.js' });

  return {
    wallet: sandbox.window.GTPWallet,
    state,
    selectedProvider,
    liveAccountRef,
    liveSelectedRef,
    staleAccountRef,
    windowListeners,
    documentListeners,
    intervalCallbacks
  };
}

describe('GTPWallet', function () {
  it('binds wallet events so account switches update the active address', async function () {
    const sandbox = await loadWalletSandbox();

    await sandbox.wallet.init();
    expect(sandbox.selectedProvider.listeners.accountsChanged).to.have.lengthOf(1);

    sandbox.liveAccountRef.value = '0x0000000000000000000000000000000000000002';
    sandbox.liveSelectedRef.value = '0x0000000000000000000000000000000000000002';
    sandbox.selectedProvider.emit('accountsChanged', [sandbox.liveAccountRef.value]);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sandbox.state.address).to.equal('0x0000000000000000000000000000000000000002');
    expect(sandbox.state.connectionStatus).to.equal('connected');
    expect(sandbox.state.chainId).to.equal(10);
  });

  it('reconnects against the latest injected account after disconnecting', async function () {
    const sandbox = await loadWalletSandbox();

    await sandbox.wallet.init();
    sandbox.wallet.disconnect();

    sandbox.liveAccountRef.value = '0x0000000000000000000000000000000000000003';
    sandbox.liveSelectedRef.value = '0x0000000000000000000000000000000000000003';
    const result = await sandbox.wallet.connect();

    expect(result).to.equal(true);
    expect(sandbox.state.address).to.equal('0x0000000000000000000000000000000000000003');
    expect(sandbox.state.connectionStatus).to.equal('connected');
  });

  it('refreshes the active account when the periodic sync runs', async function () {
    const sandbox = await loadWalletSandbox();

    await sandbox.wallet.init();
    sandbox.liveAccountRef.value = '0x0000000000000000000000000000000000000004';
    sandbox.liveSelectedRef.value = '0x0000000000000000000000000000000000000004';
    expect(sandbox.intervalCallbacks).to.have.lengthOf(1);

    await sandbox.intervalCallbacks[0]();

    expect(sandbox.state.address).to.equal('0x0000000000000000000000000000000000000004');
    expect(sandbox.state.connectionStatus).to.equal('connected');
  });

  it('prefers the provider selectedAddress over a stale accounts response', async function () {
    const sandbox = await loadWalletSandbox();

    sandbox.selectedProvider.request = ({ method }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
        return Promise.resolve(['0x0000000000000000000000000000000000000001']);
      }
      if (method === 'eth_chainId') {
        return Promise.resolve('0xa');
      }
      return Promise.reject(new Error(`Unexpected method: ${method}`));
    };
    sandbox.liveAccountRef.value = '0x0000000000000000000000000000000000000001';
    sandbox.liveSelectedRef.value = '0x0000000000000000000000000000000000000005';

    await sandbox.wallet.init();

    expect(sandbox.state.address).to.equal('0x0000000000000000000000000000000000000005');
    expect(sandbox.state.connectionStatus).to.equal('connected');
  });
});
