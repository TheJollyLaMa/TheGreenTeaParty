/* global GTPData, GTPKpi */

const availableFunds = 9200;

const metricsStrip = document.querySelector("#metrics-strip");
const projectGrid = document.querySelector("#project-grid");
const activityList = document.querySelector("#activity-list");
const trackFilter = document.querySelector("#track-filter");
const stageFilter = document.querySelector("#stage-filter");
const kpiPanel = document.querySelector("#kpi-panel");

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);

const updateMetrics = (filteredProjects) => {
  if (!metricsStrip) {
    return;
  }

  const allProjects = GTPData.getProjects();
  const totals = GTPData.getTotals(allProjects);
  const totalStewards = allProjects.reduce((sum, project) => sum + project.stewards, 0);
  const activeProjects = filteredProjects.filter((project) => project.status === "active").length;

  const metricItems = [
    { label: "Total raised", value: formatCurrency(totals.raised) },
    { label: "Available funds", value: formatCurrency(availableFunds) },
    { label: "Active projects", value: String(activeProjects) },
    { label: "Contributors / stewards", value: String(totalStewards) }
  ];

  metricsStrip.innerHTML = metricItems
    .map(
      (item) =>
        `<li class="metric-card"><div class="metric-label">${item.label}</div><p class="metric-value">${item.value}</p></li>`
    )
    .join("");
};

const renderProjects = () => {
  if (!projectGrid || !trackFilter || !stageFilter) {
    return;
  }

  // Keep data-layer filter state in sync
  GTPData.setFilter("track", trackFilter.value);
  GTPData.setFilter("status", stageFilter.value);

  const filteredProjects = GTPData.filterProjects();

  updateMetrics(filteredProjects);

  if (filteredProjects.length === 0) {
    projectGrid.innerHTML =
      '<li class="project-card"><p class="project-meta">No projects match this filter yet.</p></li>';
    return;
  }

  projectGrid.innerHTML = filteredProjects
    .map((project) => {
      const links = [
        project.repoUrl ? `<a href="${project.repoUrl}" target="_blank" rel="noreferrer">Repo</a>` : "",
        project.artizenUrl ? `<a href="${project.artizenUrl}" target="_blank" rel="noreferrer">Artizen</a>` : ""
      ]
        .filter(Boolean)
        .join("");

      const nextActionHtml = project.nextAction
        ? `<p class="project-meta">Next: ${project.nextAction}</p>`
        : "";

      return `
        <li class="project-card">
          <h4 class="project-title">${project.name}</h4>
          <p class="project-meta">${project.track} · ${project.status}</p>
          <p>${formatCurrency(project.raised)} / ${formatCurrency(project.goal)}</p>
          <p class="project-meta">Last update: ${project.lastUpdate}</p>
          ${nextActionHtml}
          ${links ? `<div class="project-links">${links}</div>` : ""}
        </li>
      `;
    })
    .join("");
};

const renderActivity = () => {
  if (!activityList) {
    return;
  }

  const activity = GTPData.getActivity();

  if (!activity.length) {
    activityList.innerHTML =
      '<li class="activity-item"><p class="activity-meta">No activity recorded yet.</p></li>';
    return;
  }

  activityList.innerHTML = activity
    .map((entry) => {
      const amount = typeof entry.amount === "number" ? ` · ${formatCurrency(entry.amount)}` : "";
      return `
        <li class="activity-item">
          <strong>${entry.type}</strong>
          <p>${entry.title}${amount}</p>
          <p class="activity-meta">${entry.date}</p>
        </li>
      `;
    })
    .join("");
};

const populateFilters = () => {
  if (!trackFilter || !stageFilter) {
    return;
  }

  const { tracks, statuses } = GTPData.getFilterOptions();

  tracks.forEach((track) => {
    trackFilter.insertAdjacentHTML("beforeend", `<option value="${track}">${track}</option>`);
  });

  statuses.forEach((status) => {
    stageFilter.insertAdjacentHTML(
      "beforeend",
      `<option value="${status}">${status.charAt(0).toUpperCase()}${status.slice(1)}</option>`
    );
  });
};

// Initialise once the data layer is ready
GTPData.load().then(() => {
  populateFilters();
  renderProjects();
  renderActivity();
  if (kpiPanel) GTPKpi.render(kpiPanel);
}).catch((err) => {
  console.error("[app] Failed to load data:", err);
  if (projectGrid) {
    projectGrid.innerHTML =
      '<li class="project-card"><p class="project-meta">Could not load project data. Check the console for details.</p></li>';
  }
});

if (trackFilter) {
  trackFilter.addEventListener("change", renderProjects);
}

if (stageFilter) {
  stageFilter.addEventListener("change", renderProjects);
}

const themeToggle = document.querySelector("#theme-toggle");

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    document.documentElement.classList.toggle("light");
  });
}

