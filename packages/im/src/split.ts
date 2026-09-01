// 消息分片（证据 E13：[G] message_split.go:114 splitMessageBytes）
// 按 UTF-8 字节数切，不切断码点。
// #757 教训：飞书卡片 30KB 上限是 JSON 字节数；28000 个 rune 的 CJK 文本 ≈84KB，
// 按字符切必然超限——必须以字节为准。

const encoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * 把 text 切成若干段，每段 UTF-8 字节数 ≤ maxBytes。
 * 优先在换行/空格等边界切断；找不到边界时在码点边界硬切（用 for...of 迭代，
 * 不会切断 surrogate pair）。
 */
export function splitMessageBytes(text: string, maxBytes: number): string[] {
  if (maxBytes <= 0) throw new RangeError("maxBytes must be positive");
  if (utf8ByteLength(text) <= maxBytes) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (utf8ByteLength(remaining) > maxBytes) {
    const cut = findCutPoint(remaining, maxBytes);
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

/** 在 ≤maxBytes 字节范围内找最佳切断点（字符索引）。 */
function findCutPoint(text: string, maxBytes: number): number {
  // 先按码点走，记录不超过字节预算的最远字符索引
  let bytes = 0;
  let lastFitIndex = 0;
  let lastNewlineIndex = -1;
  let lastSpaceIndex = -1;
  let index = 0;
  for (const char of text) {
    const charBytes = utf8ByteLength(char);
    if (bytes + charBytes > maxBytes) break;
    bytes += charBytes;
    index += char.length;
    lastFitIndex = index;
    if (char === "\n") lastNewlineIndex = index;
    else if (char === " " || char === "\t") lastSpaceIndex = index;
  }
  if (lastFitIndex === 0) {
    // 单码点都放不下（maxBytes 小于 1–4 字节），防御性保底切 1 个码点
    const first = [...text][0];
    return first ? first.length : 1;
  }
  // 优先换行边界，其次空白边界；太靠前的边界（<一半）不采用，避免产生碎片
  const half = lastFitIndex / 2;
  if (lastNewlineIndex >= half) return lastNewlineIndex;
  if (lastSpaceIndex >= half) return lastSpaceIndex;
  return lastFitIndex;
}
