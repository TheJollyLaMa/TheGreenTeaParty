/* global GTPData, GTPKpi, GTPModeRouter, GTPAppState, GTPWallet, GTPNetwork */

const metricsStrip = document.querySelector('#metrics-strip');
const projectGrid = document.querySelector('#project-grid');
const activityList = document.querySelector('#activity-list');
const publicLedgerBody = document.querySelector('#public-ledger-body');
const ledgerViewMoreBtn = document.querySelector('#ledger-view-more-btn');
const ledgerRefreshBtn = document.querySelector('#ledger-refresh-btn');
const ledgerWalletNetworkChip = document.querySelector('#ledger-wallet-network-chip');
const trackFilter = document.querySelector('#track-filter');
const stageFilter = document.querySelector('#stage-filter');
const kpiPanel = document.querySelector('#kpi-panel');
const modeBadge = document.querySelector('#mode-badge');
const appStatePanel = document.querySelector('#app-state-panel');
const walletControl = document.querySelector('#wallet-control');
const operationsSessionStatus = document.querySelector('#operations-session-status');
const operationsSnapshotGrid = document.querySelector('#operations-snapshot-grid');

const modeInfo = GTPModeRouter.getModeInfo(window.location);
const dataBasePath = new URL('.', document.baseURI).href;
const LEDGER_PAGE_SIZE = 8;
let ledgerVisibleCount = LEDGER_PAGE_SIZE;
let unifiedRouteNavigationBound = false;
let unifiedRouteKeydownHandler = null;

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

const isOperationsLanding = () => modeInfo.isApp && document.body.dataset.page === 'fund-operations';

const formatStatusLabel = (value) => {
  if (!value) {
    return 'unknown';
  }

  return String(value)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

const formatAssociationTypeLabel = (value) => {
  if (!value) {
    return 'link';
  }
  return String(value)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

const describeAssociationForProject = (association, projectId, projectById) => {
  const counterpartId = association.source === projectId ? association.target : association.source;
  const counterpartName = projectById[counterpartId]?.name || counterpartId;
  const flow = association.direction === 'bidirectional'
    ? '↔'
    : association.direction === 'source-to-target'
      ? (association.source === projectId ? '→' : '←')
      : (association.source === projectId ? '←' : '→');
  const typeLabel = formatAssociationTypeLabel(association.typeLabel || association.type);
  const resource = association.resource ? ` · ${association.resource}` : '';
  return `${typeLabel} ${flow} ${counterpartName}${resource}`;
};

const summarizeProjectAssociations = (projectId, associationMap, projectById) => {
  const associations = associationMap[projectId] || [];
  if (!associations.length) {
    return '';
  }

  const top = [...associations]
    .sort((a, b) => (Number(b.weight) || 1) - (Number(a.weight) || 1))
    .slice(0, 2)
    .map((association) => describeAssociationForProject(association, projectId, projectById))
    .join(' · ');

  return associations.length > 2 ? `${top} (+${associations.length - 2} more)` : top;
};

const formatLedgerAssociationContext = (associationContext) => {
  if (!associationContext || !Array.isArray(associationContext.topLinks) || !associationContext.topLinks.length) {
    return '';
  }

  const topLinks = associationContext.topLinks.map((link) => {
    const flow = link.flow === 'incoming' ? '←' : link.flow === 'outgoing' ? '→' : '↔';
    const typeLabel = formatAssociationTypeLabel(link.typeLabel || link.type);
    const resource = link.resource ? ` · ${link.resource}` : '';
    return `${typeLabel} ${flow} ${link.relatedProjectName}${resource}`;
  }).join(' · ');

  return associationContext.totalLinks > associationContext.topLinks.length
    ? `${topLinks} (+${associationContext.totalLinks - associationContext.topLinks.length} more)`
    : topLinks;
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
    <strong>Wallet session</strong>
    <p class="app-state-meta">Wallet: ${state.connectionStatus}</p>
    <p class="app-state-meta">Address: ${state.address ? shortenAddress(state.address) : 'not connected'}</p>
    <p class="app-state-meta">Network: ${state.chainId || 'not selected'}</p>
    <p class="app-state-meta">Network support: ${state.isSupportedNetwork ? 'supported' : 'unsupported'}</p>
    <p class="app-state-meta">Profile: ${state.profilePresent ? 'present' : 'missing'}</p>
    ${readiness.ready ? '' : `<p class="app-state-warning">${readiness.reason}</p>`}
    ${state.lastError ? `<p class="app-state-warning">${state.lastError}</p>` : ''}
  `;
};

const renderOperationsSessionStatus = () => {
  if (!operationsSessionStatus || !modeInfo.isApp) {
    return;
  }

  const state = GTPAppState.getState();
  const readiness = GTPAppState.getReadiness();
  const statusParts = [
    `Wallet ${formatStatusLabel(state.connectionStatus)}`
  ];

  if (state.address) {
    statusParts.push(`Session ${shortenAddress(state.address)}`);
  }

  if (typeof state.chainId === 'number') {
    statusParts.push(`Network ${state.chainId}${state.isSupportedNetwork ? '' : ' unsupported'}`);
  } else {
    statusParts.push('Network not selected');
  }

  statusParts.push(readiness.ready ? 'Ready for contract-backed actions' : readiness.reason);
  operationsSessionStatus.textContent = statusParts.join(' · ');
};

const isSafeHttpUrl = (value) => {
  if (!value || typeof value !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
};

const statusClassName = (value) => String(value || 'unknown')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '') || 'unknown';

const getDeterministicLedgerEntries = () => GTPData.getActivity().slice();

const renderLedgerWalletNetworkChip = () => {
  if (!ledgerWalletNetworkChip || !modeInfo.isApp) {
    return;
  }

  const state = GTPAppState.getState();
  const walletLabel = state.address
    ? shortenAddress(state.address)
    : formatStatusLabel(state.connectionStatus);
  const networkLabel = typeof state.chainId === 'number'
    ? `chain ${state.chainId}${state.isSupportedNetwork ? '' : ' unsupported'}`
    : 'network n/a';

  ledgerWalletNetworkChip.textContent = `${walletLabel} · ${networkLabel}`;
};

const renderPublicLedgerState = (kind, message) => {
  if (!publicLedgerBody) {
    return;
  }

  publicLedgerBody.innerHTML = '';
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  const text = document.createElement('p');
  row.className = `public-ledger-state-row public-ledger-state-row--${kind}`;
  cell.colSpan = 9;
  text.className = `public-ledger-state public-ledger-state--${kind}`;
  text.textContent = message;
  cell.appendChild(text);
  row.appendChild(cell);
  publicLedgerBody.appendChild(row);

  if (ledgerViewMoreBtn) {
    ledgerViewMoreBtn.hidden = true;
  }
};

const renderPublicLedger = () => {
  if (!publicLedgerBody) {
    return;
  }

  const entries = getDeterministicLedgerEntries();
  const visibleEntries = entries.slice(0, ledgerVisibleCount);

  if (!visibleEntries.length) {
    const emptyMsg = modeInfo.isApp
      ? 'No on-chain entries yet — this ledger is a clean slate. Connect your wallet on Optimism and make the first entry.'
      : 'No contract ledger rows available yet.';
    renderPublicLedgerState('empty', emptyMsg);
    return;
  }

  publicLedgerBody.innerHTML = '';

  visibleEntries.forEach((entry) => {
    const row = document.createElement('tr');
    row.className = 'public-ledger-row';

    const idCell = document.createElement('td');
    idCell.textContent = entry.id || '—';
    row.appendChild(idCell);

    const dateCell = document.createElement('td');
    dateCell.textContent = entry.date || '—';
    row.appendChild(dateCell);

    const typeCell = document.createElement('td');
    typeCell.textContent = formatStatusLabel(entry.direction || entry.type || 'incoming');
    row.appendChild(typeCell);

    const statusCell = document.createElement('td');
    const statusBadge = document.createElement('span');
    statusBadge.className = `ledger-status-badge ledger-status-badge--${statusClassName(entry.status)}`;
    statusBadge.textContent = formatStatusLabel(entry.status || 'confirmed');
    statusCell.appendChild(statusBadge);
    row.appendChild(statusCell);

    const amountCell = document.createElement('td');
    if (typeof entry.amount === 'number') {
      const absoluteAmount = formatCurrency(Math.abs(entry.amount));
      amountCell.textContent = (entry.direction === 'outgoing' || entry.amount < 0)
        ? `-${absoluteAmount}`
        : absoluteAmount;
    } else {
      amountCell.textContent = '—';
    }
    row.appendChild(amountCell);

    const categoryCell = document.createElement('td');
    categoryCell.textContent = entry.category || 'General';
    row.appendChild(categoryCell);

    const descriptionCell = document.createElement('td');
    const associationContextText = formatLedgerAssociationContext(entry.associationContext);
    const baseDescription = document.createElement('span');
    baseDescription.textContent = entry.description || entry.title || '';
    descriptionCell.appendChild(baseDescription);
    if (associationContextText) {
      const contextMeta = document.createElement('p');
      contextMeta.className = 'activity-meta';
      contextMeta.textContent = `Context: ${associationContextText}`;
      descriptionCell.appendChild(contextMeta);
    }
    row.appendChild(descriptionCell);

    const notesCell = document.createElement('td');
    notesCell.textContent = entry.notes || '—';
    row.appendChild(notesCell);

    const proofCell = document.createElement('td');
    if (isSafeHttpUrl(entry.proofUrl)) {
      const proofLink = document.createElement('a');
      proofLink.href = entry.proofUrl;
      proofLink.target = '_blank';
      proofLink.rel = 'noreferrer noopener';
      proofLink.textContent = 'View proof';
      proofCell.appendChild(proofLink);
    } else {
      proofCell.textContent = '—';
    }
    row.appendChild(proofCell);

    publicLedgerBody.appendChild(row);
  });

  if (ledgerViewMoreBtn) {
    const hasMore = entries.length > visibleEntries.length;
    ledgerViewMoreBtn.hidden = !hasMore;
    if (hasMore) {
      ledgerViewMoreBtn.textContent = `View more (${entries.length - visibleEntries.length})`;
    }
  }
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
    addressPill.title = state.address;
    addressPill.setAttribute('aria-label', `Connected wallet ${state.address}`);
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

const renderOperationsSnapshots = () => {
  if (!operationsSnapshotGrid || !modeInfo.isApp) {
    return;
  }

  const projects = GTPData.getProjects();
  const metrics = GTPData.getMetrics(projects);
  const readiness = GTPAppState.getReadiness();
  const activity = GTPData.getActivity();
  const activeProjects = projects.filter((project) => project.status === 'active').length;
  const pendingActions = projects.filter(
    (project) => project.status !== 'completed' && Boolean(project.nextAction)
  ).length;
  const treasuryMeta = metrics.placeholder
    ? `${readiness.reason ? `${readiness.reason} ` : ''}Showing fixture-backed treasury visibility until live contract reads are configured.`
    : `${activity.length} public ledger updates are available below.`;

  const snapshotItems = [
    {
      label: 'Treasury',
      value: formatCurrency(metrics.availableFunds),
      meta: treasuryMeta
    },
    {
      label: 'Active projects',
      value: String(activeProjects),
      meta: `${projects.length} registered projects are currently visible in the fund path.`
    },
    {
      label: 'Pending actions',
      value: String(pendingActions),
      meta: pendingActions
        ? 'Projects with a recorded next action need follow-through.'
        : 'No pending follow-up items are currently recorded.'
    }
  ];

  operationsSnapshotGrid.innerHTML = '';
  snapshotItems.forEach((item) => {
    const card = document.createElement('li');
    card.className = 'metric-card operations-snapshot-card';

    const label = document.createElement('div');
    label.className = 'metric-label';
    label.textContent = item.label;

    const value = document.createElement('p');
    value.className = 'metric-value';
    value.textContent = item.value;

    const meta = document.createElement('p');
    meta.className = 'project-meta';
    meta.textContent = item.meta;

    card.appendChild(label);
    card.appendChild(value);
    card.appendChild(meta);
    operationsSnapshotGrid.appendChild(card);
  });
};

const renderProjects = () => {
  if (!projectGrid) {
    return;
  }

  if (trackFilter) {
    GTPData.setFilter('track', trackFilter.value);
  }

  if (stageFilter) {
    GTPData.setFilter('status', stageFilter.value);
  }

  const filteredProjects = GTPData.filterProjects();
  const projectById = {};
  GTPData.getProjects().forEach((project) => {
    projectById[project.id] = project;
  });
  const associationMap = typeof GTPData.buildAssociationIndex === 'function'
    ? GTPData.buildAssociationIndex(GTPData.getAssociations())
    : {};
  const displayProjects = isOperationsLanding()
    ? [...filteredProjects].sort((projectA, projectB) => {
        const priorityA = Number(projectA.status === 'active') + Number(Boolean(projectA.nextAction));
        const priorityB = Number(projectB.status === 'active') + Number(Boolean(projectB.nextAction));
        return priorityB - priorityA || projectA.name.localeCompare(projectB.name);
      }).slice(0, 6)
    : filteredProjects;

  updateMetrics(filteredProjects);

  if (displayProjects.length === 0) {
    const emptyMessage = modeInfo.isApp
      ? 'No app projects loaded yet. Connect wallet, select network, and create profile to continue.'
      : 'No projects match this filter yet.';

    projectGrid.innerHTML = `<li class="project-card"><p class="project-meta">${emptyMessage}</p></li>`;
    return;
  }

  projectGrid.innerHTML = displayProjects
    .map((project) => {
      const links = [
        project.repoUrl ? `<a href="${project.repoUrl}" target="_blank" rel="noreferrer">Repo</a>` : '',
        project.artizenUrl ? `<a href="${project.artizenUrl}" target="_blank" rel="noreferrer">Artizen</a>` : ''
      ]
        .filter(Boolean)
        .join('');

      const hasNextAction = hasTextValue(project.nextAction);
      const nextActionText = formatTextValue(project.nextAction);
      const nextActionHtml = `<p class="project-meta${hasNextAction ? '' : ' project-meta--placeholder'}">Next: ${nextActionText}</p>`;
      const associationSummary = summarizeProjectAssociations(project.id, associationMap, projectById);
      const associationHtml = associationSummary
        ? `<p class="project-meta">Links: ${associationSummary}</p>`
        : '';

      return `
        <li class="project-card">
          <h4 class="project-title">${project.name}</h4>
          <p class="project-meta">${project.track} · ${project.status}</p>
          <p>${formatCurrency(project.raised)} / ${formatCurrency(project.goal)}</p>
          <p class="project-meta">Last update: ${formatTextValue(project.lastUpdate)}</p>
          ${nextActionHtml}
          ${associationHtml}
          ${links ? `<div class="project-links">${links}</div>` : ''}
        </li>
      `;
    })
    .join('');
};

const renderActivity = () => {
  if (isOperationsLanding() && publicLedgerBody) {
    renderPublicLedger();
    return;
  }

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
      const associationContext = formatLedgerAssociationContext(entry.associationContext);
      return `
        <li class="activity-item">
          <strong>${entry.type}</strong>
          <p>${entry.title}${amount}</p>
          ${associationContext ? `<p class="activity-meta">Context: ${associationContext}</p>` : ''}
          <p class="activity-meta">${entry.date}</p>
        </li>
      `;
    })
    .join('');
};

const navigateToSection = (hash) => {
  const target = document.querySelector(hash);
  if (!target) {
    return;
  }

  if (window.location.hash !== hash) {
    window.history.pushState(null, '', hash);
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const isLedgerSectionActive = () => {
  const ledgerSection = document.querySelector('#public-ledger');
  if (!ledgerSection) {
    return false;
  }

  if (window.location.hash === '#public-ledger') {
    return true;
  }

  const rect = ledgerSection.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  return rect.top < viewportHeight * 0.5 && rect.bottom > 0;
};

const unbindUnifiedRouteNavigation = () => {
  if (unifiedRouteKeydownHandler) {
    document.removeEventListener('keydown', unifiedRouteKeydownHandler);
    unifiedRouteKeydownHandler = null;
  }
  unifiedRouteNavigationBound = false;
};

const bindUnifiedRouteNavigation = () => {
  if (document.body?.dataset?.routeVariant !== 'unified-root') {
    unbindUnifiedRouteNavigation();
    return;
  }

  if (unifiedRouteNavigationBound) {
    return;
  }

  unifiedRouteNavigationBound = true;
  unifiedRouteKeydownHandler = (event) => {
    if (event.key !== 'Escape' || !isLedgerSectionActive()) {
      return;
    }

    event.preventDefault();
    navigateToSection('#fractal-experience');
  };
  document.addEventListener('keydown', unifiedRouteKeydownHandler);
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
bindUnifiedRouteNavigation();
renderAppStatePanel();
renderWalletControl();
renderOperationsSessionStatus();
renderLedgerWalletNetworkChip();
if (isOperationsLanding() && publicLedgerBody) {
  renderPublicLedgerState('loading', 'Loading contract ledger rows…');
}

GTPData.load(dataBasePath).then(() => {
  populateFilters();
  renderOperationsSnapshots();
  renderProjects();
  renderActivity();
  if (kpiPanel) GTPKpi.render(kpiPanel);
}).catch((err) => {
  console.error('[app] Failed to load data:', err);
  if (projectGrid) {
    projectGrid.innerHTML =
      '<li class="project-card"><p class="project-meta">Could not load project data. Check the console for details.</p></li>';
  }
  if (isOperationsLanding() && publicLedgerBody) {
    renderPublicLedgerState('error', 'Could not load ledger rows. Check the console for details.');
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
    renderOperationsSessionStatus();
    renderLedgerWalletNetworkChip();
    renderOperationsSnapshots();
  });
}

GTPAppState.subscribe(() => {
  renderAppStatePanel();
  renderWalletControl();
  renderOperationsSessionStatus();
  renderLedgerWalletNetworkChip();
  renderOperationsSnapshots();
});

if (ledgerViewMoreBtn) {
  ledgerViewMoreBtn.addEventListener('click', () => {
    ledgerVisibleCount += LEDGER_PAGE_SIZE;
    renderPublicLedger();
  });
}

if (ledgerRefreshBtn) {
  ledgerRefreshBtn.addEventListener('click', () => {
    ledgerRefreshBtn.disabled = true;
    ledgerRefreshBtn.textContent = '↺ Refreshing…';
    ledgerVisibleCount = LEDGER_PAGE_SIZE;
    if (isOperationsLanding() && publicLedgerBody) {
      renderPublicLedgerState('loading', 'Querying Optimism for new entries…');
    }
    GTPData.reloadActivity().then(() => {
      renderActivity();
      renderOperationsSnapshots();
    }).catch((err) => {
      console.warn('[app] Ledger refresh failed:', err);
    }).finally(() => {
      ledgerRefreshBtn.disabled = false;
      ledgerRefreshBtn.textContent = '↺ Refresh';
    });
  });
}
