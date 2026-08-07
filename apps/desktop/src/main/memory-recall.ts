interface MemoryEntry {
  heading: string;
  keywords: string[];
  text: string;
}

export interface MemoryRecallResult {
  context: string;
  selectedEntries: number;
  projectEntries: number;
  globalEntries: number;
  characters: number;
}

interface RecallLimits {
  maxEntries: number;
  maxCharacters: number;
  globalMaxEntries: number;
  globalMaxCharacters: number;
}

const COMMON_WORDS = new Set([
  "and",
  "current",
  "files",
  "finish",
  "for",
  "help",
  "project",
  "task",
  "the",
  "this",
  "with",
  "当前",
  "文件",
  "任务",
  "项目",
]);

function terms(value: string): Set<string> {
  const result = new Set<string>();
  for (const match of value
    .toLocaleLowerCase("en-US")
    .matchAll(/[\p{L}\p{N}][\p{L}\p{N}._/-]*/gu)) {
    const term = match[0];
    if (term.length >= 2 && !COMMON_WORDS.has(term)) result.add(term);
    if (/^[\p{Script=Han}]+$/u.test(term)) {
      for (let index = 0; index < term.length - 1; index += 1) {
        const pair = term.slice(index, index + 2);
        if (!COMMON_WORDS.has(pair)) result.add(pair);
      }
    }
  }
  return result;
}

function parseEntries(memory: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const matches = [
    ...memory.matchAll(/(?:^|\r?\n)## (.+)\r?\n([\s\S]*?)(?=\r?\n## |$)/gu),
  ];
  for (const match of matches) {
    const heading = match[1]?.trim();
    const body = match[2]?.trim();
    if (!heading || !body) continue;
    const lines = body.split(/\r?\n/u);
    const keywordLine = lines[0]?.match(/^Keywords:\s*(.+)$/iu);
    const keywordText = keywordLine?.[1];
    const keywords = keywordText
      ? keywordText
          .split(",")
          .map((keyword) => keyword.trim())
          .filter(Boolean)
      : [];
    const content = keywordLine ? lines.slice(1).join("\n").trim() : body;
    entries.push({
      heading,
      keywords,
      text: `## ${heading}\n${keywordLine ? `${lines[0]}\n\n` : ""}${content}`.trim(),
    });
  }
  return entries;
}

function scoreEntry(entry: MemoryEntry, promptTerms: Set<string>): number {
  const headingTerms = terms(entry.heading);
  const keywordTerms = terms(entry.keywords.join(" "));
  const bodyTerms = terms(entry.text);
  let score = 0;
  for (const term of promptTerms) {
    if (keywordTerms.has(term)) score += 8;
    else if (headingTerms.has(term)) score += 6;
    else if (bodyTerms.has(term)) score += 1;
  }
  return score;
}

function selectEntries(
  memory: string,
  promptTerms: Set<string>,
  maxEntries: number,
  maxCharacters: number,
  minimumScore: number,
): MemoryEntry[] {
  const selected: MemoryEntry[] = [];
  let characters = 0;
  const ranked = parseEntries(memory)
    .map((entry, index) => ({
      entry,
      index,
      score: scoreEntry(entry, promptTerms),
    }))
    .filter((candidate) => candidate.score >= minimumScore)
    .sort(
      (left, right) => right.score - left.score || left.index - right.index,
    );
  for (const candidate of ranked) {
    if (selected.length >= maxEntries) break;
    const addition = candidate.entry.text.length + (selected.length ? 2 : 0);
    if (characters + addition > maxCharacters) continue;
    selected.push(candidate.entry);
    characters += addition;
  }
  return selected;
}

export function recallMemoryForTurn(input: {
  prompt: string;
  projectMemory: string;
  globalMemory: string;
  limits: RecallLimits;
}): MemoryRecallResult {
  const promptTerms = terms(input.prompt);
  const project = selectEntries(
    input.projectMemory,
    promptTerms,
    input.limits.maxEntries,
    input.limits.maxCharacters,
    12,
  );
  const projectContext = project.map((entry) => entry.text).join("\n\n");
  const remainingCharacters =
    input.limits.maxCharacters -
    projectContext.length -
    (projectContext ? 2 : 0);
  const global = selectEntries(
    input.globalMemory,
    promptTerms,
    input.limits.globalMaxEntries,
    Math.min(
      input.limits.globalMaxCharacters,
      Math.max(0, remainingCharacters),
    ),
    18,
  );
  const context = [...project, ...global]
    .map((entry) => entry.text)
    .join("\n\n");
  return {
    context,
    selectedEntries: project.length + global.length,
    projectEntries: project.length,
    globalEntries: global.length,
    characters: context.length,
  };
}
