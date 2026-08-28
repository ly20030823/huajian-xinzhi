import { languages } from "@codemirror/language-data";
import type { CodeBlockLanguage } from "@mdxeditor/editor";

export interface CodeLanguageOption {
  id: string;
  name: string;
  aliases: readonly string[];
  extensions: readonly string[];
}

const preferredIds: Record<string, string> = {
  HTML: "html",
  JavaScript: "javascript",
  JSON: "json",
  Markdown: "markdown",
  PHP: "php",
  TypeScript: "typescript",
  XML: "xml",
  YAML: "yaml",
};

const loadedOptions: CodeLanguageOption[] = languages.map((language) => {
  const preferred = preferredIds[language.name] ?? language.alias[0] ?? language.name.toLowerCase();
  return {
    id: preferred,
    name: language.name,
    aliases: [preferred, ...language.alias.filter((alias) => alias !== preferred)],
    extensions: language.extensions,
  };
});

export const CODE_LANGUAGE_OPTIONS: CodeLanguageOption[] = [
  { id: "text", name: "Text", aliases: ["text", "txt", "plaintext"], extensions: ["txt"] },
  {
    id: "mermaid",
    name: "Mermaid 流程图",
    aliases: ["mermaid"],
    extensions: ["mmd", "mermaid"],
  },
  ...loadedOptions.sort((left, right) => left.name.localeCompare(right.name, "en")),
];

export const CODE_BLOCK_LANGUAGES: CodeBlockLanguage[] = CODE_LANGUAGE_OPTIONS.map((option) => ({
  name: option.name,
  alias: option.aliases,
  extensions: option.extensions,
}));

export function findCodeLanguage(language: string): CodeLanguageOption | undefined {
  const query = language.trim().toLowerCase();
  return CODE_LANGUAGE_OPTIONS.find(
    (option) =>
      option.id.toLowerCase() === query ||
      option.name.toLowerCase() === query ||
      option.aliases.some((alias) => alias.toLowerCase() === query) ||
      option.extensions.some((extension) => extension.toLowerCase() === query),
  );
}

export function filterCodeLanguages(query: string, limit = 9): CodeLanguageOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return CODE_LANGUAGE_OPTIONS.slice(0, limit);

  return CODE_LANGUAGE_OPTIONS.map((option) => {
    const candidates = [option.id, option.name, ...option.aliases, ...option.extensions].map(
      (item) => item.toLowerCase(),
    );
    const exact = candidates.some((candidate) => candidate === normalized);
    const prefix = candidates.some((candidate) => candidate.startsWith(normalized));
    const contains = candidates.some((candidate) => candidate.includes(normalized));
    return { option, score: exact ? 0 : prefix ? 1 : contains ? 2 : 3 };
  })
    .filter(({ score }) => score < 3)
    .sort(
      (left, right) =>
        left.score - right.score || left.option.name.localeCompare(right.option.name),
    )
    .slice(0, limit)
    .map(({ option }) => option);
}

export function detectCodeLanguage(code: string): string | null {
  const source = code.trim();
  if (!source) return null;

  if (
    /^#!.*\bpython\d*\b/m.test(source) ||
    /^(?:from\s+\S+\s+import|import\s+\S+|def\s+\w+\s*\()/m.test(source)
  )
    return "python";
  if (
    /^#!.*\b(?:bash|sh|zsh)\b/m.test(source) ||
    /^(?:export\s+\w+=|(?:sudo\s+)?(?:apt|npm|pnpm|yarn|cargo|git)\s+)/m.test(source)
  )
    return "shell";
  if (/^\s*(?:interface|type)\s+\w+|\b(?:string|number|boolean)\s*[;=),]/m.test(source))
    return "typescript";
  if (/\b(?:const|let|var)\s+\w+\s*=|\bfunction\s+\w+\s*\(|=>|console\.\w+\s*\(/m.test(source))
    return "javascript";
  if (/^\s*(?:package\s+main|func\s+\w+\s*\(|import\s*\()/m.test(source)) return "go";
  if (/\bfn\s+\w+\s*\(|\blet\s+mut\b|println!\s*\(/m.test(source)) return "rust";
  if (/^\s*(?:using\s+System|namespace\s+\w+)|Console\.WriteLine/m.test(source)) return "csharp";
  if (/\bpublic\s+(?:static\s+)?(?:class|void)\b|System\.out\.print/m.test(source)) return "java";
  if (/^\s*#include\s*[<"]|\bstd::|\b(?:printf|scanf)\s*\(/m.test(source))
    return /std::|iostream/.test(source) ? "cpp" : "c";
  if (/^\s*(?:SELECT|INSERT\s+INTO|UPDATE|CREATE\s+TABLE|WITH)\b/im.test(source)) return "sql";
  if (/^\s*(?:FROM|RUN|COPY|ENTRYPOINT|CMD)\s+/m.test(source)) return "dockerfile";
  if (/^\s*<\?php\b/i.test(source)) return "php";
  if (/^\s*(?:<!doctype\s+html|<html\b|<[a-z][\w-]*(?:\s+[\w:-]+=))/i.test(source)) return "html";
  if (/^[.#]?[\w-]+(?:\s+[.#\w-]+)*\s*\{[^}]*[\w-]+\s*:/ms.test(source)) return "css";
  try {
    const parsed = JSON.parse(source);
    if (parsed !== null && typeof parsed === "object") return "json";
  } catch {
    // Not JSON; continue with the lighter text heuristics below.
  }
  if (/^\s*\[[\w.-]+\]\s*$[\s\S]*^\s*[\w.-]+\s*=\s*.+/m.test(source)) return "toml";
  if (/^(?:[\w.-]+\s*:\s*.*(?:\n|$)){2,}/m.test(source)) return "yaml";
  if (/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|>\s+)|\[[^\]]+\]\([^)]+\)/m.test(source)) return "markdown";
  return null;
}
