const sections = [
  "Home Dashboard",
  "Projects",
  "Missions",
  "Map",
  "Resources",
  "Skills",
  "People",
  "Learning",
  "Town Hall",
  "Marketplace",
  "Music",
  "Messages",
  "Profile"
];

const sectionList = document.querySelector("#section-list");

if (sectionList) {
  const fragment = document.createDocumentFragment();

  sections.forEach((name) => {
    const item = document.createElement("li");
    item.textContent = name;
    fragment.appendChild(item);
  });

  sectionList.appendChild(fragment);
}

const themeToggle = document.querySelector("#theme-toggle");

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    document.documentElement.classList.toggle("light");
  });
}
