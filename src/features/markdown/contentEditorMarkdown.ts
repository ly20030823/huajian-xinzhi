/**
 * MDXEditor enables HTML/MDX parsing internally. A LaTeX subscript such as
 * `O_{<t}` is therefore mistaken for a malformed JSX tag (`<t}`) and prevents
 * the whole document from opening. Feed the editor its own canonical escaped
 * form, then restore the original Markdown before saving.
 */
export function prepareMarkdownForContentEditor(markdown: string): string {
  return transformOutsideFencedCode(markdown, (line) =>
    line.replace(/(?<!\\)_\{<(?=[A-Za-z][^\s<>]*\})/g, "\\_{\\<"),
  );
}

export function restoreMarkdownFromContentEditor(markdown: string): string {
  return transformOutsideFencedCode(markdown, (line) =>
    line.replace(/\\_\{\\<(?=[A-Za-z][^\s<>]*\})/g, "_{<"),
  );
}

function transformOutsideFencedCode(
  markdown: string,
  transformLine: (line: string) => string,
): string {
  let fence: { marker: "`" | "~"; length: number } | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (match) {
        const marker = match[1][0] as "`" | "~";
        if (!fence) {
          fence = { marker, length: match[1].length };
        } else if (marker === fence.marker && match[1].length >= fence.length) {
          fence = null;
        }
        return line;
      }
      return fence ? line : transformLine(line);
    })
    .join("\n");
}
