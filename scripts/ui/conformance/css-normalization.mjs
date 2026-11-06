export const canonical = (value) => JSON.stringify(value);

export const normalizeWhitespace = (value) =>
  value.replace(/\s+/gu, " ").trim();

export const normalizeSelector = (value) =>
  normalizeWhitespace(value)
    .replace(/\s*,\s*/gu, ", ")
    .replace(/\(\s+/gu, "(")
    .replace(/\s+\)/gu, ")");

export const normalizeValue = (value) =>
  normalizeWhitespace(value)
    .replace(/\s*,\s*/gu, ", ")
    .replace(/\(\s+/gu, "(")
    .replace(/\s+\)/gu, ")");
