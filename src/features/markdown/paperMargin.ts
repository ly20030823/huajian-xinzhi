export interface DocumentHeading {
  level: number;
  text: string;
}

function cleanHeadingText(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function extractDocumentHeadings(markdown: string): DocumentHeading[] {
  const headings: DocumentHeading[] = [];
  const lines = markdown.split(/\r?\n/);
  let insideFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;

    const atx = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (atx) {
      const text = cleanHeadingText(atx[2]);
      if (text) headings.push({ level: atx[1].length, text });
      continue;
    }

    const underline = lines[index + 1]?.match(/^\s{0,3}(=+|-+)\s*$/);
    if (line.trim() && underline) {
      const text = cleanHeadingText(line);
      if (text) headings.push({ level: underline[1][0] === "=" ? 1 : 2, text });
      index += 1;
    }
  }

  return headings;
}

export function estimateReadingMinutes(characterCount: number) {
  return Math.max(1, Math.ceil(characterCount / 400));
}
