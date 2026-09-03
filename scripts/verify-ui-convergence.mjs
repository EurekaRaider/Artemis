import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postcss from "postcss";
import { API } from "typescript/unstable/sync";
import {
  isArrayLiteralExpression,
  isAsExpression,
  isBinaryExpression,
  isCallExpression,
  isConditionalExpression,
  isFalseLiteral,
  isIdentifier,
  isJsxAttribute,
  isJsxExpression,
  isNoSubstitutionTemplateLiteral,
  isNonNullExpression,
  isNullLiteral,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isSatisfiesExpression,
  isStringLiteral,
  isTemplateExpression,
  isTrueLiteral,
  isVariableDeclaration,
  SyntaxKind,
} from "typescript/unstable/ast";

import { collectTypeScriptReferences } from "./verify-ui-boundaries.mjs";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const CLASS_NAME = /^-?[_a-zA-Z]+[_a-zA-Z0-9-]*$/u;
const DATA_SELECTOR = /\[(data-[-_a-zA-Z0-9]+)/gu;
const ID_SELECTOR = /#(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/gu;
const DYNAMIC_START = "\u0001";
const DYNAMIC_END = "\u0002";
const UNKNOWN_FRAGMENT = "\u0000";
const MAX_CLASS_EXPANSIONS = 512;
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

function combineExpansions(left, right, separator = "") {
  const values = [];
  for (const prefix of left) {
    for (const suffix of right) {
      values.push(`${prefix}${separator}${suffix}`);
      if (values.length >= MAX_CLASS_EXPANSIONS) {
        return [`${DYNAMIC_START}${UNKNOWN_FRAGMENT}${DYNAMIC_END}`];
      }
    }
  }
  return [...new Set(values)];
}

function finiteStringExpansions(checker, node) {
  const type = checker.getTypeAtLocation(node);
  const candidates = type.isUnionType() ? type.getTypes() : [type];
  if (
    candidates.length === 0 ||
    candidates.length > MAX_CLASS_EXPANSIONS ||
    candidates.some((candidate) => !candidate.isStringLiteralType())
  ) {
    return undefined;
  }
  return [
    ...new Set(
      candidates.map(
        (candidate) => `${DYNAMIC_START}${candidate.value}${DYNAMIC_END}`,
      ),
    ),
  ];
}

function arrayJoinExpansions(node, checker, separator) {
  let expression = node;
  if (
    isCallExpression(expression) &&
    isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "filter"
  ) {
    expression = expression.expression.expression;
  }
  if (!isArrayLiteralExpression(expression)) return undefined;
  let values = [""];
  for (const element of expression.elements) {
    values = combineExpansions(
      values,
      classExpressionExpansions(element, checker),
      separator,
    );
  }
  return values;
}

function classExpressionExpansions(node, checker) {
  if (node === undefined) return [""];
  if (isJsxExpression(node)) {
    return classExpressionExpansions(node.expression, checker);
  }
  if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }
  if (
    isParenthesizedExpression(node) ||
    isAsExpression(node) ||
    isSatisfiesExpression(node) ||
    isNonNullExpression(node)
  ) {
    return classExpressionExpansions(node.expression, checker);
  }
  if (
    isFalseLiteral(node) ||
    isTrueLiteral(node) ||
    isNullLiteral(node) ||
    (isIdentifier(node) && node.text === "undefined")
  ) {
    return [""];
  }
  if (isTemplateExpression(node)) {
    let values = [node.head.text];
    for (const span of node.templateSpans) {
      values = combineExpansions(
        values,
        classExpressionExpansions(span.expression, checker),
      ).map((value) => `${value}${span.literal.text}`);
    }
    return values;
  }
  if (isConditionalExpression(node)) {
    return [
      ...new Set([
        ...classExpressionExpansions(node.whenTrue, checker),
        ...classExpressionExpansions(node.whenFalse, checker),
      ]),
    ];
  }
  if (isBinaryExpression(node)) {
    if (node.operatorToken.kind === SyntaxKind.PlusToken) {
      return combineExpansions(
        classExpressionExpansions(node.left, checker),
        classExpressionExpansions(node.right, checker),
      );
    }
    if (node.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken) {
      return ["", ...classExpressionExpansions(node.right, checker)];
    }
    if (
      node.operatorToken.kind === SyntaxKind.BarBarToken ||
      node.operatorToken.kind === SyntaxKind.QuestionQuestionToken
    ) {
      const finite = finiteStringExpansions(checker, node);
      if (finite !== undefined) return finite;
      return [
        ...new Set([
          ...classExpressionExpansions(node.left, checker),
          ...classExpressionExpansions(node.right, checker),
        ]),
      ];
    }
  }
  if (isCallExpression(node)) {
    if (isIdentifier(node.expression) && node.expression.text === "classes") {
      let values = [""];
      for (const argument of node.arguments) {
        values = combineExpansions(
          values,
          classExpressionExpansions(argument, checker),
          " ",
        );
      }
      return values;
    }
    if (
      isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "join"
    ) {
      const separator = isStringLiteral(node.arguments[0])
        ? node.arguments[0].text
        : " ";
      const values = arrayJoinExpansions(
        node.expression.expression,
        checker,
        separator,
      );
      if (values !== undefined) return values;
    }
  }
  return (
    finiteStringExpansions(checker, node) ?? [
      `${DYNAMIC_START}${UNKNOWN_FRAGMENT}${DYNAMIC_END}`,
    ]
  );
}

function classConsumer(expansion) {
  const classes = new Set();
  const dynamicClasses = new Set();
  for (const rawToken of expansion.trim().split(/\s+/u).filter(Boolean)) {
    if (rawToken.includes(UNKNOWN_FRAGMENT)) continue;
    const dynamic = rawToken.includes(DYNAMIC_START);
    const token = rawToken
      .replaceAll(DYNAMIC_START, "")
      .replaceAll(DYNAMIC_END, "");
    if (!CLASS_NAME.test(token)) continue;
    classes.add(token);
    if (dynamic) dynamicClasses.add(token);
  }
  return { classes, dynamicClasses };
}

function dataAttributeFromDatasetProperty(name) {
  return `data-${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;
}

function sourceConsumers(sourceFile, checker) {
  const classConsumers = [];
  const dataAttributes = new Set();
  const ids = new Set();
  const addClassExpansion = (expansion) => {
    const consumer = classConsumer(expansion);
    if (consumer.classes.size > 0) classConsumers.push(consumer);
  };
  const addClasses = (node) => {
    for (const expansion of classExpressionExpansions(node, checker)) {
      addClassExpansion(expansion);
    }
  };
  const addAttribute = (name, initializer) => {
    if (name === "className") addClasses(initializer);
    else if (name === "id") {
      for (const expansion of classExpressionExpansions(initializer, checker)) {
        if (!expansion.includes(UNKNOWN_FRAGMENT) && expansion.trim()) {
          ids.add(
            expansion
              .replaceAll(DYNAMIC_START, "")
              .replaceAll(DYNAMIC_END, "")
              .trim(),
          );
        }
      }
    } else if (name.startsWith("data-")) dataAttributes.add(name);
  };
  const addMarkup = (value) => {
    for (const match of value.matchAll(/\bclass\s*=\s*["']([^"']+)["']/gu)) {
      addClassExpansion(match[1]);
    }
    for (const match of value.matchAll(/\bid\s*=\s*["']([^"']+)["']/gu)) {
      ids.add(match[1]);
    }
    for (const match of value.matchAll(/\b(data-[-_a-zA-Z0-9]+)(?=\s|=)/gu)) {
      dataAttributes.add(match[1]);
    }
  };
  const visit = (node) => {
    if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) {
      addMarkup(node.text);
    } else if (isTemplateExpression(node)) {
      addMarkup(node.head.text);
      for (const span of node.templateSpans) addMarkup(span.literal.text);
    }
    if (isJsxAttribute(node) && isIdentifier(node.name)) {
      addAttribute(node.name.text, node.initializer);
    } else if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.name.text === "className" &&
      node.initializer !== undefined
    ) {
      addClasses(node.initializer);
    } else if (
      isPropertyAssignment(node) &&
      isIdentifier(node.name) &&
      node.name.text === "className"
    ) {
      addClasses(node.initializer);
    } else if (
      isBinaryExpression(node) &&
      node.operatorToken.kind === SyntaxKind.EqualsToken &&
      isPropertyAccessExpression(node.left)
    ) {
      if (node.left.name.text === "className") addClasses(node.right);
      if (
        isPropertyAccessExpression(node.left.expression) &&
        node.left.expression.name.text === "dataset"
      ) {
        dataAttributes.add(
          dataAttributeFromDatasetProperty(node.left.name.text),
        );
      }
    } else if (
      isCallExpression(node) &&
      isPropertyAccessExpression(node.expression)
    ) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      if (
        (method === "add" || method === "toggle" || method === "replace") &&
        isPropertyAccessExpression(receiver) &&
        receiver.name.text === "classList"
      ) {
        const literalArguments = node.arguments.filter((argument) =>
          isStringLiteral(argument),
        );
        if (method === "replace") {
          for (const argument of literalArguments) {
            addClassExpansion(argument.text);
          }
        } else {
          addClassExpansion(
            literalArguments.map((argument) => argument.text).join(" "),
          );
        }
      }
      if (
        method === "setAttribute" &&
        node.arguments[0] !== undefined &&
        isStringLiteral(node.arguments[0])
      ) {
        const name = node.arguments[0].text;
        if (name === "class") addClasses(node.arguments[1]);
        else addAttribute(name, node.arguments[1]);
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  const deduplicated = new Map();
  for (const consumer of classConsumers) {
    const key = JSON.stringify([
      [...consumer.classes].sort(),
      [...consumer.dynamicClasses].sort(),
    ]);
    deduplicated.set(key, consumer);
  }
  return {
    classConsumers: [...deduplicated.values()],
    dataAttributes,
    ids,
  };
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
      const consumers = sourceConsumers(sourceFile, project.checker);
      results.set(file, {
        ...consumers,
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

function selectorClassSets(selector) {
  const sets = [];
  const scan = (value) => {
    let current = [];
    const flush = () => {
      if (current.length > 0) sets.push([...new Set(current)]);
      current = [];
    };
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (character === "[") {
        let quote;
        for (index += 1; index < value.length; index += 1) {
          const candidate = value[index];
          if (quote !== undefined) {
            if (candidate === quote && value[index - 1] !== "\\") {
              quote = undefined;
            }
          } else if (candidate === '"' || candidate === "'") quote = candidate;
          else if (candidate === "]") break;
        }
        continue;
      }
      if (character === "(") {
        let depth = 1;
        let quote;
        const start = index + 1;
        for (index += 1; index < value.length && depth > 0; index += 1) {
          const candidate = value[index];
          if (quote !== undefined) {
            if (candidate === quote && value[index - 1] !== "\\") {
              quote = undefined;
            }
          } else if (candidate === '"' || candidate === "'") quote = candidate;
          else if (candidate === "(") depth += 1;
          else if (candidate === ")") depth -= 1;
        }
        scan(value.slice(start, Math.max(start, index - 1)));
        index -= 1;
        continue;
      }
      if (/\s|[>+~,]/u.test(character)) {
        flush();
        continue;
      }
      if (character !== ".") continue;
      const match = value
        .slice(index + 1)
        .match(/^-?[_a-zA-Z]+[_a-zA-Z0-9-]*/u);
      if (match === null) continue;
      current.push(match[0]);
      index += match[0].length;
    }
    flush();
  };
  scan(selector);
  return sets;
}

function selectorFacts(css) {
  const classRequirements = new Map();
  const dataAttributes = new Map();
  const ids = new Map();
  css.walkRules((rule) => {
    for (const classes of selectorClassSets(rule.selector)) {
      const key = JSON.stringify([...new Set(classes)].sort());
      if (!classRequirements.has(key)) {
        classRequirements.set(key, {
          classes: new Set(classes),
          line: rule.source?.start?.line,
          selector: `.${classes.join(".")}`,
        });
      }
    }
    for (const match of rule.selector.matchAll(DATA_SELECTOR)) {
      if (!dataAttributes.has(match[1])) {
        dataAttributes.set(match[1], rule.source?.start?.line);
      }
    }
    for (const match of rule.selector.matchAll(ID_SELECTOR)) {
      if (!ids.has(match[1])) ids.set(match[1], rule.source?.start?.line);
    }
  });
  return { classRequirements, dataAttributes, ids };
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
    override.important === true,
  ]);
}

function valueNeedsRegistration(value, property) {
  const normalized = normalize(value).toLowerCase();
  if (SAFE_KEYWORDS.has(normalized)) return false;
  for (const match of normalized.matchAll(
    /-?(?:\d+\.?\d*|\.\d+)(?:%|[a-z]+)/gu,
  )) {
    if (Number.parseFloat(match[0]) !== 0) return true;
  }
  if (property === "z-index") {
    for (const match of normalized.matchAll(
      /(?<![-_a-z0-9.])-?(?:\d+\.?\d*|\.\d+)(?![-_a-z0-9.])/gu,
    )) {
      if (Number.parseFloat(match[0]) !== 0) return true;
    }
  }
  if (/#[\da-f]{3,8}\b|\b(?:rgb|hsl|hwb|lab|lch|color)\(/u.test(normalized)) {
    return true;
  }
  if (normalized.includes("var(")) return false;
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
      if (!valueNeedsRegistration(declaration.value, property)) return;
      overrides.push({
        atRules: atRuleContext(rule),
        selector: normalize(rule.selector),
        property,
        value: normalize(declaration.value),
        important: declaration.important,
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

function classSetKey(classes) {
  return JSON.stringify([...classes].sort());
}

function classRequirementMatches(requirement, consumer) {
  return [...requirement.classes].every((name) => consumer.classes.has(name));
}

function dynamicClassRequirementMatches(requirement, consumer) {
  return (
    classRequirementMatches(requirement, consumer) &&
    [...requirement.classes].some((name) => consumer.dynamicClasses.has(name))
  );
}

async function inspectContract(
  root,
  contract,
  classRequirements,
  classConsumers,
) {
  const violations = [];
  const registeredClassNameSets = new Map();
  for (const entry of contract.dynamicClassConsumers) {
    if (
      !Array.isArray(entry.classNameSets) ||
      entry.classNameSets.length === 0 ||
      !Array.isArray(entry.sources) ||
      entry.sources.length === 0 ||
      typeof entry.owner !== "string" ||
      entry.owner.trim() === "" ||
      typeof entry.reason !== "string" ||
      entry.reason.trim() === ""
    ) {
      violations.push(
        "dynamic class registration requires classNameSets, sources, owner, and reason",
      );
      continue;
    }
    const label = entry.classNameSets
      .map((names) =>
        Array.isArray(names) ? `.${names.join(".")}` : String(names),
      )
      .join(", ");
    for (const names of entry.classNameSets) {
      if (
        !Array.isArray(names) ||
        names.length === 0 ||
        new Set(names).size !== names.length ||
        names.some((name) => typeof name !== "string" || !CLASS_NAME.test(name))
      ) {
        violations.push(`invalid dynamic class-name set: ${String(names)}`);
        continue;
      }
      const key = classSetKey(names);
      if (registeredClassNameSets.has(key)) {
        violations.push(
          `duplicate dynamic class-name set registration: .${names.join(".")}`,
        );
      }
      registeredClassNameSets.set(key, entry);
      const requirement = classRequirements.get(key);
      if (requirement === undefined) {
        violations.push(
          `stale dynamic class-name set registration: .${names.join(".")}`,
        );
      } else if (
        !classConsumers.some((consumer) =>
          dynamicClassRequirementMatches(requirement, consumer),
        ) &&
        !names.every((name) =>
          classConsumers.some((consumer) => consumer.classes.has(name)),
        )
      ) {
        violations.push(
          `.${names.join(".")}: registered class-name set has no runtime-generated or composed consumer`,
        );
      }
    }
    for (const source of entry.sources) {
      const sourcePath = resolve(root, source.path ?? "");
      if (
        typeof source.path !== "string" ||
        typeof source.contains !== "string" ||
        source.contains === "" ||
        !pathInside(sourcePath, root)
      ) {
        violations.push(`invalid dynamic class source for ${label}`);
        continue;
      }
      try {
        const content = await readFile(sourcePath, "utf8");
        if (!content.includes(source.contains)) {
          violations.push(
            `${source.path}: dynamic class evidence drifted for ${label}`,
          );
        }
      } catch {
        violations.push(
          `${source.path}: dynamic class evidence source cannot be read for ${label}`,
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
      typeof entry.important !== "boolean" ||
      typeof entry.owner !== "string" ||
      entry.owner.trim() === "" ||
      typeof entry.reason !== "string" ||
      entry.reason.trim() === ""
    ) {
      violations.push(
        "raw component override registration requires an exact declaration including important, owner, and reason",
      );
      continue;
    }
    const key = rawOverrideKey(entry);
    if (registeredOverrides.has(key)) {
      violations.push(
        `duplicate raw component override registration: ${entry.selector}`,
      );
    }
    registeredOverrides.set(key, entry);
  }
  return { registeredClassNameSets, registeredOverrides, violations };
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
  const selectors = selectorFacts(css);
  const contract = await loadContract(root, violations);

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
    const classConsumers = [];
    const dataAttributes = new Set();
    const ids = new Set();
    for (const facts of analysis.results.values()) {
      classConsumers.push(...facts.classConsumers);
      for (const name of facts.dataAttributes) dataAttributes.add(name);
      for (const name of facts.ids) ids.add(name);
    }
    const html = await readFile(join(root, "apps/desktop/index.html"), "utf8");
    for (const match of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gu)) {
      ids.add(match[1]);
    }
    for (const match of html.matchAll(/\b(data-[-_a-zA-Z0-9]+)(?=\s|=)/gu)) {
      dataAttributes.add(match[1]);
    }

    const registration = await inspectContract(
      root,
      contract,
      selectors.classRequirements,
      classConsumers,
    );
    violations.push(...registration.violations);

    for (const [key, requirement] of selectors.classRequirements) {
      const matchingConsumers = classConsumers.filter((consumer) =>
        classRequirementMatches(requirement, consumer),
      );
      if (matchingConsumers.length === 0) {
        if (!registration.registeredClassNameSets.has(key)) {
          violations.push(
            `apps/desktop/src/renderer/styles.css:${String(requirement.line ?? "?")}: ${requirement.selector} has no production className consumer`,
          );
        }
        continue;
      }
      if (
        !matchingConsumers.some(
          (consumer) =>
            ![...requirement.classes].some((name) =>
              consumer.dynamicClasses.has(name),
            ),
        ) &&
        !registration.registeredClassNameSets.has(key)
      ) {
        violations.push(
          `apps/desktop/src/renderer/styles.css:${String(requirement.line ?? "?")}: ${requirement.selector} has an unregistered runtime-generated className combination`,
        );
      }
    }
    for (const [name, line] of selectors.dataAttributes) {
      if (!dataAttributes.has(name)) {
        violations.push(
          `apps/desktop/src/renderer/styles.css:${String(line ?? "?")}: [${name}] has no production data-attribute consumer`,
        );
      }
    }
    for (const [name, line] of selectors.ids) {
      if (!ids.has(name)) {
        violations.push(
          `apps/desktop/src/renderer/styles.css:${String(line ?? "?")}: #${name} has no production id consumer`,
        );
      }
    }

    const actualOverrides = new Map();
    for (const override of rawComponentOverrides(css)) {
      const key = rawOverrideKey(override);
      actualOverrides.set(key, override);
      if (!registration.registeredOverrides.has(key)) {
        violations.push(
          `apps/desktop/src/renderer/styles.css:${String(override.line ?? "?")}: unregistered raw public-component override ${override.selector} { ${override.property}: ${override.value}${override.important ? " !important" : ""} }`,
        );
      }
    }
    for (const [key, entry] of registration.registeredOverrides) {
      if (!actualOverrides.has(key)) {
        violations.push(
          `stale raw component override registration: ${normalize(entry.selector)} { ${entry.property}: ${entry.value}${entry.important ? " !important" : ""} }`,
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
    "UI convergence verification passed (Desktop className combinations, IDs, and data attributes consumed; runtime-generated class sets and raw public-component overrides exactly registered; renderer graph fully reachable)",
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
