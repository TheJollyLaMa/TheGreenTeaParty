const projects = [
  {
    name: "Green Tea Hut",
    track: "Green Tea",
    stage: "active",
    raised: 7800,
    goal: 12000,
    lastUpdate: "2026-07-28",
    repoUrl: "https://github.com/TheJollyLaMa/GreenTeaHut_01",
    artizenUrl: "https://artizen.fund/project/green-tea-hut",
    stewards: 8
  },
  {
    name: "Blue Tea Watershed Lab",
    track: "Blue Tea",
    stage: "planning",
    raised: 2500,
    goal: 9000,
    lastUpdate: "2026-07-24",
    repoUrl: "https://github.com/TheJollyLaMa/BlueTeaWatershedLab_01",
    stewards: 4
  },
  {
    name: "Red Rice Commons Kitchen",
    track: "Red Rice",
    stage: "completed",
    raised: 15000,
    goal: 15000,
    lastUpdate: "2026-07-15",
    artizenUrl: "https://artizen.fund/project/red-rice-commons",
    stewards: 11
  }
];

const activity = [
  {
    type: "Contribution",
    title: "Anonymous donor supported Green Tea Hut",
    amount: 350,
    date: "2026-07-30"
  },
  {
    type: "Boost",
    title: "Blue Tea Watershed Lab received a project boost",
    date: "2026-07-29"
  },
  {
    type: "Milestone",
    title: "Red Rice Commons Kitchen completed buildout",
    date: "2026-07-21"
  },
  {
    type: "Steward Update",
    title: "Green Tea Hut posted logistics and volunteer notes",
    date: "2026-07-20"
  }
];

const availableFunds = 9200;

const metricsStrip = document.querySelector("#metrics-strip");
const projectGrid = document.querySelector("#project-grid");
const activityList = document.querySelector("#activity-list");
const trackFilter = document.querySelector("#track-filter");
const stageFilter = document.querySelector("#stage-filter");

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

  const totalRaised = projects.reduce((sum, project) => sum + project.raised, 0);
  const totalStewards = projects.reduce((sum, project) => sum + project.stewards, 0);
  const activeProjects = filteredProjects.filter((project) => project.stage === "active").length;

  const metricItems = [
    { label: "Total raised", value: formatCurrency(totalRaised) },
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

  const trackValue = trackFilter.value;
  const stageValue = stageFilter.value;

  const filteredProjects = projects.filter((project) => {
    const matchesTrack = trackValue === "all" || project.track === trackValue;
    const matchesStage = stageValue === "all" || project.stage === stageValue;
    return matchesTrack && matchesStage;
  });

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

      return `
        <li class="project-card">
          <h4 class="project-title">${project.name}</h4>
          <p class="project-meta">${project.track} · ${project.stage}</p>
          <p>${formatCurrency(project.raised)} / ${formatCurrency(project.goal)}</p>
          <p class="project-meta">Last update: ${project.lastUpdate}</p>
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

  const tracks = [...new Set(projects.map((project) => project.track))];
  const stages = [...new Set(projects.map((project) => project.stage))];

  tracks.forEach((track) => {
    trackFilter.insertAdjacentHTML("beforeend", `<option value="${track}">${track}</option>`);
  });

  stages.forEach((stage) => {
    stageFilter.insertAdjacentHTML(
      "beforeend",
      `<option value="${stage}">${stage.charAt(0).toUpperCase()}${stage.slice(1)}</option>`
    );
  });
};

populateFilters();
renderProjects();
renderActivity();

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
