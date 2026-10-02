const siteUrl = "https://github.com/stepupgaming/magenta-windows";
const repoUrl = "https://github.com/stepupgaming/magenta-windows";
const apiUrl = "https://api.github.com/repos/stepupgaming/magenta-windows";

export const siteConfig = {
  name: "Magenta",
  owner: "stepupgaming",
  headline: "Magenta RealTime 2 on Windows",
  description:
    "Live Magenta RealTime 2 on an NVIDIA PC. The Catalyzer desktop app drives the Windows CUDA renderer.",
  links: {
    website: siteUrl,
    github: repoUrl,
    issues: `${repoUrl}/issues`,
    discussions: `${repoUrl}/discussions`,
    releases: `${repoUrl}/releases/latest`,
    license: `${repoUrl}/blob/master/LICENSE`,
    changelog: `${repoUrl}/blob/master/CHANGELOG.md`,
    contributing: `${repoUrl}/blob/master/CONTRIBUTING.md`,
    githubApi: `${apiUrl}/releases?per_page=10`,
  },
};

export type SiteConfig = typeof siteConfig;
