import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Share message keys across locale tables without changing their public shape. */
export function desktopLocaleOptimization() {
  const directory = fileURLToPath(
    new URL("../../apps/desktop/src/shared/i18n/ui-locales/", import.meta.url),
  ).replaceAll("\\", "/");
  const keys = Object.keys(
    JSON.parse(readFileSync(`${directory}en.json`, "utf8")),
  );
  const virtualId = "virtual:artemis-ui-message-keys";
  const resolvedId = `\0${virtualId}`;
  return {
    name: "artemis-desktop-locale-optimization",
    apply: "build",
    enforce: "post",
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id) {
      if (id === resolvedId) return `export default ${JSON.stringify(keys)};`;
    },
    transform(_code, id) {
      const path = id.replaceAll("\\", "/");
      if (!path.startsWith(directory) || !path.endsWith(".json")) return;
      const messages = JSON.parse(readFileSync(path, "utf8"));
      if (
        Object.keys(messages).length !== keys.length ||
        keys.some((key) => typeof messages[key] !== "string")
      )
        this.error(`Locale message keys do not match English: ${path}`);
      return {
        code: `import keys from ${JSON.stringify(virtualId)};
const values = ${JSON.stringify(keys.map((key) => messages[key]))};
export default Object.fromEntries(keys.map((key, index) => [key, values[index]]));`,
        map: null,
      };
    },
  };
}
