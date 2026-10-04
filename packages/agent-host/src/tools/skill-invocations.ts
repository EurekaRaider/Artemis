import { readFile } from "node:fs/promises";

interface SkillInvocationResource {
  name: string;
  filePath: string;
  baseDir: string;
}

interface ParsedSkillInvocations {
  names: string[];
  remainder: string;
}

type SkillReader = (path: string) => Promise<string>;

export function parseLeadingSkillInvocations(
  text: string,
): ParsedSkillInvocations {
  const names: string[] = [];
  let remainder = text.trim();

  while (remainder.startsWith("/skill:")) {
    const match = /^\/skill:([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+|$)/u.exec(
      remainder,
    );
    if (!match?.[1]) break;
    names.push(match[1]);
    remainder = remainder.slice(match[0].length);
  }

  return { names, remainder };
}

function stripFrontmatter(content: string): string {
  const frontmatter =
    /^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/u.exec(
      content,
    );
  return (frontmatter ? content.slice(frontmatter[0].length) : content).trim();
}

export async function expandSkillInvocations(
  text: string,
  skills: readonly SkillInvocationResource[],
  readSkill: SkillReader = (path) => readFile(path, "utf8"),
): Promise<{ expanded: boolean; text: string }> {
  const parsed = parseLeadingSkillInvocations(text);
  if (parsed.names.length <= 1) {
    return { expanded: false, text };
  }

  const names = [...new Set(parsed.names)];
  const skillBlocks = await Promise.all(
    names.map(async (name) => {
      const skill = skills.find((candidate) => candidate.name === name);
      if (!skill) {
        throw new Error(`Selected Skill is unavailable: ${name}`);
      }
      const body = stripFrontmatter(await readSkill(skill.filePath));
      return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
    }),
  );
  return {
    expanded: true,
    text: parsed.remainder
      ? `${skillBlocks.join("\n\n")}\n\n${parsed.remainder}`
      : skillBlocks.join("\n\n"),
  };
}
