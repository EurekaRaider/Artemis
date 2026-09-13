/**
 * Provider-independent estimate, not a tokenizer or UTF-8 byte count.
 * ASCII uses the usual four-characters-per-token approximation; non-ASCII
 * uses one token per BMP character and two per supplementary code point.
 * Actual provider usage remains authoritative. Keep this shared by previews,
 * request budgets and attachment pagination so their units agree.
 */
function tokenQuarters(character: string): number {
  return character.charCodeAt(0) <= 0x7f ? 1 : character.length * 4;
}

export function estimateTextTokens(text: string): number {
  let quarters = 0;
  for (const character of text) quarters += tokenQuarters(character);
  return Math.ceil(quarters / 4);
}

/** UTF-16 offsets can resume this prefix without splitting a surrogate pair. */
export function textWithinTokenBudget(
  text: string,
  maxTokens: number,
  fromEnd = false,
): string {
  const limit = Math.max(0, Math.floor(maxTokens)) * 4;
  let quarters = 0;
  if (fromEnd) {
    let start = text.length;
    while (start > 0) {
      const last = text.charCodeAt(start - 1);
      const previous = text.charCodeAt(start - 2);
      const width =
        last >= 0xdc00 &&
        last <= 0xdfff &&
        previous >= 0xd800 &&
        previous <= 0xdbff
          ? 2
          : 1;
      quarters += tokenQuarters(text.slice(start - width, start));
      if (quarters > limit) break;
      start -= width;
    }
    return text.slice(start);
  }
  let end = 0;
  for (const character of text) {
    quarters += tokenQuarters(character);
    if (quarters > limit) break;
    end += character.length;
  }
  return text.slice(0, end);
}
