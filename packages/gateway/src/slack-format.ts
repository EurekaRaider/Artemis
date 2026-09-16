import { Lexer, type Token, type Tokens } from "marked";
import { splitImText } from "./channels.js";

const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Render CommonMark/GFM into Slack's smaller mrkdwn vocabulary. Never render raw HTML or mentions. */
export function formatSlackMarkdown(
  markdown: string,
  plainText: (text: string) => string = (text) => text,
): string {
  const render = (tokens: Token[]): string =>
    tokens
      .map((token) => {
        const children = () =>
          render("tokens" in token ? (token.tokens ?? []) : []);
        switch (token.type) {
          case "space":
            return "\n\n";
          case "paragraph":
            return `${children()}\n\n`;
          case "heading":
            return `*${children().replace(/^\*|\*$/gu, "")}*\n\n`;
          case "strong":
            return `*${children()}*`;
          case "em":
            return `_${children()}_`;
          case "del":
            return `~${children()}~`;
          case "codespan":
            return `\`${escape(token.text)}\``;
          case "code":
            return `\`\`\`\n${escape(token.text)}\n\`\`\`\n\n`;
          case "br":
            return "\n";
          case "hr":
            return "────────\n\n";
          case "blockquote":
            return (
              children()
                .trimEnd()
                .split("\n")
                .map((line) => `> ${line}`)
                .join("\n") + "\n\n"
            );
          case "list":
            return (
              (token as Tokens.List).items
                .map((item, index) => {
                  const prefix = item.task
                    ? item.checked
                      ? "☑"
                      : "☐"
                    : token.ordered
                      ? `${Number(token.start) + index}.`
                      : "•";
                  return `${prefix} ${render(item.tokens).trimEnd().replaceAll("\n", "\n  ")}`;
                })
                .join("\n") + "\n\n"
            );
          case "table": {
            const table = token as Tokens.Table;
            return (
              table.rows
                .map((row) =>
                  row
                    .map(
                      (cell, index) =>
                        `• *${render(table.header[index]?.tokens ?? []).trim()}*: ${render(cell.tokens).trim()}`,
                    )
                    .join("\n"),
                )
                .join("\n\n") + "\n\n"
            );
          }
          case "link":
          case "image": {
            const label = escape(plainText(token.text)).replaceAll("|", "｜");
            const href = String(token.href);
            return /^(?:https?:\/\/|mailto:)/iu.test(href) &&
              !/[<>|\s]/u.test(href)
              ? `<${escape(href)}|${label}>`
              : label;
          }
          case "def":
            return "";
          default:
            return "tokens" in token && token.tokens
              ? children()
              : escape(
                  plainText(String("text" in token ? token.text : token.raw)),
                );
        }
      })
      .join("");
  return render(Lexer.lex(markdown, { gfm: true })).trimEnd();
}

/** Keep table rows and code fences intact before the delivery queue assigns chunk IDs. */
export function splitSlackMarkdown(
  markdown: string,
  maxBytes = 3500,
): string[] {
  const pieces: string[] = [];
  for (const token of Lexer.lex(markdown, { gfm: true })) {
    if (Buffer.byteLength(token.raw) <= maxBytes) pieces.push(token.raw);
    else if (token.type === "code") {
      pieces.push(
        ...splitImText(token.text, maxBytes - 10).map(
          (text) => `\`\`\`\n${text}\n\`\`\`\n`,
        ),
      );
    } else if (token.type === "table") {
      const lines = token.raw.trimEnd().split("\n");
      const header = lines.slice(0, 2).join("\n") + "\n";
      if (
        Buffer.byteLength(header) < maxBytes / 2 &&
        lines
          .slice(2)
          .every((line) => Buffer.byteLength(header + line + "\n") <= maxBytes)
      ) {
        let part = header;
        for (const line of lines.slice(2)) {
          if (Buffer.byteLength(part + line + "\n") > maxBytes) {
            pieces.push(part);
            part = header;
          }
          part += line + "\n";
        }
        pieces.push(part);
      } else pieces.push(...splitImText(token.raw, maxBytes));
    } else pieces.push(...splitImText(token.raw, maxBytes));
  }
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && Buffer.byteLength(current + piece) > maxBytes) {
      chunks.push(current);
      current = "";
    }
    current += piece;
  }
  if (current) chunks.push(current);
  return chunks;
}
