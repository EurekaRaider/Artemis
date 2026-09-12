import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import { designElements } from "./design-document-source.js";

const forbidden = new Set([
  "script",
  "link",
  "meta",
  "base",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "portal",
  "foreignObject",
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
]);
const urlAttributes = new Set([
  "href",
  "xlink:href",
  "srcset",
  "action",
  "formaction",
  "ping",
  "poster",
  "background",
  "data",
  "manifest",
]);
export function exportStaticDesign(html: string): string {
  if (Buffer.byteLength(html) > 2 * 1024 * 1024)
    throw new Error("Export source exceeds 2 MiB.");
  const document = parse(html);
  for (const node of designElements(document)) {
    if (forbidden.has(node.tagName)) {
      if (node.parentNode)
        node.parentNode.childNodes = node.parentNode.childNodes.filter(
          (child) => child !== node,
        );
      continue;
    }
    if (node.tagName === "form") node.tagName = "div";
    node.attrs = node.attrs.filter((attribute) => {
      if (
        attribute.name.startsWith("on") ||
        attribute.name.startsWith("data-design-") ||
        urlAttributes.has(attribute.name) ||
        ["autofocus", "contenteditable", "srcdoc", "is"].includes(
          attribute.name,
        )
      )
        return false;
      if (attribute.name === "src")
        return (
          node.tagName === "img" &&
          /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
            attribute.value,
          )
        );
      return true;
    });
    if (["input", "button", "select", "textarea"].includes(node.tagName))
      node.attrs.push({ name: "disabled", value: "" });
    // CSP remains the security boundary even for escaped CSS URLs. Remove the
    // common external-resource forms as defense in depth, without executing CSS.
    if (node.tagName === "style")
      for (const child of node.childNodes)
        if (child.nodeName === "#text") {
          const text = child as DefaultTreeAdapterMap["textNode"];
          text.value = text.value
            .replace(/@import[^;]*(?:;|$)/gi, "")
            .replace(/url\s*\([^)]*\)/gi, "none");
        }
  }
  const csp =
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
  const inner = serialize(document).replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta charset="utf-8">`,
  );
  const escaped = inner
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Design snapshot</title><style>html,body,iframe{width:100%;height:100%;border:0;margin:0}</style></head><body><iframe sandbox="" srcdoc="${escaped}" title="Static offline design"></iframe></body></html>`;
}
