import { t, type TFunction } from "i18next";
import type { Note, NoteMetadata } from "./types";

export function getDisplayTitle(
  note: Pick<NoteMetadata, "title" | "preview">,
  translate: TFunction = t,
): string {
  const title = note.title.trim();
  if (title) return title;

  const preview = note.preview.trim();
  if (preview) return preview.slice(0, 20);

  return translate("common.untitledNote", { defaultValue: "无标题笔记" });
}

export function markdownToPlainText(markdown: string): string {
  let text = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  if (text.startsWith("---\n")) {
    const frontmatterEnd = text.indexOf("\n---", 4);
    if (frontmatterEnd >= 0) {
      text = text.slice(frontmatterEnd + 4);
    }
  }

  return text
    .replace(/^\s*(?:```|~~~).*$/gm, " ")
    .replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/gm, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/^\s*\[[^\]]+\]:\s+\S+.*$/gm, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\([\\`*{}[\]()#+\-.!_>])/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/\|/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function buildPreview(content: string): string {
  return markdownToPlainText(content).slice(0, 80);
}

export function countNoteChars(content: string): number {
  let count = 0;
  for (const ch of content) {
    if (!/\s/.test(ch)) count++;
  }
  return count;
}

export function metadataFromNote(note: Note): NoteMetadata {
  return {
    id: note.id,
    title: note.title,
    fileName: note.fileName,
    category: note.category,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    wordCount: note.wordCount,
    preview: note.documentKind === "pdf" ? "PDF 文档" : buildPreview(note.content),
    documentKind: note.documentKind ?? "markdown",
    originalFileName: note.originalFileName,
    localOnly: note.localOnly ?? false,
    originalLocalOnly: note.originalLocalOnly ?? false,
  };
}

export interface CategoryGroup {
  category: string;
  notes: NoteMetadata[];
  latestUpdatedAt: string;
}

export function groupNotesByCategory(
  notes: NoteMetadata[],
  allCategories: string[] = [],
  noteOrder: string[] = [],
): CategoryGroup[] {
  const groups = new Map<string, NoteMetadata[]>();
  const noteOrderIndex = new Map(noteOrder.map((id, index) => [id, index]));

  for (const cat of allCategories) {
    groups.set(cat, []);
  }

  for (const note of notes) {
    const key = note.category || "";
    const list = groups.get(key);
    if (list) {
      list.push(note);
    } else {
      groups.set(key, [note]);
    }
  }

  const result: CategoryGroup[] = [];
  for (const [category, categoryNotes] of groups) {
    categoryNotes.sort((a, b) => {
      const aIndex = noteOrderIndex.get(a.id);
      const bIndex = noteOrderIndex.get(b.id);
      if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
      if (aIndex !== undefined) return -1;
      if (bIndex !== undefined) return 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    result.push({
      category,
      notes: categoryNotes,
      latestUpdatedAt: categoryNotes[0]?.updatedAt ?? "",
    });
  }

  const requestedOrder = new Map(allCategories.map((category, index) => [category, index]));
  result.sort((a, b) => {
    const aIndex = requestedOrder.get(a.category);
    const bIndex = requestedOrder.get(b.category);
    if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
    if (aIndex !== undefined) return -1;
    if (bIndex !== undefined) return 1;
    if (!a.category) return 1;
    if (!b.category) return -1;
    return a.category.localeCompare(b.category);
  });
  return result;
}

export function filterNotes(notes: NoteMetadata[], query: string): NoteMetadata[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return notes;

  return notes.filter((note) => {
    const haystack = [note.title, note.preview, note.fileName, getDisplayTitle(note)]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

export function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
