// Settings -> About: where the framework lives. The concept site and the
// public repositories, as plain data so the About page and its contract
// test read one list. Public names and public homes only.

export const FRAMEWORK_NAME = "Evo Framework";
export const FRAMEWORK_SITE = "https://evoframework.org";
export const PUBLIC_REPOSITORY_HOME = "https://github.com/foonerd/";

export interface PublicRepository {
  name: string;
  provides: string;
  url: string;
}

function repo(name: string, provides: string): PublicRepository {
  return { name, provides, url: PUBLIC_REPOSITORY_HOME + name };
}

export const PUBLIC_REPOSITORIES: ReadonlyArray<PublicRepository> = [
  repo("evo-core", "The framework"),
  repo("evo-ui", "The operator glass and its runtime"),
  repo("evo-device-audio", "The audio player distribution and its plugins"),
  repo("evo-device-audio-ui", "The audio player's glass surfaces"),
  repo("evo-kiosk", "The kiosk on the player's own screen"),
  repo("evo-catalogue-schemas", "The shelf contracts a plugin author implements")
];
