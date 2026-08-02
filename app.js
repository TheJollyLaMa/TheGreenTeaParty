/* global GTPData, GTPKpi, GTPModeRouter, GTPAppState */

const metricsStrip = document.querySelector('#metrics-strip');
const projectGrid = document.querySelector('#project-grid');
const activityList = document.querySelector('#activity-list');
const trackFilter = document.querySelector('#track-filter');
const stageFilter = document.querySelector('#stage-filter');
const kpiPanel = document.querySelector('#kpi-panel');
const modeBadge = document.querySelector('#mode-badge');
const appStatePanel = document.querySelector('#app-state-panel');

const modeInfo = GTPModeRouter.getModeInfo(window.location);

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);

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
    <p class="app-state-meta">Wallet: ${state.walletStatus}</p>
    <p class="app-state-meta">Network: ${state.chainId || 'not selected'}</p>
    <p class="app-state-meta">Profile: ${state.profilePresent ? 'present' : 'missing'}</p>
    ${readiness.ready ? '' : `<p class="app-state-warning">${readiness.reason}</p>`}
  `;
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
