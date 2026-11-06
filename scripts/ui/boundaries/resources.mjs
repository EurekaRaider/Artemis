import { readFile, realpath } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { parse as parseCssValue, walk as walkCssValue } from "css-tree";
import { parse as parseHtml } from "parse5";
import postcss from "postcss";
import { SyntaxKind, createScanner } from "typescript/unstable/ast";

export function pathInside(path, directory) {
  const normalizedPath = resolve(path).toLowerCase();
  const normalizedDirectory = resolve(directory).toLowerCase();
  return (
    normalizedPath === normalizedDirectory ||
    normalizedPath.startsWith(`${normalizedDirectory}${sep}`)
  );
}

export function htmlElements(source) {
  const document = parseHtml(source);
  const elements = [];
  const visit = (node) => {
    if (Array.isArray(node.attrs)) {
      elements.push({
        attributes: Object.fromEntries(
          node.attrs.map((entry) => [entry.name, entry.value]),
        ),
        content: (node.childNodes ?? [])
          .filter((child) => child.nodeName === "#text")
          .map((child) => child.value ?? "")
          .join(""),
        tagName: node.tagName,
      });
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content !== undefined) visit(node.content);
  };
  visit(document);
  return elements;
}

export function scriptTokens(source) {
  const scanner = createScanner(true, undefined, source);
  const tokens = [];
  const templateBraceDepth = [];
  for (
    let kind = scanner.scan();
    kind !== SyntaxKind.EndOfFile;
    kind = scanner.scan()
  ) {
    if (kind === SyntaxKind.CloseBraceToken && templateBraceDepth.length > 0) {
      const templateIndex = templateBraceDepth.length - 1;
      if (templateBraceDepth[templateIndex] === 0) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === SyntaxKind.TemplateTail) templateBraceDepth.pop();
      } else {
        templateBraceDepth[templateIndex] -= 1;
      }
    } else if (
      kind === SyntaxKind.OpenBraceToken &&
      templateBraceDepth.length > 0
    ) {
      templateBraceDepth[templateBraceDepth.length - 1] += 1;
    } else if (kind === SyntaxKind.TemplateHead) {
      templateBraceDepth.push(0);
    }
    tokens.push({
      kind,
      value: scanner.getTokenValue(),
    });
    if (scanner.isUnterminated()) {
      return { invalid: true, tokens };
    }
  }
  return { invalid: false, tokens };
}

export function staticScriptString(token) {
  return token?.kind === SyntaxKind.StringLiteral ||
    token?.kind === SyntaxKind.NoSubstitutionTemplateLiteral
    ? token.value
    : undefined;
}

export function scriptModuleReferences(source) {
  const result = scriptTokens(source);
  const references = [];
  let computed = false;
  const { tokens } = result;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind === SyntaxKind.ImportKeyword) {
      if (tokens[index + 1]?.kind === SyntaxKind.DotToken) continue;
      if (tokens[index + 1]?.kind === SyntaxKind.OpenParenToken) {
        const reference = staticScriptString(tokens[index + 2]);
        if (
          reference === undefined ||
          tokens[index + 3]?.kind !== SyntaxKind.CloseParenToken
        ) {
          computed = true;
        } else {
          references.push(reference);
        }
        continue;
      }
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        if (tokens[cursor].kind === SyntaxKind.SemicolonToken) break;
        const reference = staticScriptString(tokens[cursor]);
        if (reference !== undefined) {
          references.push(reference);
          break;
        }
      }
      continue;
    }
    if (token.kind === SyntaxKind.ExportKeyword) {
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        if (tokens[cursor].kind === SyntaxKind.SemicolonToken) break;
        if (tokens[cursor].kind !== SyntaxKind.FromKeyword) continue;
        const reference = staticScriptString(tokens[cursor + 1]);
        if (reference === undefined) computed = true;
        else references.push(reference);
        break;
      }
      continue;
    }
    if (
      token.kind === SyntaxKind.RequireKeyword &&
      tokens[index + 1]?.kind === SyntaxKind.OpenParenToken
    ) {
      const reference = staticScriptString(tokens[index + 2]);
      if (
        reference === undefined ||
        tokens[index + 3]?.kind !== SyntaxKind.CloseParenToken
      ) {
        computed = true;
      } else {
        references.push(reference);
      }
    }
  }
  return { computed, invalid: result.invalid, references };
}

export const JAVASCRIPT_MIME_ESSENCES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

export function scriptIsExecutable(attributes) {
  const type = attributes.type?.trim().toLowerCase();
  return (
    type === undefined ||
    type === "" ||
    type === "module" ||
    JAVASCRIPT_MIME_ESSENCES.has(type.split(";", 1)[0]?.trim() ?? "")
  );
}

export function htmlInlineResources(source, from) {
  const scripts = [];
  const styles = [];
  for (const element of htmlElements(source)) {
    if (
      element.tagName === "script" &&
      element.attributes.src === undefined &&
      scriptIsExecutable(element.attributes) &&
      element.content.length > 0
    ) {
      scripts.push({
        content: element.content,
        ...scriptModuleReferences(element.content),
      });
    }
    if (
      element.tagName === "style" &&
      (element.attributes.type === undefined ||
        element.attributes.type.trim().toLowerCase() === "text/css") &&
      element.content.length > 0
    ) {
      styles.push({
        content: element.content,
        references: cssResourceReferences(element.content, from),
      });
    }
    const styleAttribute = element.attributes.style;
    if (styleAttribute !== undefined) {
      const content = `.artemis-inline-style { ${styleAttribute} }`;
      styles.push({
        content,
        references: cssResourceReferences(content, from),
      });
    }
  }
  return { scripts, styles };
}

export function htmlResourceReferences(source) {
  const references = [];
  for (const element of htmlElements(source)) {
    for (const [name, value] of Object.entries(element.attributes)) {
      const attribute = { name, value };
      if (attribute.name === "src" || attribute.name === "href") {
        references.push({
          attribute: attribute.name,
          attributes: element.attributes,
          reference: attribute.value,
          tagName: element.tagName,
        });
      } else if (attribute.name === "srcset") {
        for (const candidate of attribute.value.split(",")) {
          const reference = candidate.trim().split(/\s+/u)[0];
          if (reference !== undefined && reference.length > 0) {
            references.push({
              attribute: attribute.name,
              attributes: element.attributes,
              reference,
              tagName: element.tagName,
            });
          }
        }
      }
    }
  }
  return references;
}

export function cssValueReferences(value, importPrelude) {
  const references = [];
  const ast = parseCssValue(
    value,
    importPrelude
      ? { context: "atrulePrelude", atrule: "import" }
      : { context: "value" },
  );
  walkCssValue(ast, {
    enter(node) {
      const containingFunction = this.function?.name?.toLowerCase();
      const imageSetString =
        node.type === "String" &&
        (containingFunction === "image-set" ||
          containingFunction === "-webkit-image-set");
      if (
        node.type === "Url" ||
        (node.type === "String" && importPrelude) ||
        imageSetString
      ) {
        references.push(node.value);
      }
    },
  });
  return references;
}

export function cssResourceReferences(source, from) {
  const parsed = postcss.parse(source, { from });
  const references = [];
  parsed.walkAtRules("import", (rule) => {
    references.push(...cssValueReferences(rule.params, true));
  });
  parsed.walkDecls((declaration) => {
    references.push(...cssValueReferences(declaration.value, false));
  });
  return references;
}

export function localReferenceTarget(root, from, reference) {
  const trimmed = reference.trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(trimmed)
  ) {
    return undefined;
  }
  const withoutQuery = trimmed.split(/[?#]/u)[0];
  if (withoutQuery === undefined || withoutQuery.length === 0) return undefined;
  return withoutQuery.startsWith("/")
    ? resolve(root, "apps/desktop", `.${withoutQuery}`)
    : resolve(dirname(from), withoutQuery);
}

export async function referenceTargetsGallery(root, from, reference) {
  const target = localReferenceTarget(root, from, reference);
  if (target === undefined) return false;
  const galleryRoot = join(root, "apps/ui-gallery");
  return (
    pathInside(target, galleryRoot) ||
    (await realPathInside(target, galleryRoot))
  );
}

export async function inspectDesktopResourceFile(root, file) {
  const source = await readFile(file, "utf8");
  const isCss = extname(file) === ".css";
  const inline = isCss ? undefined : htmlInlineResources(source, file);
  const references = isCss
    ? cssResourceReferences(source, file).map((reference) => ({
        attribute: "CSS reference",
        reference,
      }))
    : [
        ...htmlResourceReferences(source),
        ...(inline?.styles ?? []).flatMap((style) =>
          style.references.map((reference) => ({
            attribute: "inline CSS reference",
            reference,
          })),
        ),
        ...(inline?.scripts ?? []).flatMap((script) =>
          script.references.map((reference) => ({
            attribute: "inline script module reference",
            reference,
          })),
        ),
      ];
  const violations = [];
  if (
    inline?.scripts.some((script) => script.computed || script.invalid) === true
  ) {
    violations.push(
      `${relative(root, file)}: Desktop inline script module references must be static`,
    );
  }
  for (const { attribute, reference } of references) {
    if (
      reference === "@artemis/ui/conformance" ||
      (await referenceTargetsGallery(root, file, reference))
    ) {
      violations.push(
        `${relative(root, file)}: Desktop ${attribute} must not reference UI Gallery: ${reference}`,
      );
    }
  }
  return violations;
}

export async function realPathInside(path, directory) {
  try {
    return pathInside(await realpath(path), await realpath(directory));
  } catch {
    return false;
  }
}

export function pathPatternCapture(pattern, specifier) {
  const wildcard = pattern.indexOf("*");
  if (wildcard === -1) return pattern === specifier ? "" : undefined;
  const prefix = pattern.slice(0, wildcard);
  const suffix = pattern.slice(wildcard + 1);
  if (
    !specifier.startsWith(prefix) ||
    !specifier.endsWith(suffix) ||
    specifier.length < prefix.length + suffix.length
  ) {
    return undefined;
  }
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

export async function pathsAliasTargetsGallery(
  project,
  specifier,
  galleryRoot,
) {
  const { baseUrl, paths, pathsBasePath } = project.compilerOptions;
  if (paths === undefined || typeof paths !== "object") return false;
  const base =
    typeof pathsBasePath === "string"
      ? pathsBasePath
      : typeof baseUrl === "string"
        ? baseUrl
        : dirname(project.configFileName);
  for (const [pattern, substitutions] of Object.entries(paths)) {
    const capture = pathPatternCapture(pattern, specifier);
    if (capture === undefined || !Array.isArray(substitutions)) continue;
    for (const substitution of substitutions) {
      if (typeof substitution !== "string") continue;
      const expanded = substitution.replace("*", capture);
      const target = isAbsolute(expanded) ? expanded : resolve(base, expanded);
      if (
        pathInside(target, galleryRoot) ||
        (await realPathInside(target, galleryRoot))
      ) {
        return true;
      }
    }
  }
  return false;
}
