import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export interface DesignParameter {
  name: string;
  min: number;
  max: number;
  value: number;
  unit: "px" | "";
}

export interface DesignSource {
  html: string;
  parameters: DesignParameter[];
}

export type DesignSourcePatch =
  | { type: "text"; elementId: string; text: string }
  | { type: "parameter"; name: string; value: number };

function elements(node: Node): Element[] {
  const children = "childNodes" in node ? node.childNodes : [];
  return [
    ...("tagName" in node ? [node] : []),
    ...children.flatMap(elements),
    ...("tagName" in node && node.tagName === "template"
      ? elements((node as DefaultTreeAdapterMap["template"]).content)
      : []),
  ];
}

/** Source owns edits; no runtime DOM is ever passed to this function. */
export function patchDesignSource(
  source: DesignSource,
  patches: readonly DesignSourcePatch[],
): DesignSource {
  if (Buffer.byteLength(source.html, "utf8") > 2 * 1024 * 1024)
    throw new Error("Design page exceeds 2 MiB.");
  if (source.parameters.length > 128)
    throw new Error("Design page exceeds 128 parameter declarations.");
  const document = parse(source.html);
  const nodes = elements(document);
  const ids = new Map<string, Element>();
  for (const node of nodes) {
    const id = node.attrs.find(
      (attribute) => attribute.name === "data-design-id",
    )?.value;
    if (id === undefined) continue;
    if (!id || ids.has(id))
      throw new Error("Design element IDs must be unique and nonempty.");
    ids.set(id, node);
  }
  const parameters = structuredClone(source.parameters);
  const names = new Set<string>();
  for (const parameter of parameters) {
    if (
      !/^--design-[a-z][a-z0-9-]{0,63}$/.test(parameter.name) ||
      names.has(parameter.name) ||
      ![parameter.min, parameter.max, parameter.value].every(Number.isFinite) ||
      parameter.min > parameter.max ||
      parameter.value < parameter.min ||
      parameter.value > parameter.max ||
      !["px", ""].includes(parameter.unit)
    )
      throw new Error("Invalid design parameter declaration.");
    names.add(parameter.name);
  }
  for (const patch of patches) {
    if (patch.type === "parameter") {
      const parameter = parameters.find((item) => item.name === patch.name);
      if (
        !parameter ||
        !Number.isFinite(patch.value) ||
        patch.value < parameter.min ||
        patch.value > parameter.max
      )
        throw new Error("Design parameter is missing or out of range.");
      parameter.value = patch.value;
    } else if (patch.type === "text") {
      const node = ids.get(patch.elementId);
      if (
        !node ||
        !node.attrs.some(
          (attribute) =>
            attribute.name === "data-design-text" &&
            attribute.value === "static",
        ) ||
        ["script", "style", "template", "textarea", "title"].includes(
          node.tagName,
        ) ||
        node.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
        node.childNodes.some((child) => child.nodeName !== "#text")
      )
        throw new Error(
          "Design text slot is stale or not independently editable.",
        );
      if (Buffer.byteLength(patch.text, "utf8") > 64 * 1024)
        throw new Error("Design text exceeds 64 KiB.");
      node.childNodes = [
        { nodeName: "#text", value: patch.text, parentNode: node },
      ];
    } else throw new Error("Unsupported design patch.");
  }
  const html = serialize(document);
  if (Buffer.byteLength(html, "utf8") > 2 * 1024 * 1024)
    throw new Error("Design page exceeds 2 MiB.");
  return { html, parameters };
}

/** Numeric values and fixed units cannot introduce URL or script expressions. */
export function designParameterCss(source: DesignSource): string {
  const normalized = patchDesignSource(source, []);
  return `:root{${normalized.parameters.map((parameter) => `${parameter.name}:${parameter.value}${parameter.unit};`).join("")}}`;
}
