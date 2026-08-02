/* global GTPData, GTPKpi, GTPModeRouter, GTPAppState, GTPWallet, GTPNetwork */

const metricsStrip = document.querySelector('#metrics-strip');
const projectGrid = document.querySelector('#project-grid');
const activityList = document.querySelector('#activity-list');
const trackFilter = document.querySelector('#track-filter');
const stageFilter = document.querySelector('#stage-filter');
const kpiPanel = document.querySelector('#kpi-panel');
const modeBadge = document.querySelector('#mode-badge');
const appStatePanel = document.querySelector('#app-state-panel');
const walletControl = document.querySelector('#wallet-control');

const modeInfo = GTPModeRouter.getModeInfo(window.location);

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);

const shortenAddress = (address) => {
  if (!address || typeof address !== 'string' || address.length < 10) {
    return address || '';
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
};

const renderModeBadge = () => {
  if (!modeBadge) {
    return;
  }

  modeBadge.textContent = modeInfo.label;
  modeBadge.classList.toggle('mode-badge--prototype', modeInfo.isPrototype);
  modeBadge.classList.toggle('mode-badge--app', modeInfo.isApp);
};

const renderAppStatePanel = () => {
  if (!appStatePanel) {
    return;
  }

  if (!modeInfo.isApp) {
    appStatePanel.hidden = true;
    return;
  }

  const state = GTPAppState.getState();
  const readiness = GTPAppState.getReadiness();

  appStatePanel.hidden = false;
  appStatePanel.innerHTML = `
    <strong>App mode bootstrap</strong>
    <p class="app-state-meta">Wallet: ${state.connectionStatus}</p>
    <p class="app-state-meta">Address: ${state.address ? shortenAddress(state.address) : 'not connected'}</p>
    <p class="app-state-meta">Network: ${state.chainId || 'not selected'}</p>
    <p class="app-state-meta">Network support: ${state.isSupportedNetwork ? 'supported' : 'unsupported'}</p>
    <p class="app-state-meta">Profile: ${state.profilePresent ? 'present' : 'missing'}</p>
    ${readiness.ready ? '' : `<p class="app-state-warning">${readiness.reason}</p>`}
    ${state.lastError ? `<p class="app-state-warning">${state.lastError}</p>` : ''}
  `;
};

let connectIconFailed = false;

const renderWalletControl = () => {
  if (!walletControl) return;
  if (!modeInfo.isApp) {
    walletControl.hidden = true;
    walletControl.innerHTML = '';
    return;
  }

  const state = GTPAppState.getState();
  walletControl.hidden = false;
  walletControl.innerHTML = '';

  const row = document.createElement('div');
  row.className = 'wallet-control-row';

  if (state.connectionStatus === 'connected' && state.address) {
    const addressPill = document.createElement('span');
    addressPill.className = 'wallet-address-pill';
    addressPill.textContent = shortenAddress(state.address);
    row.appendChild(addressPill);

    const disconnectBtn = document.createElement('button');
    disconnectBtn.type = 'button';
    disconnectBtn.className = 'btn btn-secondary wallet-disconnect-btn';
    disconnectBtn.textContent = 'Disconnect';
    disconnectBtn.addEventListener('click', () => {
      GTPWallet.disconnect();
    });
    row.appendChild(disconnectBtn);
  } else {
    const connectBtn = document.createElement('button');
    connectBtn.type = 'button';
    connectBtn.className = 'btn btn-primary wallet-connect-btn';
    connectBtn.setAttribute('aria-label', 'Connect MetaMask Wallet');
    connectBtn.disabled = state.connectionStatus === 'connecting';

    if (!connectIconFailed) {
      const icon = document.createElement('img');
      icon.src = 'assets/metamask.png';
      icon.alt = 'MetaMask';
      icon.className = 'wallet-connect-icon';
      icon.addEventListener('error', () => {
        connectIconFailed = true;
        renderWalletControl();
      });
      connectBtn.appendChild(icon);
    }

    const label = document.createElement('span');
    if (state.connectionStatus === 'connecting') {
      label.textContent = 'Connecting…';
    } else {
      label.textContent = connectIconFailed ? 'Connect Wallet' : 'Connect MetaMask Wallet';
    }
    connectBtn.appendChild(label);

    connectBtn.addEventListener('click', () => {
      GTPWallet.connect();
    });
    row.appendChild(connectBtn);
  }

  walletControl.appendChild(row);

  if (!state.isSupportedNetwork && typeof state.chainId === 'number') {
    const unsupported = document.createElement('p');
    unsupported.className = 'wallet-warning';
    unsupported.textContent = `Unsupported network (${state.chainId}). Switch to one of: ${GTPNetwork.supportedChainLabel()}.`;
    walletControl.appendChild(unsupported);
  }

  if (state.connectionStatus === 'rejected' || state.connectionStatus === 'error') {
    const warning = document.createElement('p');
    warning.className = 'wallet-warning';
    warning.textContent = state.lastError || 'Wallet connection failed. Try again.';
    walletControl.appendChild(warning);
  }
};

const updateMetrics = (filteredProjects) => {
  if (!metricsStrip) {
    return;
  }

  const metrics = GTPData.getMetrics(filteredProjects);

  const metricItems = [
    { label: 'Total raised', value: formatCurrency(metrics.totalRaised) },
    { label: 'Available funds', value: formatCurrency(metrics.availableFunds) },
    { label: 'Active projects', value: String(metrics.activeProjects) },
    { label: 'Contributors / stewards', value: String(metrics.totalStewards) }
  ];

  metricsStrip.innerHTML = metricItems
    .map(
      (item) =>
        `<li class="metric-card"><div class="metric-label">${item.label}</div><p class="metric-value">${item.value}</p></li>`
    )
    .join('');
};

const renderProjects = () => {
  if (!projectGrid || !trackFilter || !stageFilter) {
    return;
  }

  GTPData.setFilter('track', trackFilter.value);
  GTPData.setFilter('status', stageFilter.value);

  const filteredProjects = GTPData.filterProjects();

  updateMetrics(filteredProjects);

  if (filteredProjects.length === 0) {
    const emptyMessage = modeInfo.isApp
      ? 'No app projects loaded yet. Connect wallet, select network, and create profile to continue.'
      : 'No projects match this filter yet.';

    projectGrid.innerHTML = `<li class="project-card"><p class="project-meta">${emptyMessage}</p></li>`;
    return;
  }

  projectGrid.innerHTML = filteredProjects
    .map((project) => {
      const links = [
        project.repoUrl ? `<a href="${project.repoUrl}" target="_blank" rel="noreferrer">Repo</a>` : '',
        project.artizenUrl ? `<a href="${project.artizenUrl}" target="_blank" rel="noreferrer">Artizen</a>` : ''
      ]
        .filter(Boolean)
        .join('');

      const nextActionHtml = project.nextAction
        ? `<p class="project-meta">Next: ${project.nextAction}</p>`
        : '';

      return `
        <li class="project-card">
          <h4 class="project-title">${project.name}</h4>
          <p class="project-meta">${project.track} · ${project.status}</p>
          <p>${formatCurrency(project.raised)} / ${formatCurrency(project.goal)}</p>
          <p class="project-meta">Last update: ${project.lastUpdate}</p>
          ${nextActionHtml}
          ${links ? `<div class="project-links">${links}</div>` : ''}
        </li>
      `;
    })
    .join('');
};

const renderActivity = () => {
  if (!activityList) {
    return;
  }

  const activity = GTPData.getActivity();

  if (!activity.length) {
    const emptyMessage = modeInfo.isApp
      ? 'No onchain activity loaded yet. Connect wallet and network to load ledger activity.'
      : 'No activity recorded yet.';

    activityList.innerHTML = `<li class="activity-item"><p class="activity-meta">${emptyMessage}</p></li>`;
    return;
  }

  activityList.innerHTML = activity
    .map((entry) => {
      const amount = typeof entry.amount === 'number' ? ` · ${formatCurrency(entry.amount)}` : '';
      return `
        <li class="activity-item">
          <strong>${entry.type}</strong>
          <p>${entry.title}${amount}</p>
          <p class="activity-meta">${entry.date}</p>
        </li>
      `;
    })
    .join('');
};

const populateFilters = () => {
  if (!trackFilter || !stageFilter) {
    return;
  }

  const { tracks, statuses } = GTPData.getFilterOptions();

  tracks.forEach((track) => {
    trackFilter.insertAdjacentHTML('beforeend', `<option value="${track}">${track}</option>`);
  });

  statuses.forEach((status) => {
    stageFilter.insertAdjacentHTML(
      'beforeend',
      `<option value="${status}">${status.charAt(0).toUpperCase()}${status.slice(1)}</option>`
    );
  });
};

renderModeBadge();
renderAppStatePanel();
renderWalletControl();

GTPData.load().then(() => {
  populateFilters();
  renderProjects();
  renderActivity();
  if (kpiPanel) GTPKpi.render(kpiPanel);
}).catch((err) => {
  console.error('[app] Failed to load data:', err);
  if (projectGrid) {
    projectGrid.innerHTML =
      '<li class="project-card"><p class="project-meta">Could not load project data. Check the console for details.</p></li>';
  }
});

if (trackFilter) {
  trackFilter.addEventListener('change', renderProjects);
}

if (stageFilter) {
  stageFilter.addEventListener('change', renderProjects);
}

const themeToggle = document.querySelector('#theme-toggle');

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('light');
  });
}

if (modeInfo.isApp) {
  GTPWallet.init().then(() => {
    renderAppStatePanel();
    renderWalletControl();
  });
}

GTPAppState.subscribe(() => {
  renderAppStatePanel();
  renderWalletControl();
});
