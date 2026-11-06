export const MAX_MANIFEST_BYTES = 1024 * 1024;

export const MAX_MARKETPLACE_BYTES = 5 * 1024 * 1024;

export const MAX_MARKETPLACE_ARCHIVE_BYTES = 100 * 1024 * 1024;

export const MAX_MARKETPLACE_ARCHIVE_ENTRIES = 20_000;

export const MAX_MARKETPLACE_ARCHIVE_UNPACKED_BYTES = 500 * 1024 * 1024;

export const MAX_ICON_BYTES = 128 * 1024;

export const MAX_ICON_DIMENSION = 2_048;

export const MAX_ICON_PIXELS = 4_194_304;

export const MAX_MARKETPLACE_PLUGINS = 1_000;

export const MAX_USER_MARKETPLACES = 20;

export const MAX_PLUGIN_FILES = 2_500;

export const MAX_PLUGIN_FILE_BYTES = 50 * 1024 * 1024;

export const MAX_PLUGIN_BYTES = 200 * 1024 * 1024;

export const MAX_SKILL_FILES = 200;

export const MAX_SKILL_FILE_BYTES = 5 * 1024 * 1024;

export const MAX_SKILL_BYTES = 20 * 1024 * 1024;

export const BUNDLED_ARTIFACT_PLUGIN_NAMES = new Set([
  "documents",
  "pdf",
  "spreadsheets",
  "presentations",
]);

export const BUNDLED_ARTIFACT_MARKETPLACE_NAME = "artemis-bundled-artifacts";

export const BUNDLED_MARKETPLACE_ID = "bundled";

export const BUNDLED_MARKETPLACE_URL = "artemis-bundled://lite-v1";

export const LOCAL_MARKETPLACE_ID = "local";

export const OPENAI_MARKETPLACE_URL = "https://github.com/openai/plugins.git";

export const GITHUB_API = "https://api.github.com";

export const MAX_GITHUB_RATE_LIMIT_RETRY_MILLISECONDS = 15_000;
