import { t, type TFunction } from "i18next";
import type { DocumentKind } from "./types";

export type NoteContextMenuAction =
  | "openNotepad"
  | "openInFolder"
  | "copyFilePath"
  | "openOriginalWord"
  | "revealOriginalWord"
  | "exportMarkdown"
  | "exportPdf"
  | "saveOriginalPdf"
  | "move"
  | "delete";

export interface NoteContextMenuItem {
  action: NoteContextMenuAction;
  label: string;
  tone?: "danger";
}

export function getNoteContextMenuItems(
  translate: TFunction = t,
  documentKind: DocumentKind = "markdown",
): NoteContextMenuItem[] {
  const commonStart: NoteContextMenuItem[] = [
    ...(documentKind === "pdf" ? [] : [{
      action: "openNotepad" as const,
      label: translate("noteMenu.openNotepad", { defaultValue: "作为快捷便签打开" }),
    }]),
    {
      action: "openInFolder",
      label: translate("noteMenu.openInFolder", { defaultValue: "在文件夹中打开" }),
    },
    {
      action: "copyFilePath",
      label: translate("noteMenu.copyFilePath", { defaultValue: "复制文件路径" }),
    },
    ...(documentKind === "docx" ? [{
      action: "openOriginalWord" as const,
      label: translate("noteMenu.openOriginalWord", { defaultValue: "打开原始 Word" }),
    }, {
      action: "revealOriginalWord" as const,
      label: translate("noteMenu.revealOriginalWord", { defaultValue: "显示原始 Word 所在位置" }),
    }] : []),
  ];
  const exports: NoteContextMenuItem[] = documentKind === "pdf" ? [
    {
      action: "saveOriginalPdf",
      label: translate("noteMenu.saveOriginalPdf", { defaultValue: "另存 PDF 原件" }),
    },
  ] : [
    {
      action: "exportMarkdown",
      label: translate("noteMenu.exportMarkdown", { defaultValue: "导出为 Markdown" }),
    },
    {
      action: "exportPdf",
      label: translate("noteMenu.exportPdf", { defaultValue: "导出为 PDF" }),
    },
  ];
  return [
    ...commonStart,
    ...exports,
    {
      action: "move",
      label: translate("noteMenu.moveToCategory", { defaultValue: "移动到分类…" }),
    },
    {
      action: "delete",
      label: translate("noteMenu.delete", { defaultValue: "删除笔记" }),
      tone: "danger",
    },
  ];
}
