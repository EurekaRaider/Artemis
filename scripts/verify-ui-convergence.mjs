import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postcss from "postcss";
import { API } from "typescript/unstable/sync";
import {
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  isTemplateExpression,
} from "typescript/unstable/ast";

import { collectTypeScriptReferences } from "./verify-ui-boundaries.mjs";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const CLASS_SELECTOR = /\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/gu;
const CLASS_TOKEN = /-?[_a-zA-Z]+[_a-zA-Z0-9-]*/gu;
const GOVERNED_SPACING_PROPERTY =
  /^(?:gap|row-gap|column-gap|margin(?:-.+)?|padding(?:-.+)?|inset(?:-.+)?|top|right|bottom|left|scroll-margin(?:-.+)?|border-radius|outline-offset|z-index)$/u;
const GOVERNED_COLOR_PROPERTY =
  /^(?:color|background(?:-color)?|border(?:-.+)?|box-shadow|outline(?:-color)?)$/u;
const SAFE_KEYWORDS = new Set([
  "auto",
  "currentcolor",
  "inherit",
  "initial",
  "none",
  "normal",
  "revert",
  "transparent",
  "unset",
]);

function normalize(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function pathInside(path, directory) {
  const candidate = resolve(path);
  const parent = resolve(directory);
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path)));
    else files.push(path);
  }
  return files;
}

function literalClassTokens(sourceFile) {
  const classes = new Set();
  const add = (value) => {
    for (const match of value.matchAll(CLASS_TOKEN)) classes.add(match[0]);
  };
  const visit = (node) => {
    if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) {
      add(node.text);
    } else if (isTemplateExpression(node)) {
      add(node.head.text);
      for (const span of node.templateSpans) add(span.literal.text);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return classes;
}

function createSourceAnalysis(root, files) {
  const api = new API({ cwd: root });
  const snapshot = api.updateSnapshot({ openFiles: files });
  const results = new Map();
  try {
    for (const file of files) {
      const project = snapshot.getDefaultProjectForFile(file);
      const sourceFile = project?.program.getSourceFile(file);
      if (sourceFile === undefined) {
        throw new Error(`TypeScript could not analyze ${relative(root, file)}`);
      }
      results.set(file, {
        classes: literalClassTokens(sourceFile),
        references: collectTypeScriptReferences(sourceFile),
      });
    }
  } catch (error) {
    snapshot.dispose();
    api.close();
    throw error;
  }
  return {
    close() {
      snapshot.dispose();
      api.close();
    },
    results,
  };
}

function selectorClasses(css) {
  const classes = new Map();
  css.walkRules((rule) => {
    for (const match of rule.selector.matchAll(CLASS_SELECTOR)) {
      if (!classes.has(match[1])) {
        classes.set(match[1], rule.source?.start?.line);
      }
    }
  });
  return classes;
}

function atRuleContext(node) {
  const context = [];
  for (
    let current = node.parent;
    current !== undefined;
    current = current.parent
  ) {
    if (current.type === "atrule") {
      context.unshift(
        normalize(
          `@${current.name}${current.params ? ` ${current.params}` : ""}`,
        ),
      );
    }
  }
  return context;
}

function rawOverrideKey(override) {
  return JSON.stringify([
    override.atRules.map(normalize),
    normalize(override.selector),
    override.property.trim().toLowerCase(),
    normalize(override.value),
  ]);
}

function valueNeedsRegistration(value) {
  const normalized = normalize(value).toLowerCase();
  if (normalized.includes("var(") || SAFE_KEYWORDS.has(normalized))
    return false;
  const terms = normalized.split(/\s+|\//u).filter(Boolean);
  return !(
    terms.length > 0 && terms.every((term) => /^0(?:[a-z]+|%)?$/u.test(term))
  );
}

function rawComponentOverrides(css) {
  const overrides = [];
  css.walkRules((rule) => {
    if (!rule.selector.includes("[data-artemis-component")) return;
    rule.walkDecls((declaration) => {
      const property = declaration.prop.trim().toLowerCase();
      if (
        !GOVERNED_SPACING_PROPERTY.test(property) &&
        !GOVERNED_COLOR_PROPERTY.test(property)
      ) {
        return;
      }
      if (!valueNeedsRegistration(declaration.value)) return;
      overrides.push({
        atRules: atRuleContext(rule),
        selector: normalize(rule.selector),
        property,
        value: normalize(declaration.value),
        line: declaration.source?.start?.line,
      });
    });
  });
  return overrides;
}

async function loadContract(root, violations) {
  try {
    const contract = JSON.parse(
      await readFile(
        join(root, "scripts/ui-convergence-contract.json"),
        "utf8",
      ),
    );
    if (
      !Array.isArray(contract.dynamicClassConsumers) ||
      !Array.isArray(contract.rawComponentOverrides)
    ) {
      throw new Error("contract arrays are required");
    }
    return contract;
  } catch (error) {
    violations.push(`scripts/ui-convergence-contract.json: ${String(error)}`);
    return { dynamicClassConsumers: [], rawComponentOverrides: [] };
  }
}

async function inspectContract(root, contract, cssClasses) {
  const violations = [];
  const dynamicClasses = new Set();
  for (const entry of contract.dynamicClassConsumers) {
    if (
      !Array.isArray(entry.classes) ||
      entry.classes.length === 0 ||
      !Array.isArray(entry.sources) ||
      entry.sources.length === 0 ||
      typeof entry.owner !== "string" ||
      entry.owner.trim() === "" ||
      typeof entry.reason !== "string" ||
      entry.reason.trim() === ""
    ) {
      violations.push(
        "dynamic class registration requires classes, sources, owner, and reason",
      );
      continue;
    }
    for (const name of entry.classes) {
      if (
        typeof name !== "string" ||
        !/^[-_a-zA-Z][-_a-zA-Z0-9]*$/u.test(name)
      ) {
        violations.push(`invalid dynamic class registration: ${String(name)}`);
        continue;
      }
      if (dynamicClasses.has(name))
        violations.push(`duplicate dynamic class registration: .${name}`);
      dynamicClasses.add(name);
      if (!cssClasses.has(name))
        violations.push(`stale dynamic class registration: .${name}`);
    }
    for (const source of entry.sources) {
      const sourcePath = resolve(root, source.path ?? "");
      if (
        typeof source.path !== "string" ||
        typeof source.contains !== "string" ||
        source.contains === "" ||
        !pathInside(sourcePath, root)
      ) {
        violations.push(
          `invalid dynamic class source for ${entry.classes.join(", ")}`,
        );
        continue;
      }
      try {
        const content = await readFile(sourcePath, "utf8");
        if (!content.includes(source.contains)) {
          violations.push(
            `${source.path}: dynamic class evidence drifted for ${entry.classes.join(", ")}`,
          );
        }
      } catch {
        violations.push(
          `${source.path}: dynamic class evidence source cannot be read`,
        );
      }
    }
  }

  const registeredOverrides = new Map();
  for (const entry of contract.rawComponentOverrides) {
    if (
      !Array.isArray(entry.atRules) ||
      typeof entry.selector !== "string" ||
      typeof entry.property !== "string" ||
      typeof entry.value !== "string" ||
      typeof entry.owner !== "string" ||
      entry.owner.trim() === "" ||
      typeof entry.reason !== "string" ||
      entry.reason.trim() === ""
    ) {
      violations.push(
        "raw component override registration requires an exact declaration, owner, and reason",
      );
      continue;
    }
    const key = rawOverrideKey(entry);
    if (registeredOverrides.has(key))
      violations.push(
        `duplicate raw component override registration: ${entry.selector}`,
      );
    registeredOverrides.set(key, entry);
  }
  return { dynamicClasses, registeredOverrides, violations };
}

function scriptCandidates(path) {
  const extension = extname(path);
  const stem = SCRIPT_EXTENSIONS.has(extension)
    ? path.slice(0, -extension.length)
    : path;
  return [
    ...(SCRIPT_EXTENSIONS.has(extension) ? [path] : []),
    ...[".ts", ".tsx", ".js", ".jsx"].map((candidate) => `${stem}${candidate}`),
    ...[".ts", ".tsx", ".js", ".jsx"].map((candidate) =>
      join(path, `index${candidate}`),
    ),
  ];
}

function resolveRendererReference(from, specifier, filesByPath) {
  if (!specifier.startsWith(".") || specifier.endsWith(".css"))
    return undefined;
  for (const candidate of scriptCandidates(resolve(dirname(from), specifier))) {
    if (filesByPath.has(resolve(candidate))) return resolve(candidate);
  }
  return undefined;
}

function rendererReachabilityViolations(root, files, analysis) {
  const filesByPath = new Set(files);
  const entry = resolve(root, "apps/desktop/src/renderer/main.tsx");
  if (!filesByPath.has(entry)) return ["renderer entry main.tsx is missing"];
  const reachable = new Set();
  const pending = [entry];
  const violations = [];
  while (pending.length > 0) {
    const file = pending.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    const facts = analysis.get(file)?.references;
    if (facts === undefined) {
      violations.push(
        `${relative(root, file)}: renderer source analysis is missing`,
      );
      continue;
    }
    if (facts.computedDynamicImports.length > 0) {
      violations.push(
        `${relative(root, file)}: renderer imports must remain statically auditable`,
      );
    }
    for (const { specifier } of facts.moduleReferences) {
      const target = resolveRendererReference(file, specifier, filesByPath);
      if (target !== undefined && !reachable.has(target)) pending.push(target);
    }
  }
  for (const file of files) {
    if (!reachable.has(file)) {
      violations.push(
        `${relative(root, file)}: production renderer module is unreachable from main.tsx`,
      );
    }
  }
  return violations;
}

export async function verifyUiConvergence(root = defaultRoot) {
  const violations = [];
  const cssPath = join(root, "apps/desktop/src/renderer/styles.css");
  const css = postcss.parse(await readFile(cssPath, "utf8"), { from: cssPath });
  const cssClasses = selectorClasses(css);
  const contract = await loadContract(root, violations);
  const registration = await inspectContract(root, contract, cssClasses);
  violations.push(...registration.violations);

  const rendererFiles = (
    await filesBelow(join(root, "apps/desktop/src/renderer"))
  )
    .filter(
      (file) => SCRIPT_EXTENSIONS.has(extname(file)) && !file.endsWith(".d.ts"),
    )
    .map((file) => resolve(file));
  const uiFiles = (await filesBelow(join(root, "packages/ui/src")))
    .filter(
      (file) => SCRIPT_EXTENSIONS.has(extname(file)) && !file.endsWith(".d.ts"),
    )
    .map((file) => resolve(file));
  const analysis = createSourceAnalysis(root, [...rendererFiles, ...uiFiles]);
  try {
    const literalConsumers = new Set();
    for (const { classes } of analysis.results.values()) {
      for (const name of classes) literalConsumers.add(name);
    }
    for (const [name, line] of cssClasses) {
      if (
        !literalConsumers.has(name) &&
        !registration.dynamicClasses.has(name)
      ) {
        violations.push(
          `apps/desktop/src/renderer/styles.css:${String(line ?? "?")}: .${name} has no production class consumer`,
        );
      }
    }
    for (const name of registration.dynamicClasses) {
      if (literalConsumers.has(name))
        violations.push(
          `.${name}: dynamic class registration is no longer needed`,
        );
    }

    const actualOverrides = new Map();
    for (const override of rawComponentOverrides(css)) {
      const key = rawOverrideKey(override);
      actualOverrides.set(key, override);
      if (!registration.registeredOverrides.has(key)) {
        violations.push(
          `apps/desktop/src/renderer/styles.css:${String(override.line ?? "?")}: unregistered raw public-component override ${override.selector} { ${override.property}: ${override.value} }`,
        );
      }
    }
    for (const [key, entry] of registration.registeredOverrides) {
      if (!actualOverrides.has(key)) {
        violations.push(
          `stale raw component override registration: ${normalize(entry.selector)} { ${entry.property}: ${entry.value} }`,
        );
      }
    }
    violations.push(
      ...rendererReachabilityViolations(root, rendererFiles, analysis.results),
    );
  } finally {
    analysis.close();
  }
  return violations;
}

async function main() {
  const rootIndex = process.argv.indexOf("--root");
  const root =
    rootIndex === -1 ? defaultRoot : resolve(process.argv[rootIndex + 1] ?? "");
  const violations = await verifyUiConvergence(root);
  if (violations.length > 0) {
    console.error(
      ["UI convergence verification failed:", ...violations].join("\n"),
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    "UI convergence verification passed (all Desktop selectors consumed; dynamic classes and raw public-component overrides exactly registered; renderer graph fully reachable)",
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
