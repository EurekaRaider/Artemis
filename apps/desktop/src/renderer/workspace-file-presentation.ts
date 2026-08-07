export interface WorkspaceFilePresentation {
  type: string;
  language: string;
}

const presentations = new Map<string, WorkspaceFilePresentation>([
  [".ts", { type: "typescript", language: "typescript" }],
  [".tsx", { type: "react", language: "typescript" }],
  [".js", { type: "javascript", language: "javascript" }],
  [".jsx", { type: "react", language: "javascript" }],
  [".json", { type: "json", language: "json" }],
  [".md", { type: "markdown", language: "markdown" }],
  [".markdown", { type: "markdown", language: "markdown" }],
  [".css", { type: "css", language: "css" }],
  [".scss", { type: "css", language: "css" }],
  [".html", { type: "html", language: "html" }],
  [".htm", { type: "html", language: "html" }],
  [".ps1", { type: "powershell", language: "powershell" }],
  [".sh", { type: "shell", language: "shell" }],
  [".c", { type: "c", language: "c" }],
  [".h", { type: "c", language: "c" }],
  [".cc", { type: "cpp", language: "cpp" }],
  [".cpp", { type: "cpp", language: "cpp" }],
  [".cxx", { type: "cpp", language: "cpp" }],
  [".hh", { type: "cpp", language: "cpp" }],
  [".hpp", { type: "cpp", language: "cpp" }],
  [".hxx", { type: "cpp", language: "cpp" }],
  [".py", { type: "python", language: "python" }],
  [".cs", { type: "csharp", language: "csharp" }],
  [".xml", { type: "markup", language: "xml" }],
  [".yml", { type: "yaml", language: "yaml" }],
  [".yaml", { type: "yaml", language: "yaml" }],
  [".toml", { type: "config", language: "toml" }],
  [".ini", { type: "config", language: "ini" }],
]);

const namedPresentations = new Map<string, WorkspaceFilePresentation>([
  [".gitignore", { type: "git", language: "text" }],
  [".gitattributes", { type: "git", language: "text" }],
  [".gitmodules", { type: "git", language: "config" }],
  [".prettierignore", { type: "prettier", language: "text" }],
  [".prettierrc", { type: "prettier", language: "json" }],
  ["cmakelists.txt", { type: "cmake", language: "cmake" }],
  ["license", { type: "license", language: "text" }],
  ["licence", { type: "license", language: "text" }],
]);

const keywordSet = new Set([
  "as",
  "async",
  "await",
  "break",
  "catch",
  "class",
  "const",
  "continue",
  "def",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "foreach",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "interface",
  "let",
  "namespace",
  "new",
  "null",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "switch",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "using",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

export interface SyntaxToken {
  kind:
    | "plain"
    | "keyword"
    | "type"
    | "function"
    | "string"
    | "comment"
    | "number"
    | "variable"
    | "operator"
    | "punctuation";
  text: string;
}

const typeSet = new Set([
  "any",
  "bigint",
  "bool",
  "boolean",
  "byte",
  "char",
  "decimal",
  "double",
  "float",
  "int",
  "int16",
  "int32",
  "int64",
  "long",
  "never",
  "number",
  "object",
  "sbyte",
  "short",
  "size_t",
  "string",
  "symbol",
  "uint",
  "uint16",
  "uint32",
  "uint64",
  "ulong",
  "unknown",
  "ushort",
  "wchar_t",
]);

const operators = [
  "===",
  "!==",
  ">>>",
  "<<=",
  ">>=",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "?.",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "::",
  "->",
  "<<",
  ">>",
  "**",
  "-contains",
  "-notcontains",
  "-notmatch",
  "-notlike",
  "-replace",
  "-match",
  "-like",
  "-contains",
  "-and",
  "-or",
  "-not",
  "-eq",
  "-ne",
  "-lt",
  "-le",
  "-gt",
  "-ge",
  "-in",
  "-is",
  "=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
  "&",
  "|",
  "^",
  "~",
  "?",
] as const;

const punctuation = new Set([
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  ";",
  ",",
  ".",
  ":",
  "<",
  ">",
]);

function extension(path: string): string {
  const name = path.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function basename(path: string): string {
  return (path.replaceAll("\\", "/").split("/").at(-1) ?? "").toLowerCase();
}

export function filePresentation(path: string): WorkspaceFilePresentation {
  const name = basename(path);
  const named = namedPresentations.get(name);
  if (named) return named;
  if (/^requirements(?:[-_.].*)?\.txt$/u.test(name)) {
    return { type: "text", language: "text" };
  }
  return (
    presentations.get(extension(path)) ?? {
      type: "plain",
      language: "text",
    }
  );
}

function pushToken(
  tokens: SyntaxToken[],
  kind: SyntaxToken["kind"],
  text: string,
): void {
  if (!text) return;
  const previous = tokens.at(-1);
  if (previous?.kind === kind) previous.text += text;
  else tokens.push({ kind, text });
}

function nextNonWhitespace(source: string, index: number): string | undefined {
  while (index < source.length && /\s/u.test(source[index]!)) index += 1;
  return source[index];
}

function previousSignificantToken(
  tokens: SyntaxToken[],
): SyntaxToken | undefined {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    if (token.kind !== "plain" || token.text.trim()) return token;
  }
  return undefined;
}

function identifierMatch(source: string, index: number, language: string) {
  const remaining = source.slice(index);
  return remaining.match(
    language === "powershell" || language === "shell"
      ? /^[$@]?[a-zA-Z_][a-zA-Z0-9_-]*/u
      : /^[$@]?[a-zA-Z_][a-zA-Z0-9_]*/u,
  );
}

function tokenKindForIdentifier(
  tokens: SyntaxToken[],
  source: string,
  end: number,
  value: string,
  language: string,
): SyntaxToken["kind"] {
  if (value.startsWith("$") || value.startsWith("@")) return "variable";
  const normalized = value.toLowerCase();
  if (keywordSet.has(normalized)) return "keyword";
  const previous = previousSignificantToken(tokens);
  if (
    nextNonWhitespace(source, end) === "(" ||
    (previous?.kind === "keyword" && previous.text.toLowerCase() === "function")
  ) {
    return "function";
  }
  if (
    typeSet.has(normalized) ||
    (/^[A-Z]/u.test(value) &&
      ["typescript", "javascript", "c", "cpp", "csharp"].includes(language))
  ) {
    return "type";
  }
  return "plain";
}

export function tokenizeWorkspaceFile(
  source: string,
  language: string,
): SyntaxToken[] {
  if (!source) return [];
  if (language === "text") return [{ kind: "plain", text: source }];

  const tokens: SyntaxToken[] = [];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      pushToken(
        tokens,
        "comment",
        source.slice(index, end === -1 ? source.length : end),
      );
      index = end === -1 ? source.length : end;
      continue;
    }

    if (source.startsWith("/*", index)) {
      const closing = source.indexOf("*/", index + 2);
      const end = closing === -1 ? source.length : closing + 2;
      pushToken(tokens, "comment", source.slice(index, end));
      index = end;
      continue;
    }

    if (source.startsWith("<!--", index)) {
      const closing = source.indexOf("-->", index + 4);
      const end = closing === -1 ? source.length : closing + 3;
      pushToken(tokens, "comment", source.slice(index, end));
      index = end;
      continue;
    }

    if (
      source[index] === "#" &&
      ["powershell", "python", "shell", "toml", "yaml"].includes(language)
    ) {
      const end = source.indexOf("\n", index);
      pushToken(
        tokens,
        "comment",
        source.slice(index, end === -1 ? source.length : end),
      );
      index = end === -1 ? source.length : end;
      continue;
    }

    const character = source[index]!;
    if (character === '"' || character === "'" || character === "`") {
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === "\\") {
          end += 2;
          continue;
        }
        end += 1;
        if (source[end - 1] === character) break;
      }
      pushToken(tokens, "string", source.slice(index, end));
      index = end;
      continue;
    }

    const number = source.slice(index).match(/^(?:0x[\da-f]+|\d+(?:\.\d+)?)/iu);
    if (number) {
      pushToken(tokens, "number", number[0]);
      index += number[0].length;
      continue;
    }

    const operator = operators.find((value) => source.startsWith(value, index));
    if (operator) {
      pushToken(tokens, "operator", operator);
      index += operator.length;
      continue;
    }

    const word = identifierMatch(source, index, language);
    if (word) {
      const value = word[0];
      pushToken(
        tokens,
        tokenKindForIdentifier(
          tokens,
          source,
          index + value.length,
          value,
          language,
        ),
        value,
      );
      index += value.length;
      continue;
    }

    if (punctuation.has(character)) {
      pushToken(tokens, "punctuation", character);
      index += 1;
      continue;
    }

    pushToken(tokens, "plain", character);
    index += 1;
  }
  return tokens;
}

export function tokenizeSourceLine(
  line: string,
  language: string,
): SyntaxToken[] {
  if (language === "markdown") {
    const heading = line.match(/^(\s*#{1,6})(\s+)/u);
    if (heading) {
      return [
        { kind: "keyword", text: heading[1]! },
        { kind: "plain", text: line.slice(heading[1]!.length) },
      ];
    }
  }
  return tokenizeWorkspaceFile(line, language);
}
