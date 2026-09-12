import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterMap,
} from "parse5";
import {
  designContentSchema,
  type DesignContent,
  type DesignPage,
  type DesignPatch,
} from "@artemis/protocol";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const styles = new Set([
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "gap",
  "width",
  "height",
  "min-width",
  "max-width",
  "border-radius",
]);
export function designElements(node: Node): Element[] {
  const result: Element[] = [];
  const stack = [node];
  while (stack.length) {
    const current = stack.pop()!;
    if ("tagName" in current) result.push(current);
    if ("childNodes" in current)
      stack.push(...[...current.childNodes].reverse());
    if ("tagName" in current && current.tagName === "template")
      stack.push((current as DefaultTreeAdapterMap["template"]).content);
  }
  return result;
}
const attribute = (node: Element, name: string) =>
  node.attrs.find((item) => item.name === name)?.value;
const leaf = (node: Element) =>
  !["script", "style", "template", "textarea", "title"].includes(
    node.tagName,
  ) &&
  node.namespaceURI === "http://www.w3.org/1999/xhtml" &&
  node.childNodes.every((child) => child.nodeName === "#text");
function setAttribute(node: Element, name: string, value: string) {
  const existing = node.attrs.find((item) => item.name === name);
  if (existing) existing.value = value;
  else node.attrs.push({ name, value });
}
function tree(page: DesignPage) {
  if (Buffer.byteLength(page.html) > 2 * 1024 * 1024)
    throw new Error("Page source exceeds 2 MiB.");
  const document = parse(page.html, { sourceCodeLocationInfo: true });
  const nodes = designElements(document);
  const ids = new Map<string, Element>();
  for (const node of nodes) {
    const id = attribute(node, "data-design-id");
    if (id === undefined) continue;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || ids.has(id))
      throw new Error("Design IDs must be valid and unique within a page.");
    ids.set(id, node);
  }
  return { document, nodes, ids };
}
export function normalizeDesignContent(input: unknown): DesignContent {
  const content = designContentSchema.parse(input);
  const variantIds = new Set<string>();
  for (const variant of content.variants) {
    if (variantIds.has(variant.id)) throw new Error("Duplicate variant ID.");
    variantIds.add(variant.id);
    const pages = new Set<string>();
    for (const page of variant.pages) {
      if (pages.has(page.id)) throw new Error("Duplicate page ID.");
      pages.add(page.id);
      const names = new Set<string>();
      for (const parameter of page.parameters) {
        if (names.has(parameter.name))
          throw new Error("Duplicate parameter name.");
        names.add(parameter.name);
        if (
          parameter.kind !== "color" &&
          (parameter.min > parameter.max ||
            parameter.value < parameter.min ||
            parameter.value > parameter.max)
        )
          throw new Error("Parameter outside its declared range.");
      }
      page.html = serialize(tree(page).document);
      if (Buffer.byteLength(page.html) > 2 * 1024 * 1024)
        throw new Error("Normalized page exceeds 2 MiB.");
    }
  }
  if (Buffer.byteLength(JSON.stringify(content)) > 32 * 1024 * 1024)
    throw new Error("Revision exceeds 32 MiB.");
  return content;
}
export function designSourceMap(page: DesignPage) {
  return [...tree(page).ids].map(([id, node]) => ({
    id,
    parentId:
      node.parentNode && "tagName" in node.parentNode
        ? attribute(node.parentNode, "data-design-id")
        : undefined,
    tag: node.tagName,
    line: node.sourceCodeLocation?.startLine ?? 1,
    text: node.childNodes
      .filter((child) => child.nodeName === "#text")
      .map((child) => (child as DefaultTreeAdapterMap["textNode"]).value)
      .join(""),
    editable:
      leaf(node) &&
      attribute(node, "data-design-text") === "static" &&
      attribute(node, "data-design-owned") !== "script",
    container: attribute(node, "data-design-container") !== undefined,
    binding: attribute(node, "data-design-bind"),
  }));
}
export function patchDesignPage(
  page: DesignPage,
  patches: DesignPatch[],
): DesignPage {
  const next = structuredClone(page);
  const { document, ids } = tree(next);
  const staticNode = (id: string) => {
    const node = ids.get(id);
    if (!node || attribute(node, "data-design-owned") === "script")
      throw new Error(
        "Stale or script-owned element; use selection conversation instead.",
      );
    return node;
  };
  for (const patch of patches) {
    if (patch.type === "parameter") {
      const parameter = next.parameters.find(
        (item) => item.name === patch.name,
      );
      if (!parameter) throw new Error("Unknown parameter.");
      if (parameter.kind === "color") {
        if (
          typeof patch.value !== "string" ||
          !/^#[0-9a-fA-F]{6}$/.test(patch.value)
        )
          throw new Error("Invalid color.");
        parameter.value = patch.value;
      } else {
        if (
          typeof patch.value !== "number" ||
          !Number.isFinite(patch.value) ||
          patch.value < parameter.min ||
          patch.value > parameter.max
        )
          throw new Error("Parameter outside range.");
        parameter.value = patch.value;
      }
    } else if (patch.type === "binding") {
      if (
        !Object.hasOwn(next.data, patch.key) ||
        (typeof patch.value === "string" && patch.value.length > 65536) ||
        (typeof patch.value === "number" && !Number.isFinite(patch.value))
      )
        throw new Error("Unknown or invalid data binding.");
      next.data[patch.key] = patch.value;
    } else if (patch.type === "text") {
      const node = staticNode(patch.elementId);
      if (
        !leaf(node) ||
        attribute(node, "data-design-text") !== "static" ||
        attribute(node, "data-design-bind") !== undefined ||
        Buffer.byteLength(patch.text) > 65536
      )
        throw new Error("Text is not an independent static slot.");
      node.childNodes = [
        { nodeName: "#text", value: patch.text, parentNode: node },
      ];
    } else if (patch.type === "style") {
      const node = staticNode(patch.elementId);
      if (
        !styles.has(patch.property) ||
        patch.value.length > 128 ||
        !/^[#a-zA-Z0-9.%(),\s-]+$/.test(patch.value) ||
        /(?:url|expression|attr|var)\s*\(/i.test(patch.value)
      )
        throw new Error("Unsupported style value.");
      // A dedicated declaration per property avoids parsing arbitrary old CSS.
      const key = `data-design-style-${patch.property}`;
      setAttribute(node, key, patch.value);
    } else if (patch.type === "image") {
      const node = staticNode(patch.elementId);
      if (
        node.tagName !== "img" ||
        !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
          patch.dataUrl,
        ) ||
        patch.dataUrl.length > (4 * 1024 * 1024 * 4) / 3
      )
        throw new Error(
          "Only imported raster images can replace an image slot.",
        );
      setAttribute(node, "src", patch.dataUrl);
      node.attrs = node.attrs.filter(
        (item) => !["srcset", "sizes"].includes(item.name),
      );
    } else if (patch.type === "move") {
      const node = staticNode(patch.elementId);
      const parent = staticNode(patch.parentId);
      const original = node.parentNode;
      if (
        !original ||
        !("tagName" in original) ||
        attribute(original, "data-design-container") === undefined ||
        attribute(parent, "data-design-container") === undefined ||
        designElements(node).includes(parent) ||
        designElements(node).some((item) =>
          ["script", "style", "template"].includes(item.tagName),
        )
      )
        throw new Error(
          "Only static declared containers support structural moves.",
        );
      const before = patch.beforeId ? staticNode(patch.beforeId) : undefined;
      if (before && (before.parentNode !== parent || before === node))
        throw new Error("Stale insertion target.");
      original.childNodes = original.childNodes.filter(
        (child) => child !== node,
      );
      const index = before
        ? parent.childNodes.indexOf(before)
        : parent.childNodes.length;
      parent.childNodes.splice(index, 0, node);
      node.parentNode = parent;
    } else throw new Error("Unsupported design patch.");
  }
  next.html = serialize(document);
  tree(next);
  return next;
}
export function renderDesignPage(page: DesignPage, trustedHead = ""): string {
  const { document, nodes } = tree(page);
  if (trustedHead) {
    const head = nodes.find((node) => node.tagName === "head")!;
    const injected = parseFragment(trustedHead).childNodes;
    for (const node of injected) node.parentNode = head;
    head.childNodes.unshift(...injected);
  }
  for (const node of nodes) {
    const binding = attribute(node, "data-design-bind");
    if (binding !== undefined) {
      if (!leaf(node) || !Object.hasOwn(page.data, binding))
        throw new Error("Invalid leaf data binding.");
      node.childNodes = [
        {
          nodeName: "#text",
          value: String(page.data[binding]),
          parentNode: node,
        },
      ];
    }
    const overrides = node.attrs
      .filter((item) => item.name.startsWith("data-design-style-"))
      .map((item) => {
        const property = item.name.slice("data-design-style-".length);
        if (
          !styles.has(property) ||
          item.value.length > 128 ||
          !/^[#a-zA-Z0-9.%(),\s-]+$/.test(item.value) ||
          /(?:url|expression|attr|var)\s*\(/i.test(item.value)
        )
          throw new Error("Invalid style override.");
        return `${property}:${item.value} !important`;
      });
    if (overrides.length)
      setAttribute(
        node,
        "style",
        `${attribute(node, "style") ?? ""};${overrides.join(";")}`,
      );
  }
  const css = page.parameters
    .map(
      (item) =>
        `${item.name}:${item.value}${item.kind === "color" ? "" : item.unit};`,
    )
    .join("");
  return serialize(document).replace(
    "</head>",
    `<style>:root{${css}}</style></head>`,
  );
}
