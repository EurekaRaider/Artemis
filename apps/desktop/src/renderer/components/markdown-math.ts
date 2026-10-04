import type { TokenizerAndRendererExtension } from "marked";

// Encoded source survives the HTML sanitizer even when it contains arrows or <.
const escape = (value: string) => encodeURIComponent(value.toWellFormed());

/** Tokenize before Markdown escapes, never inside code spans or fenced code. */
export const timelineMathExtensions: TokenizerAndRendererExtension[] = [
  {
    name: "timelineMathBlock",
    level: "block",
    start: (source) => source.search(/\$\$|\\\[/u),
    tokenizer(source) {
      const match = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:\n|$)/u.exec(
        source,
      );
      if (match)
        return {
          type: "timelineMathBlock",
          raw: match[0],
          text: (match[1] ?? match[2] ?? "").trim(),
        };
      return undefined;
    },
    renderer: (token) =>
      `<span data-math-source="${escape(String(token.text))}" data-math-display="true"></span>`,
  },
  {
    name: "timelineMathInline",
    level: "inline",
    start: (source) => source.search(/\$|\\\(/u),
    tokenizer(source) {
      const match =
        /^(?:\\\(([^\n]+?)\\\)|\$((?:\\.|[^\\$\n])+?)\$(?!\d))/u.exec(source);
      const text = match?.[1] ?? match?.[2];
      if (match && text && text.trim() === text)
        return { type: "timelineMathInline", raw: match[0], text };
      return undefined;
    },
    renderer: (token) =>
      `<span data-math-source="${escape(String(token.text))}"></span>`,
  },
];
