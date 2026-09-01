import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import { AboutPanel } from "./AboutPanel";
import { ActivityPanel } from "./ActivityPanel";
import {
  exportMarkdownNote,
  exportPdfDocument,
} from "../features/importExport/api";
import {
  getOriginalWordPath,
  getPdfBytes,
  importSupportedDocument,
} from "../features/importExport/documentImport";
import { PdfDocumentViewer } from "../features/pdf/PdfDocumentViewer";
import { renderMarkdownPdf } from "../features/importExport/pdfExport";
import { getCustomizationContent } from "../features/customization/api";
import { parseGreetings, pickGreeting, pickNextGreeting } from "../features/customization/content";
import { MarkdownContentEditor } from "../features/markdown/MarkdownContentEditor";
import {
  getTextEditorSelectionStats,
  type EditorSelectionStats,
} from "../features/markdown/editorStats";
import defaultGreetingsMarkdown from "../../customization/greetings.md?raw";
import { showToast } from "./Toast";
import {
  mapScrollPosition,
  measureBlockOffsets,
  measurePreviewBlockOffsets,
  tagPreviewBlocks,
} from "../features/markdown/scrollSync";
import {
  findVerticalScrollContainer,
  restoreDocumentScrollOrigin,
  scrollElementWithinContainer,
} from "../features/markdown/scrollWithinContainer";
import {
  chooseDataDirectory,
  getConfig,
  openDataDirectory,
  normalizeViewMode,
  saveConfig,
} from "../features/settings/api";
import type { AppConfig, ViewMode } from "../features/settings/types";
import { normalizeTileColor } from "../features/settings/tileColor";
import { getSyncStatus, readLocalLayout, syncNow } from "../features/sync/api";
import type { SyncLayoutEvent } from "../features/sync/types";
import { getUpdateStatus, reportInstallPreparation } from "../features/update/api";
import {
  ABOUT_UPDATE_LABEL_DURATION_MS,
  applyAboutUpdateStatus,
  createAboutUpdateReminderState,
  dismissAboutUpdateReminderText,
  type AboutUpdateReminderState,
} from "../features/update/presentation";
import type {
  UpdateErrorPayload,
  UpdateInstallPrepareRequest,
  UpdateState,
} from "../features/update/types";
import { BackgroundLayer } from "./BackgroundLayer";
import { POPUP_VIEWPORT_MARGIN, useViewportPopupPosition } from "./popupPosition";
import { SettingsPanel } from "./SettingsPanel";
import { PaperMarginPanel } from "./PaperMarginPanel";
import { WritingPet } from "./WritingPet";
import {
  createNote,
  createCategory,
  deleteCategory,
  deleteNote,
  getErrorMessage,
  getFileModifiedTime,
  getNote,
  getNoteFilePath,
  listCategories,
  listNotes,
  moveNoteCategory,
  readExternalFile,
  renameCategory,
  saveExternalFile,
  updateNote,
} from "../features/notes/api";
import { cleanUnusedImages, saveImageFromPath } from "../features/images/api";
import { useImagePaste, insertTextAtCursor, saveImageFile } from "../features/images/useImagePaste";
import { useImageBaseDir } from "../features/images/useImageBaseDir";
import type { ExternalFile, Note, NoteMetadata } from "../features/notes/types";
import {
  countNoteChars,
  filterNotes,
  formatShortDate,
  formatTime,
  getDisplayTitle,
  groupNotesByCategory,
  metadataFromNote,
} from "../features/notes/noteUtils";
import type { CategoryGroup } from "../features/notes/noteUtils";
import {
  moveCategoryInOrder,
  normalizeCategoryOrder,
  type CategoryDropPosition,
} from "../features/notes/categoryOrder";
import {
  moveNoteInOrder,
  normalizeNoteOrder,
  sortNotesByOrder,
  type NoteDropPosition,
} from "../features/notes/noteOrder";
import {
  getNoteContextMenuItems,
  type NoteContextMenuAction,
} from "../features/notes/noteContextMenu";
import { openNotepadWindow, takeStartupFile, toggleTileWindow } from "../features/windows/api";
import {
  closeCurrentWindow,
  minimizeCurrentWindow,
  toggleMaximizeCurrentWindow,
  isCurrentWindowMaximized,
  startCurrentWindowDrag,
} from "../features/windows/controls";
import {
  TILE_WINDOW_CLOSED_EVENT,
  TILE_WINDOW_UNPINNED_EVENT,
  syncPinnedTileIds,
} from "../features/windows/tileWindowEvents";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type ManualSyncState = "idle" | "syncing" | "success" | "error";

function DocumentTypeBadges({ note }: { note: NoteMetadata }) {
  const kind = note.documentKind ?? "markdown";
  if (kind === "markdown") return null;
  return (
    <span className="ml-1.5 inline-flex shrink-0 items-center gap-1 align-middle">
      <span
        className={`rounded px-1 py-px text-[8px] font-semibold tracking-wide ${
          kind === "pdf"
            ? "bg-red-100 text-red-500"
            : "bg-blue-100 text-blue-600"
        }`}
      >
        {kind === "pdf" ? "PDF" : "DOCX"}
      </span>
      {note.localOnly ? (
        <span className="rounded bg-paper-deep/55 px-1 py-px text-[8px] text-ink-ghost">仅本机</span>
      ) : null}
      {kind === "docx" && note.originalLocalOnly ? (
        <span className="rounded bg-paper-deep/55 px-1 py-px text-[8px] text-ink-ghost">
          原件仅本机
        </span>
      ) : null}
    </span>
  );
}
type SidePanelMode = "activity" | "about" | "settings";

function ManualSyncIcon({ state }: { state: ManualSyncState }) {
  return (
    <svg
      data-testid="manual-sync-icon"
      data-state={state}
      className={state === "syncing" ? "animate-pulse" : ""}
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.5 19H8.75a6.25 6.25 0 1 1 5.83-8.5A4.75 4.75 0 1 1 17.5 19Z" />
      {state === "syncing" ? (
        <g fill="currentColor" stroke="none">
          <circle cx="10" cy="15" r="0.85">
            <animate
              attributeName="opacity"
              values="0.25;1;0.25"
              dur="1.2s"
              begin="0s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx="13" cy="15" r="0.85">
            <animate
              attributeName="opacity"
              values="0.25;1;0.25"
              dur="1.2s"
              begin="0.2s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx="16" cy="15" r="0.85">
            <animate
              attributeName="opacity"
              values="0.25;1;0.25"
              dur="1.2s"
              begin="0.4s"
              repeatCount="indefinite"
            />
          </circle>
        </g>
      ) : state === "success" ? (
        <path d="m9.5 14 2.1 2 4.2-4.6" />
      ) : state === "error" ? (
        <>
          <path d="M13 11.5v3.2" />
          <path d="M13 16.8h.01" />
        </>
      ) : null}
    </svg>
  );
}

interface NoteMenuState {
  x: number;
  y: number;
  noteId: string;
}

interface CategoryMenuState {
  x: number;
  y: number;
  category: string;
}

type FormatAction =
  | "bold"
  | "italic"
  | "heading"
  | "hr"
  | "ul"
  | "ol"
  | "code"
  | "quote"
  | "inlineMath"
  | "blockMath";

function applyFormat(
  textarea: HTMLTextAreaElement,
  action: FormatAction,
  translate: TFunction,
  setContent: (v: string) => void,
  markDirty: () => void,
) {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  const lineStart = before.lastIndexOf("\n") + 1;
  const currentLine = before.slice(lineStart);

  let result: string;
  let cursorStart: number;
  let cursorEnd: number;

  switch (action) {
    case "bold": {
      const fallback = translate("main.formatSample.boldText", { defaultValue: "粗体文本" });
      const wrapped = `**${selected || fallback}**`;
      result = before + wrapped + after;
      cursorStart = start + 2;
      cursorEnd = cursorStart + (selected || fallback).length;
      break;
    }
    case "italic": {
      const fallback = translate("main.formatSample.italicText", { defaultValue: "斜体文本" });
      const wrapped = `*${selected || fallback}*`;
      result = before + wrapped + after;
      cursorStart = start + 1;
      cursorEnd = cursorStart + (selected || fallback).length;
      break;
    }
    case "heading": {
      const prefix = currentLine.match(/^(#{1,5})\s/);
      if (prefix) {
        const newLevel = prefix[1].length < 5 ? "#".repeat(prefix[1].length + 1) : "#";
        const beforeLine = value.slice(0, lineStart);
        const afterPrefix = value.slice(lineStart + prefix[0].length);
        result = beforeLine + newLevel + " " + afterPrefix;
        const offset = newLevel.length + 1 - prefix[0].length;
        cursorStart = start + offset;
        cursorEnd = end + offset;
      } else if (currentLine.length > 0 && start === end) {
        result = value.slice(0, lineStart) + "## " + value.slice(lineStart);
        cursorStart = start + 3;
        cursorEnd = cursorStart;
      } else if (selected) {
        result = before + `## ${selected}` + after;
        cursorStart = start + 3;
        cursorEnd = cursorStart + selected.length;
      } else {
        result =
          before +
          `## ${translate("main.formatSample.headingText", { defaultValue: "标题" })}` +
          after;
        cursorStart = start + 3;
        cursorEnd = cursorStart + 2;
      }
      break;
    }
    case "hr": {
      const newlineBefore = before.endsWith("\n") || before === "" ? "" : "\n";
      const newlineAfter = after.startsWith("\n") || after === "" ? "" : "\n";
      result = before + `${newlineBefore}---${newlineAfter}` + after;
      cursorStart = cursorEnd = before.length + newlineBefore.length + 3;
      break;
    }
    case "ul": {
      if (selected.includes("\n")) {
        const lines = selected
          .split("\n")
          .map((l) => `- ${l}`)
          .join("\n");
        result = before + lines + after;
        cursorStart = start;
        cursorEnd = start + lines.length;
      } else {
        const fallback = translate("main.formatSample.listItem", { defaultValue: "列表项" });
        const item = `- ${selected || fallback}`;
        result = before + item + after;
        cursorStart = start + 2;
        cursorEnd = cursorStart + (selected || fallback).length;
      }
      break;
    }
    case "ol": {
      if (selected.includes("\n")) {
        const lines = selected
          .split("\n")
          .map((l, i) => `${i + 1}. ${l}`)
          .join("\n");
        result = before + lines + after;
        cursorStart = start;
        cursorEnd = start + lines.length;
      } else {
        const fallback = translate("main.formatSample.listItem", { defaultValue: "列表项" });
        const item = `1. ${selected || fallback}`;
        result = before + item + after;
        cursorStart = start + 3;
        cursorEnd = cursorStart + (selected || fallback).length;
      }
      break;
    }
    case "code": {
      if (selected.includes("\n")) {
        const wrapped = "```\n" + selected + "\n```";
        result = before + wrapped + after;
        cursorStart = start + 4;
        cursorEnd = cursorStart + selected.length;
      } else {
        const fallback = translate("main.formatSample.codeText", { defaultValue: "代码" });
        const wrapped = `\`${selected || fallback}\``;
        result = before + wrapped + after;
        cursorStart = start + 1;
        cursorEnd = cursorStart + (selected || fallback).length;
      }
      break;
    }
    case "quote": {
      if (selected.includes("\n")) {
        const lines = selected
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n");
        result = before + lines + after;
        cursorStart = start;
        cursorEnd = start + lines.length;
      } else {
        const fallback = translate("main.formatSample.quoteText", { defaultValue: "引用文本" });
        const item = `> ${selected || fallback}`;
        result = before + item + after;
        cursorStart = start + 2;
        cursorEnd = cursorStart + (selected || fallback).length;
      }
      break;
    }
    case "inlineMath": {
      const wrapped = `$${selected || "E=mc^2"}$`;
      result = before + wrapped + after;
      cursorStart = start + 1;
      cursorEnd = cursorStart + (selected || "E=mc^2").length;
      break;
    }
    case "blockMath": {
      const wrapped = `\n$$\n${selected || "x^2 + y^2 = r^2"}\n$$\n`;
      result = before + wrapped + after;
      cursorStart = start + 4;
      cursorEnd = cursorStart + (selected || "x^2 + y^2 = r^2").length;
      break;
    }
  }

  textarea.focus();
  textarea.setSelectionRange(0, value.length);
  document.execCommand("insertText", false, result);
  setContent(result);
  markDirty();
  requestAnimationFrame(() => {
    textarea.setSelectionRange(cursorStart, cursorEnd);
  });
}

function runEditorCommand(textarea: HTMLTextAreaElement | null, command: "undo" | "redo"): boolean {
  if (!textarea || textarea.disabled) return false;
  textarea.focus();
  return document.execCommand(command);
}

export function pinTileButtonTitle(isPinned: boolean): string {
  return isPinned ? "取消钉屏" : "钉到屏幕";
}

interface LoadEpoch {
  // 开始一次新的异步加载，返回本次 epoch token；之后用 isCurrent 校验是否仍然有效
  bump: () => number;
  // 只读取当前 epoch 而不自增：用于"记录事件到达瞬间的代次，期间若发生切换则过期"
  peek: () => number;
  // 异步完成后调用：仅当期间未发生新的 bump（用户未切换/重载）时为 true
  isCurrent: (token: number) => boolean;
}

// 统一封装"加载竞态守卫"：每次切换/加载笔记自增 epoch，异步结果回来后用
// isCurrent 判断是否过期。集中此处后，新增异步加载路径只需 bump/isCurrent 两步，
// 避免裸 ref 在多处内联导致的"忘记连线 → stale 结果覆盖新选中"竞态回归
function useLoadEpoch(): LoadEpoch {
  const ref = useRef(0);
  return useMemo<LoadEpoch>(
    () => ({
      bump: () => (ref.current += 1),
      peek: () => ref.current,
      isCurrent: (token: number) => ref.current === token,
    }),
    [],
  );
}

interface MainWindowProps {
  initialSettingsOpen?: boolean;
  initialConfig?: AppConfig;
}

const CATEGORY_ORDER_STORAGE_KEY = "floral-notepaper.category-order";
const NOTE_ORDER_STORAGE_KEY = "floral-notepaper.note-order";
const WRITING_PET_VISIBILITY_STORAGE_KEY = "floral-notepaper.writing-pet-visible";
const DEFAULT_EDITOR_FONT_SIZE = 14;
const MIN_EDITOR_FONT_SIZE = 8;
const MAX_EDITOR_FONT_SIZE = 30;

function readWritingPetVisibility(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(WRITING_PET_VISIBILITY_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function readSavedCategoryOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(CATEGORY_ORDER_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function readSavedNoteOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(NOTE_ORDER_STORAGE_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function MainWindow({
  initialSettingsOpen = false,
  initialConfig = undefined,
}: MainWindowProps = {}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<NoteMetadata[]>([]);
  const [externalFiles, setExternalFiles] = useState<ExternalFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(
    normalizeViewMode(initialConfig?.defaultViewMode ?? "content"),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [content, setContent] = useState("");
  const [editorSelectionStats, setEditorSelectionStats] = useState<EditorSelectionStats>({
    currentLine: 1,
    selectedChars: 0,
  });
  const [title, setTitle] = useState("");
  const [greetings, setGreetings] = useState(() => parseGreetings(defaultGreetingsMarkdown));
  const [sessionGreeting, setSessionGreeting] = useState(
    () => pickGreeting(parseGreetings(defaultGreetingsMarkdown)) ?? "你好",
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isReloadingFromDisk, setIsReloadingFromDisk] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [noteMenu, setNoteMenu] = useState<NoteMenuState | null>(null);
  const [noteMenuClosing, setNoteMenuClosing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [aboutUpdateReminder, setAboutUpdateReminder] = useState<AboutUpdateReminderState>(() =>
    createAboutUpdateReminderState(null),
  );
  const [manualSyncState, setManualSyncState] = useState<ManualSyncState>("idle");
  const [settingsConfig, setSettingsConfig] = useState<AppConfig | null>(initialConfig ?? null);
  const settingsConfigRef = useRef<AppConfig | null>(initialConfig ?? null);
  const [savedDataDir, setSavedDataDir] = useState<string | null>(initialConfig?.dataDir ?? null);
  const [noteTransitionKey, setNoteTransitionKey] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteExiting, setDeleteExiting] = useState(false);
  const [pinnedTileIds, setPinnedTileIds] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryOrder, setCategoryOrder] = useState<string[]>(readSavedCategoryOrder);
  const [noteOrder, setNoteOrder] = useState<string[]>(readSavedNoteOrder);
  const [writingPetVisible, setWritingPetVisible] = useState(readWritingPetVisibility);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [categoryInputValue, setCategoryInputValue] = useState("");
  const [noteMenuMode, setNoteMenuMode] = useState<"main" | "move">("main");
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameCategoryValue, setRenameCategoryValue] = useState("");
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [draggedCategory, setDraggedCategory] = useState<string | null>(null);
  const [categoryDropPosition, setCategoryDropPosition] = useState<CategoryDropPosition>("before");
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dragOverNoteId, setDragOverNoteId] = useState<string | null>(null);
  const [noteDropPosition, setNoteDropPosition] = useState<NoteDropPosition>("before");
  const [markdownDropActive, setMarkdownDropActive] = useState(false);
  const [settingsOverlay, setSettingsOverlay] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 1080 : true,
  );
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const markdownDragDepthRef = useRef(0);
  const [categoryMenu, setCategoryMenu] = useState<CategoryMenuState | null>(null);
  const [categoryMenuClosing, setCategoryMenuClosing] = useState(false);
  const [categoryMenuConfirmDelete, setCategoryMenuConfirmDelete] = useState(false);
  const [categoryMenuHoverSuppressed, setCategoryMenuHoverSuppressed] = useState(false);
  const { popupRef: noteMenuRef, popupPosition: noteMenuPosition } = useViewportPopupPosition(
    noteMenu,
    `${noteMenuMode}:${categories.length}`,
  );
  const { popupRef: categoryMenuRef, popupPosition: categoryMenuPosition } =
    useViewportPopupPosition(categoryMenu, categoryMenuConfirmDelete);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const richEditorRef = useRef<MDXEditorMethods>(null);
  const windowLabelRef = useRef("main");
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const blockOffsets = useRef<number[]>([]);
  const previewBlockOffsets = useRef<number[]>([]);
  const previewScrollerRef = useRef<HTMLElement | null>(null);
  const scrollSource = useRef<"editor" | "preview" | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureRafRef = useRef<number>(0);
  const measureControllerRef = useRef<AbortController | null>(null);
  const manualSyncResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSelectedIdRef = useRef(selectedId);
  const externalFileMtimeRef = useRef<number>(0);
  const lastExternalSaveRef = useRef<number>(0);
  const greetingNoteRef = useRef<string | null>(null);
  const imageBaseDir = useImageBaseDir();
  const saveStateRef = useRef(saveState);
  const isMacOS = useMemo(() => {
    return (
      typeof navigator !== "undefined" &&
      (/Mac|iPhone|iPad/.test(navigator.platform) || navigator.userAgent.includes("Mac"))
    );
  }, []);
  saveStateRef.current = saveState;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const contentValueRef = useRef(content);
  contentValueRef.current = content;
  const titleValueRef = useRef(title);
  titleValueRef.current = title;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const externalFilesRef = useRef(externalFiles);
  externalFilesRef.current = externalFiles;
  // 每次"应用/切换当前笔记"都会自增；异步加载完成后若 epoch 已变化，说明用户
  // 已切换到别处，该次结果直接丢弃，避免旧的加载结果覆盖新选中的笔记
  const loadEpoch = useLoadEpoch();
  // 串行化所有保存请求，避免自动保存与切换触发的保存并发写同一篇笔记
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedId) ?? null,
    [notes, selectedId],
  );
  const selectedNoteRef = useRef(selectedNote);
  selectedNoteRef.current = selectedNote;

  const selectedExternalFile = useMemo(
    () => externalFiles.find((f) => f.id === selectedId) ?? null,
    [externalFiles, selectedId],
  );
  const updateStatusHydratedRef = useRef(false);

  const resizeTitleInput = useCallback(() => {
    const input = titleInputRef.current;
    if (!input) return;

    input.style.height = "auto";
    const lineHeight = Number.parseFloat(window.getComputedStyle(input).lineHeight) || 27;
    const maximumHeight = lineHeight * 2;
    input.style.height = `${Math.min(input.scrollHeight, maximumHeight)}px`;
    input.style.overflowY = input.scrollHeight > maximumHeight ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    resizeTitleInput();
  }, [resizeTitleInput, title]);

  useEffect(() => {
    let animationFrame = 0;
    const handleResize = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(resizeTitleInput);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [resizeTitleInput]);

  useEffect(() => {
    let cancelled = false;
    void getCustomizationContent()
      .then((customization) => {
        if (cancelled) return;
        const nextGreetings = parseGreetings(customization.greetingsMarkdown);
        if (nextGreetings.length === 0) return;
        setGreetings(nextGreetings);
        setSessionGreeting((current) => pickNextGreeting(nextGreetings, current) ?? current);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      greetingNoteRef.current = null;
      return;
    }
    if (greetingNoteRef.current === selectedId) return;
    greetingNoteRef.current = selectedId;
    setSessionGreeting((current) => pickNextGreeting(greetings, current) ?? current);
  }, [greetings, selectedId]);

  const isExternal = selectedExternalFile !== null;
  const isExternalRef = useRef(isExternal);
  isExternalRef.current = isExternal;

  const noteMenuTarget = useMemo(
    () => notes.find((note) => note.id === noteMenu?.noteId) ?? null,
    [noteMenu?.noteId, notes],
  );
  const noteContextMenuItems = useMemo(
    () => getNoteContextMenuItems(t, noteMenuTarget?.documentKind ?? "markdown"),
    [noteMenuTarget?.documentKind, t],
  );
  const saveStateLabel = useMemo<Record<SaveState, string>>(
    () => ({
      idle: t("main.statusBar.saveState.idle", { defaultValue: "未选择" }),
      dirty: t("main.statusBar.saveState.dirty", { defaultValue: "未保存" }),
      saving: t("main.statusBar.saveState.saving", { defaultValue: "保存中" }),
      saved: t("main.statusBar.saveState.saved", { defaultValue: "已保存" }),
      error: t("main.statusBar.saveState.error", { defaultValue: "保存失败" }),
    }),
    [t],
  );
  const toolbarButtons = useMemo<
    { label: string; title: string; style: string; action: FormatAction }[]
  >(
    () => [
      {
        label: "B",
        title: t("main.toolbar.bold", { defaultValue: "粗体" }),
        style: "font-bold",
        action: "bold",
      },
      {
        label: "I",
        title: t("main.toolbar.italic", { defaultValue: "斜体" }),
        style: "italic",
        action: "italic",
      },
      {
        label: "H",
        title: t("main.toolbar.heading", { defaultValue: "标题" }),
        style: "font-bold",
        action: "heading",
      },
      {
        label: "—",
        title: t("main.toolbar.hr", { defaultValue: "分割线" }),
        style: "",
        action: "hr",
      },
      {
        label: "•",
        title: t("main.toolbar.ul", { defaultValue: "无序列表" }),
        style: "",
        action: "ul",
      },
      {
        label: "1.",
        title: t("main.toolbar.ol", { defaultValue: "有序列表" }),
        style: "font-mono text-[9px]",
        action: "ol",
      },
      {
        label: "<>",
        title: t("main.toolbar.code", { defaultValue: "代码" }),
        style: "font-mono text-[9px]",
        action: "code",
      },
      {
        label: "❝",
        title: t("main.toolbar.quote", { defaultValue: "引用" }),
        style: "",
        action: "quote",
      },
      {
        label: "∑",
        title: t("main.toolbar.inlineMath", { defaultValue: "行内公式" }),
        style: "font-mono text-[11px]",
        action: "inlineMath",
      },
      {
        label: "∫",
        title: t("main.toolbar.blockMath", { defaultValue: "块级公式" }),
        style: "font-mono text-[11px]",
        action: "blockMath",
      },
    ],
    [t],
  );
  const syncUpdateStatus = useCallback((nextStatus: UpdateState) => {
    const shouldHydrate = !updateStatusHydratedRef.current;
    if (shouldHydrate) {
      updateStatusHydratedRef.current = true;
    }

    setAboutUpdateReminder((current) =>
      shouldHydrate
        ? createAboutUpdateReminderState(nextStatus)
        : applyAboutUpdateStatus(current, nextStatus),
    );
  }, []);
  const visibleSidePanel: SidePanelMode | null = activityOpen
    ? "activity"
    : aboutOpen
      ? "about"
      : settingsOpen && settingsConfig
        ? "settings"
        : null;
  const sidePanelExpanded = visibleSidePanel !== null;
  const openAboutPanel = useCallback(() => {
    setSettingsOpen(false);
    setActivityOpen(false);
    setAboutOpen(true);
    setAboutUpdateReminder((current) => dismissAboutUpdateReminderText(current));
  }, []);

  const filteredNotes = useMemo(() => filterNotes(notes, searchQuery), [notes, searchQuery]);

  const categoryGroups = useMemo(() => {
    const groups = groupNotesByCategory(filteredNotes, [
      ...normalizeCategoryOrder(categoryOrder, categories),
      "",
    ]);
    const normalizedOrder = normalizeNoteOrder(
      noteOrder,
      notes.map((note) => note.id),
    );
    return groups.map((group) => ({
      ...group,
      notes: sortNotesByOrder(group.notes, normalizedOrder),
    }));
  }, [filteredNotes, categories, categoryOrder, noteOrder, notes]);

  const uncategorizedCount = useMemo(() => notes.filter((note) => !note.category).length, [notes]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(categoryOrder));
    } catch {
      // Local storage may be disabled; folder ordering still works for the current session.
    }
  }, [categoryOrder]);

  useEffect(() => {
    try {
      window.localStorage.setItem(NOTE_ORDER_STORAGE_KEY, JSON.stringify(noteOrder));
    } catch {
      // Note ordering remains available for the current session.
    }
  }, [noteOrder]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WRITING_PET_VISIBILITY_STORAGE_KEY,
        writingPetVisible ? "true" : "false",
      );
    } catch {
      // The visibility preference still works for the current session.
    }
  }, [writingPetVisible]);

  useEffect(() => {
    let interval: number | undefined;
    let startupTimer: number | undefined;
    let disposed = false;

    const runAutomaticSync = () => {
      if (
        disposed ||
        document.visibilityState !== "visible" ||
        saveStateRef.current === "dirty" ||
        saveStateRef.current === "saving"
      ) {
        return;
      }
      void syncNow(readLocalLayout()).catch(() => undefined);
    };

    const configure = (runAtStartup: boolean) => {
      if (interval) window.clearInterval(interval);
      if (startupTimer) window.clearTimeout(startupTimer);
      void getSyncStatus()
        .then((status) => {
          if (disposed || !status.settings.enabled || !status.settings.autoSync) return;
          const delay = Math.max(1, status.settings.intervalMinutes) * 60_000;
          interval = window.setInterval(runAutomaticSync, delay);
          if (runAtStartup) {
            startupTimer = window.setTimeout(runAutomaticSync, 1800);
          }
        })
        .catch(() => undefined);
    };

    const handleSettingsChanged = () => configure(false);
    window.addEventListener("floral-sync-settings-changed", handleSettingsChanged);
    configure(true);
    return () => {
      disposed = true;
      if (interval) window.clearInterval(interval);
      if (startupTimer) window.clearTimeout(startupTimer);
      window.removeEventListener("floral-sync-settings-changed", handleSettingsChanged);
    };
  }, []);

  const lineCount = useMemo(() => content.split("\n").length, [content]);
  const byteSize = useMemo(
    () => (new TextEncoder().encode(content).length / 1024).toFixed(1),
    [content],
  );
  const charCount = useMemo(() => countNoteChars(content), [content]);

  const updateSourceEditorStats = (textarea: HTMLTextAreaElement) => {
    setEditorSelectionStats(
      getTextEditorSelectionStats(textarea.value, textarea.selectionStart, textarea.selectionEnd),
    );
  };

  useEffect(() => {
    setEditorSelectionStats((current) => ({
      currentLine: Math.min(Math.max(1, current.currentLine), lineCount),
      selectedChars: current.selectedChars,
    }));
  }, [lineCount]);

  useEffect(() => {
    setEditorSelectionStats({ currentLine: 1, selectedChars: 0 });
  }, [selectedId]);

  const applyNote = useCallback(
    (note: Note) => {
      // 立刻同步各 ref，保证保存快照与守卫在下一次渲染前就能读到最新值
      loadEpoch.bump();
      selectedIdRef.current = note.id;
      titleValueRef.current = note.title;
      contentValueRef.current = note.content;
      saveStateRef.current = "saved";
      setSelectedId(note.id);
      setTitle(note.title);
      setContent(note.content);
      setSaveState("saved");
      setNoteTransitionKey((k) => k + 1);
    },
    [loadEpoch],
  );

  const replaceNoteMetadata = useCallback((note: Note) => {
    const metadata = metadataFromNote(note);
    setNoteOrder((order) => (order.includes(metadata.id) ? order : [metadata.id, ...order]));
    setNotes((current) => {
      const exists = current.some((item) => item.id === metadata.id);
      const next = exists
        ? current.map((item) => (item.id === metadata.id ? metadata : item))
        : [metadata, ...current];
      return [...next].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }, []);

  const loadNote = useCallback(
    async (id: string) => {
      const epoch = loadEpoch.bump();
      const note = await getNote(id);
      // 加载期间用户又切换/加载了别的笔记，丢弃本次结果
      if (!loadEpoch.isCurrent(epoch)) return;
      applyNote(note);
      replaceNoteMetadata(note);
    },
    [applyNote, replaceNoteMetadata, loadEpoch],
  );

  const refreshNotes = useCallback(async () => {
    const [loadedNotes, loadedCategories] = await Promise.all([listNotes(), listCategories()]);
    setNotes(loadedNotes);
    setNoteOrder((current) =>
      normalizeNoteOrder(
        current,
        loadedNotes.map((note) => note.id),
      ),
    );
    setCategories(loadedCategories);
    setCategoryOrder((current) => normalizeCategoryOrder(current, loadedCategories));
    return loadedNotes;
  }, []);

  const clearCurrentNote = useCallback(() => {
    loadEpoch.bump();
    selectedIdRef.current = null;
    titleValueRef.current = "";
    contentValueRef.current = "";
    saveStateRef.current = "idle";
    setSelectedId(null);
    setTitle("");
    setContent("");
    setSaveState("idle");
  }, [loadEpoch]);

  const loadExternalFile = useCallback(
    async (filePath: string) => {
      const epoch = loadEpoch.bump();
      try {
        const [fileContent, mtime] = await Promise.all([
          readExternalFile(filePath),
          getFileModifiedTime(filePath),
        ]);
        const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
        const displayTitle = fileName.replace(/\.(md|txt)$/i, "");

        setExternalFiles((current) => {
          if (current.some((f) => f.id === filePath)) {
            return current;
          }
          return [
            ...current,
            {
              id: filePath,
              title: displayTitle,
              filePath,
            },
          ];
        });

        if (!loadEpoch.isCurrent(epoch)) return;
        selectedIdRef.current = filePath;
        titleValueRef.current = displayTitle;
        contentValueRef.current = fileContent;
        saveStateRef.current = "saved";
        setSelectedId(filePath);
        setTitle(displayTitle);
        setContent(fileContent);
        setSaveState("saved");
        setNoteTransitionKey((k) => k + 1);
        externalFileMtimeRef.current = mtime;
      } catch (error) {
        showToast(getErrorMessage(error));
      }
    },
    [loadEpoch],
  );

  useEffect(() => {
    try {
      windowLabelRef.current = getCurrentWindow().label;
    } catch {
      windowLabelRef.current = "main";
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setIsLoading(true);
      try {
        const [loadedConfig, loadedNotes, loadedCategories] = await Promise.all([
          getConfig(),
          listNotes(),
          listCategories(),
        ]);
        if (cancelled) return;
        setSettingsConfig(loadedConfig);
        setSavedDataDir(loadedConfig.dataDir);
        setViewMode(normalizeViewMode(loadedConfig.defaultViewMode));
        setNotes(loadedNotes);
        setNoteOrder((current) =>
          normalizeNoteOrder(
            current,
            loadedNotes.map((note) => note.id),
          ),
        );
        setCategories(loadedCategories);
        setCategoryOrder((current) => normalizeCategoryOrder(current, loadedCategories));
        setCollapsedCategories(new Set(loadedCategories));
        if (loadedNotes[0]) {
          const note = await getNote(loadedNotes[0].id);
          if (!cancelled) applyNote(note);
        } else {
          clearCurrentNote();
        }

        if (!cancelled) {
          const startupFile = await takeStartupFile();
          if (!cancelled && startupFile) {
            await loadExternalFile(startupFile);
          }
        }
      } catch (error) {
        if (!cancelled) showToast(getErrorMessage(error));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applyNote, clearCurrentNote]);

  useEffect(() => {
    let active = true;

    void getUpdateStatus()
      .then((status) => {
        if (!active) return;
        syncUpdateStatus(status);
      })
      .catch((error) => {
        console.error("failed to load update status", error);
      });

    const bindEvents = async () => {
      const unlistenFns: UnlistenFn[] = [];
      const disposeAll = () => {
        for (const unlisten of unlistenFns.splice(0)) {
          unlisten();
        }
      };

      try {
        unlistenFns.push(
          await listen<UpdateState>("update://checking", (event) => {
            if (!active) return;
            syncUpdateStatus(event.payload);
          }),
        );

        unlistenFns.push(
          await listen<UpdateState>("update://checked", (event) => {
            if (!active) return;
            syncUpdateStatus(event.payload);
          }),
        );

        unlistenFns.push(
          await listen<UpdateState>("update://download-finished", (event) => {
            if (!active) return;
            syncUpdateStatus(event.payload);
          }),
        );

        unlistenFns.push(
          await listen<UpdateState>("update://install-finished", (event) => {
            if (!active) return;
            syncUpdateStatus(event.payload);
          }),
        );

        unlistenFns.push(
          await listen("update://error", () => {
            if (!active) return;
            void getUpdateStatus()
              .then((status) => {
                if (!active) return;
                syncUpdateStatus(status);
              })
              .catch((error) => {
                console.error("failed to refresh update status after error event", error);
              });
          }),
        );

        unlistenFns.push(
          await listen<UpdateErrorPayload>("update://auto-check-error", (event) => {
            if (!active) return;
            console.error("automatic update check failed", event.payload);
            void getUpdateStatus()
              .then((status) => {
                if (!active) return;
                syncUpdateStatus(status);
              })
              .catch((error) => {
                console.error("failed to refresh update status after automatic check error", error);
              });
          }),
        );

        return disposeAll;
      } catch (error) {
        disposeAll();
        console.error("failed to bind update event listeners", error);
        return () => undefined;
      }
    };

    const promise = bindEvents();

    return () => {
      active = false;
      void promise
        .then((dispose) => dispose())
        .catch((error) => {
          console.error("failed to dispose update event listeners", error);
        });
    };
  }, [syncUpdateStatus]);

  useEffect(() => {
    if (!aboutUpdateReminder.showText) return;
    const timer = window.setTimeout(() => {
      setAboutUpdateReminder((current) => dismissAboutUpdateReminderText(current));
    }, ABOUT_UPDATE_LABEL_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [aboutUpdateReminder.showText]);
  useEffect(() => {
    const unlisten = listen("notes-changed", () => {
      // 记录事件到达时的 epoch；其间用户一旦切换/加载了笔记，本次同步即过期，
      // 不再用过期的列表快照去改选中或回填内容，避免把选中"拉回"刚保存的旧笔记
      const epochAtEvent = loadEpoch.peek();
      const isStale = () => !loadEpoch.isCurrent(epochAtEvent);
      void refreshNotes()
        .then((loaded) => {
          if (isStale()) return;
          const currentId = selectedIdRef.current;
          if (!currentId) return;
          const stillExists = loaded.some((n) => n.id === currentId);
          if (stillExists) {
            if (saveStateRef.current !== "dirty" && saveStateRef.current !== "saving") {
              void getNote(currentId)
                .then((note) => {
                  if (isStale()) return;
                  if (selectedIdRef.current !== currentId) return;
                  if (saveStateRef.current === "dirty" || saveStateRef.current === "saving") {
                    return;
                  }
                  titleValueRef.current = note.title;
                  contentValueRef.current = note.content;
                  saveStateRef.current = "saved";
                  setTitle(note.title);
                  setContent(note.content);
                  setSaveState("saved");
                })
                .catch(() => undefined);
            }
          } else if (selectedNoteRef.current) {
            if (loaded[0]) {
              void loadNote(loaded[0].id);
            } else {
              clearCurrentNote();
            }
          }
        })
        .catch(() => undefined);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refreshNotes, loadNote, clearCurrentNote, loadEpoch]);

  useEffect(() => {
    const unlisten = listen<SyncLayoutEvent>("sync-layout-applied", ({ payload }) => {
      setCategoryOrder(payload.categoryOrder);
      setNoteOrder(payload.noteOrder);
      void refreshNotes();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refreshNotes]);

  useEffect(() => {
    function handleFocus() {
      void refreshNotes();
    }
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshNotes]);

  useEffect(() => {
    const onResize = () => setSettingsOverlay(window.innerWidth < 1080);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("open-external-file", (event) => {
      void loadExternalFile(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [loadExternalFile]);

  useEffect(() => {
    const TEXT_RE = /\.(md|markdown|txt)$/i;
    const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const textPaths: string[] = [];
      const imagePaths: string[] = [];

      for (const p of event.payload.paths) {
        if (TEXT_RE.test(p)) textPaths.push(p);
        else if (IMAGE_RE.test(p)) imagePaths.push(p);
      }

      for (const p of textPaths) {
        void loadExternalFile(p);
      }

      if (imagePaths.length > 0 && selectedIdRef.current && !isExternalRef.current) {
        const noteId = selectedIdRef.current;
        void (async () => {
          const textarea = contentRef.current;
          if (!textarea) return;
          try {
            const rels = await Promise.all(imagePaths.map((p) => saveImageFromPath(noteId, p)));
            const markdown = rels.map((rel) => `![](${rel})`).join("\n");
            insertTextAtCursor(textarea, setContent, markdown);
            saveStateRef.current = "dirty";
            setSaveState("dirty");
          } catch (error) {
            showToast(getErrorMessage(error));
          }
        })();
      }
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [loadExternalFile, setContent]);

  useEffect(() => {
    const unlisten = listen<string>("open-note", (event) => {
      void loadNote(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [loadNote]);

  useEffect(() => {
    const unlisten = listen("open-about-panel", () => {
      openAboutPanel();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [openAboutPanel]);

  useEffect(() => {
    const unlisten = listen<string>("shortcut-register-failed", (event) => {
      showToast(event.payload, "warning");
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>(TILE_WINDOW_CLOSED_EVENT, (event) => {
      setPinnedTileIds((previous) => syncPinnedTileIds(previous, event.payload, false));
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>(TILE_WINDOW_UNPINNED_EVENT, (event) => {
      setPinnedTileIds((previous) => syncPinnedTileIds(previous, event.payload, false));
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!selectedExternalFile) return;

    const interval = window.setInterval(async () => {
      if (Date.now() - lastExternalSaveRef.current < 2000) return;
      try {
        const mtime = await getFileModifiedTime(selectedExternalFile.filePath);
        if (selectedIdRef.current !== selectedExternalFile.id) return;
        if (mtime !== externalFileMtimeRef.current) {
          externalFileMtimeRef.current = mtime;
          const fileContent = await readExternalFile(selectedExternalFile.filePath);
          if (selectedIdRef.current !== selectedExternalFile.id) return;
          contentValueRef.current = fileContent;
          saveStateRef.current = "saved";
          setContent(fileContent);
          setSaveState("saved");
        }
      } catch {
        // file may have been deleted or become inaccessible
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [selectedExternalFile]);

  useEffect(() => {
    function closeMenus() {
      setNoteMenuClosing(true);
      setCategoryMenuClosing(true);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenus();
    }

    document.addEventListener("mousedown", closeMenus);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", closeMenus);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!noteMenuClosing || !noteMenu) return;
    const timer = window.setTimeout(() => {
      setNoteMenu(null);
      setNoteMenuClosing(false);
      setNoteMenuMode("main");
    }, 150);
    return () => window.clearTimeout(timer);
  }, [noteMenuClosing, noteMenu]);

  useEffect(() => {
    if (!categoryMenuClosing || !categoryMenu) return;
    const timer = window.setTimeout(() => {
      setCategoryMenu(null);
      setCategoryMenuClosing(false);
      setCategoryMenuConfirmDelete(false);
      setCategoryMenuHoverSuppressed(false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [categoryMenuClosing, categoryMenu]);

  useEffect(() => {
    if (!categoryMenuHoverSuppressed || !categoryMenu) return;
    const releaseHover = () => setCategoryMenuHoverSuppressed(false);
    window.addEventListener("mousemove", releaseHover, { once: true });
    window.addEventListener("mousedown", releaseHover, { once: true });
    return () => {
      window.removeEventListener("mousemove", releaseHover);
      window.removeEventListener("mousedown", releaseHover);
    };
  }, [categoryMenuHoverSuppressed, categoryMenu]);

  const switchCategoryMenuPanel = useCallback((confirmDelete: boolean) => {
    setCategoryMenuHoverSuppressed(true);
    setCategoryMenuConfirmDelete(confirmDelete);
    (document.activeElement as HTMLElement | null)?.blur();
  }, []);

  const performSave = useCallback(
    async (force: boolean): Promise<boolean> => {
      // 非强制保存（自动保存、切换前保存）在没有未保存修改时直接视为成功
      if (!force && saveStateRef.current !== "dirty") return true;
      const id = selectedIdRef.current;
      if (!id) return false;

      // 在保存瞬间对当前笔记做快照；之后用户切换笔记不影响本次写入的内容，
      // 保存完成后也只在"仍停留在这篇笔记"时才更新保存状态
      const titleSnapshot = titleValueRef.current;
      const contentSnapshot = contentValueRef.current;
      const stillCurrent = () => selectedIdRef.current === id;
      const settleSaveState = (state: SaveState) => {
        if (!stillCurrent()) return;
        saveStateRef.current = state;
        setSaveState(state);
      };

      const externalFile = externalFilesRef.current.find((file) => file.id === id) ?? null;

      settleSaveState("saving");
      try {
        if (externalFile) {
          await saveExternalFile(externalFile.filePath, contentSnapshot);
          lastExternalSaveRef.current = Date.now();
          const mtime = await getFileModifiedTime(externalFile.filePath);
          if (stillCurrent()) {
            externalFileMtimeRef.current = mtime;
          }
          settleSaveState(contentValueRef.current === contentSnapshot ? "saved" : "dirty");
        } else {
          const category = notesRef.current.find((note) => note.id === id)?.category ?? "";
          const note = await updateNote(id, {
            title: titleSnapshot,
            content: contentSnapshot,
            category,
          });
          replaceNoteMetadata(note);
          const contentChanged =
            contentValueRef.current !== contentSnapshot || titleValueRef.current !== titleSnapshot;
          settleSaveState(contentChanged ? "dirty" : "saved");
        }
        return true;
      } catch (error) {
        settleSaveState("error");
        showToast(getErrorMessage(error));
        return false;
      }
    },
    [replaceNoteMetadata],
  );

  const saveCurrentNote = useCallback(
    (force = false): Promise<boolean> => {
      const run = saveQueueRef.current.then(() => performSave(force));
      saveQueueRef.current = run.catch(() => undefined);
      return run;
    },
    [performSave],
  );

  const settleManualSyncState = useCallback(
    (state: Exclude<ManualSyncState, "syncing">, resetDelay = 2200) => {
      if (manualSyncResetTimerRef.current) {
        window.clearTimeout(manualSyncResetTimerRef.current);
      }
      setManualSyncState(state);
      if (state !== "idle") {
        manualSyncResetTimerRef.current = window.setTimeout(() => {
          setManualSyncState("idle");
          manualSyncResetTimerRef.current = null;
        }, resetDelay);
      }
    },
    [],
  );

  const handleManualSync = useCallback(async () => {
    if (manualSyncState === "syncing") return;
    if (manualSyncResetTimerRef.current) {
      window.clearTimeout(manualSyncResetTimerRef.current);
      manualSyncResetTimerRef.current = null;
    }
    setManualSyncState("syncing");

    if (saveStateRef.current === "dirty" || saveStateRef.current === "saving") {
      const saved = await saveCurrentNote();
      if (!saved) {
        showToast(
          t("main.window.manualSyncSaveFailed", {
            defaultValue: "当前笔记保存失败，未开始同步",
          }),
          "warning",
        );
        settleManualSyncState("error");
        return;
      }
    }

    try {
      const status = await getSyncStatus();
      if (!status.settings.enabled) {
        showToast(
          t("main.window.manualSyncDisabled", {
            defaultValue: "请先在设置中启用 GitHub 同步",
          }),
          "warning",
        );
        settleManualSyncState("error");
        return;
      }

      const result = await syncNow({ categoryOrder, noteOrder });
      const message = result.changed
        ? t("main.window.manualSyncChanged", {
            uploaded: result.uploaded,
            downloaded: result.downloaded,
            defaultValue: "同步完成：上传 {{uploaded}}，下载 {{downloaded}}",
          })
        : t("main.window.manualSyncUnchanged", {
            defaultValue: "同步完成，本地与 GitHub 已经一致",
          });
      showToast(
        result.conflicts
          ? t("main.window.manualSyncConflicts", {
              message,
              conflicts: result.conflicts,
              defaultValue: "{{message}}；保留了 {{conflicts}} 个冲突副本",
            })
          : message,
        "info",
      );
      settleManualSyncState("success");
    } catch (error) {
      showToast(getErrorMessage(error));
      settleManualSyncState("error");
    }
  }, [categoryOrder, manualSyncState, noteOrder, saveCurrentNote, settleManualSyncState, t]);

  useEffect(
    () => () => {
      if (manualSyncResetTimerRef.current) {
        window.clearTimeout(manualSyncResetTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const unlisten = listen<UpdateInstallPrepareRequest>("update://prepare-install", (event) => {
      const respond = async () => {
        const windowLabel = windowLabelRef.current;
        // 无未保存修改时直接上报就绪：避免排进 saveQueueRef，被正在执行的
        // 防抖自动保存拖住、不必要地延迟安装准备响应
        if (saveStateRef.current !== "dirty") {
          await reportInstallPreparation(event.payload.requestId, windowLabel, "ready");
          return;
        }
        const saved = await saveCurrentNote();
        await reportInstallPreparation(
          event.payload.requestId,
          windowLabel,
          saved ? "ready" : "failed",
          saved
            ? undefined
            : t("settings.update.error.installSaveFailed", {
                defaultValue: "安装前自动保存失败，请先处理当前笔记后重试",
              }),
        );
      };

      void respond().catch(async (error) => {
        await reportInstallPreparation(
          event.payload.requestId,
          windowLabelRef.current,
          "failed",
          error instanceof Error
            ? error.message
            : t("settings.update.error.installSaveFailed", {
                defaultValue: "安装前自动保存失败，请先处理当前笔记后重试",
              }),
        ).catch(() => undefined);
      });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [saveCurrentNote, t]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        void saveCurrentNote(true);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [saveCurrentNote]);

  useEffect(() => {
    if (!selectedId || saveState !== "dirty") return undefined;
    if (isExternal) {
      if (!settingsConfig?.externalFileAutoSave) return undefined;
    } else {
      if (!settingsConfig?.noteAutoSave) return undefined;
    }

    const timer = window.setTimeout(() => {
      void saveCurrentNote();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [
    // content 与 title 用于在持续输入时不断重置防抖计时器
    content,
    title,
    isExternal,
    saveCurrentNote,
    saveState,
    selectedId,
    settingsConfig?.noteAutoSave,
    settingsConfig?.externalFileAutoSave,
  ]);

  const handleNewNote = async () => {
    await saveCurrentNote();
    try {
      const note = await createNote({ title: "", content: "", category: activeCategory });
      replaceNoteMetadata(note);
      applyNote(note);
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleOpenSettings = async () => {
    if (settingsOpen) {
      setSettingsOpen(false);
      return;
    }
    setSettingsOpen(true);
    setAboutOpen(false);
    setActivityOpen(false);
    if (settingsConfig) return;
    try {
      const config = await getConfig();
      setSettingsConfig(config);
      setSavedDataDir(config.dataDir);
      setViewMode(normalizeViewMode(config.defaultViewMode));
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleOpenDataDir = async () => {
    if (!settingsConfig) return;
    try {
      const dir = await chooseDataDirectory();
      if (!dir) return;
      const confirmed = window.confirm(
        t("settings.openFolderConfirm", {
          dir,
          defaultValue:
            "将直接把「{{dir}}」设为当前工作文件夹并载入其中的 Markdown，只新增 metadata.json，不创建 notes 子文件夹。原工作文件夹会完整保留。是否继续？",
        }),
      );
      if (!confirmed) return;
      if (
        (saveStateRef.current === "dirty" || saveStateRef.current === "saving") &&
        !(await saveCurrentNote())
      ) {
        return;
      }
      clearCurrentNote();
      setExternalFiles([]);
      setSearchQuery("");
      setActiveCategory("");
      const savedConfig = await openDataDirectory(dir);
      setSettingsConfig(savedConfig);
      setSavedDataDir(savedConfig.dataDir);
      const loadedNotes = await refreshNotes();
      if (loadedNotes[0]) {
        await loadNote(loadedNotes[0].id);
      }
      showToast(
        t("settings.openFolderSuccess", {
          count: loadedNotes.length,
          defaultValue: "工作文件夹已切换，共载入 {{count}} 篇 Markdown",
        }),
      );
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const settingsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistSettings = useCallback(
    (nextConfig: AppConfig) => {
      if (settingsSaveTimer.current) {
        clearTimeout(settingsSaveTimer.current);
      }
      settingsSaveTimer.current = setTimeout(async () => {
        const previousDataDir = savedDataDir ?? nextConfig.dataDir;
        const normalizedConfig = {
          ...nextConfig,
          defaultViewMode: normalizeViewMode(nextConfig.defaultViewMode),
          tileColor: normalizeTileColor(nextConfig.tileColor),
        };
        try {
          const savedConfig = await saveConfig(normalizedConfig);
          setSettingsConfig(savedConfig);
          setSavedDataDir(savedConfig.dataDir);
          setViewMode(normalizeViewMode(savedConfig.defaultViewMode));

          if (savedConfig.dataDir !== previousDataDir) {
            const loadedNotes = await refreshNotes();
            if (loadedNotes[0]) {
              await loadNote(loadedNotes[0].id);
            } else {
              clearCurrentNote();
            }
          }
        } catch (error) {
          showToast(getErrorMessage(error));
        }
      }, 300);
    },
    [savedDataDir, refreshNotes, loadNote, clearCurrentNote],
  );

  const handleSettingsChange = useCallback(
    (nextConfig: AppConfig) => {
      settingsConfigRef.current = nextConfig;
      setSettingsConfig(nextConfig);
      void emit("config-changed", nextConfig);
      persistSettings(nextConfig);
    },
    [persistSettings],
  );

  const setEditorFontSize = useCallback(
    (fontSize: number) => {
      const currentConfig = settingsConfigRef.current;
      if (!currentConfig) return;
      const normalizedFontSize = Math.min(
        MAX_EDITOR_FONT_SIZE,
        Math.max(MIN_EDITOR_FONT_SIZE, Math.round(fontSize)),
      );
      if ((currentConfig.fontSize ?? DEFAULT_EDITOR_FONT_SIZE) === normalizedFontSize) return;
      handleSettingsChange({ ...currentConfig, fontSize: normalizedFontSize });
    },
    [handleSettingsChange],
  );

  useEffect(() => {
    settingsConfigRef.current = settingsConfig;
  }, [settingsConfig]);

  useEffect(() => {
    const editorArea = splitContainerRef.current;
    if (!editorArea) return undefined;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".mermaid-diagram-viewport")) return;

      event.preventDefault();
      const currentFontSize = settingsConfigRef.current?.fontSize ?? DEFAULT_EDITOR_FONT_SIZE;
      setEditorFontSize(currentFontSize + (event.deltaY < 0 ? 1 : -1));
    };
    editorArea.addEventListener("wheel", handleWheel, { passive: false });
    return () => editorArea.removeEventListener("wheel", handleWheel);
  }, [setEditorFontSize, viewMode]);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const handleOpenActivity = useCallback(() => {
    setActivityOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setSettingsOpen(false);
        setAboutOpen(false);
      }
      return nextOpen;
    });
  }, []);

  const handleCloseActivity = useCallback(() => {
    setActivityOpen(false);
  }, []);

  const handleOpenAbout = useCallback(() => {
    setAboutOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setSettingsOpen(false);
        setActivityOpen(false);
        setAboutUpdateReminder((current) => dismissAboutUpdateReminderText(current));
      }
      return nextOpen;
    });
  }, []);

  const handleCloseAbout = useCallback(() => {
    setAboutOpen(false);
  }, []);

  const handleImportNote = async () => {
    try {
      const saved = await saveCurrentNote();
      if (!saved) return;

      const note = await importSupportedDocument(activeCategory);
      if (!note) return;

      replaceNoteMetadata(note);
      applyNote(note);
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleSelectNote = async (id: string) => {
    if (id === selectedId) return;
    setDeleteConfirm(false);
    // 排队保存：等待可能在途的自动保存，并把尚未落盘的修改一并存掉
    await saveCurrentNote();

    setIsLoading(true);
    try {
      await loadNote(id);
    } catch (error) {
      showToast(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectExternalFile = async (id: string) => {
    if (id === selectedId) return;
    setDeleteConfirm(false);
    await saveCurrentNote();

    const file = externalFiles.find((f) => f.id === id);
    if (!file) return;

    setIsLoading(true);
    const epoch = loadEpoch.bump();
    try {
      const [fileContent, mtime] = await Promise.all([
        readExternalFile(file.filePath),
        getFileModifiedTime(file.filePath),
      ]);
      if (!loadEpoch.isCurrent(epoch)) return;
      selectedIdRef.current = id;
      titleValueRef.current = file.title;
      contentValueRef.current = fileContent;
      saveStateRef.current = "saved";
      setSelectedId(id);
      setTitle(file.title);
      setContent(fileContent);
      setSaveState("saved");
      setNoteTransitionKey((k) => k + 1);
      externalFileMtimeRef.current = mtime;
    } catch (error) {
      showToast(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveExternalFile = async (id: string) => {
    if (selectedId === id && saveState === "dirty") {
      const shouldSave = window.confirm(
        t("main.confirm.unsavedExternalFile", {
          title: title || t("common.untitledFile", { defaultValue: "未命名文件" }),
          defaultValue: "「{{title}}」有未保存的更改，是否保存到原文件？",
        }),
      );
      if (shouldSave) {
        const saved = await saveCurrentNote();
        if (!saved) return;
      }
    }
    setExternalFiles((current) => current.filter((f) => f.id !== id));
    if (selectedId === id) {
      clearCurrentNote();
    }
  };

  const handleDeleteNote = async (noteId = selectedId) => {
    if (!noteId) return;

    setDeleteConfirm(false);
    try {
      const target = notesRef.current.find((note) => note.id === noteId);
      const deleteOriginal = target?.documentKind === "docx"
        ? window.confirm(
            t("main.confirm.deleteOriginalWord", {
              defaultValue:
                "是否同时删除保留的原始 Word？选择“取消”只保留原件，转换后的笔记仍会删除。",
            }),
          )
        : true;
      await deleteNote(noteId, deleteOriginal);
      const remaining = await refreshNotes();
      if (noteId === selectedId && remaining[0]) {
        await loadNote(remaining[0].id);
      } else if (noteId === selectedId) {
        clearCurrentNote();
      }
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleOpenNoteMenu = (event: MouseEvent<HTMLElement>, noteId: string) => {
    event.preventDefault();
    event.stopPropagation();

    setNoteMenuClosing(false);
    setHoveredId(noteId);
    setNoteMenu({
      x: event.clientX,
      y: event.clientY,
      noteId,
    });
  };

  const handleExportNote = async (note: NoteMetadata) => {
    try {
      if (note.id === selectedId) {
        const saved = await saveCurrentNote();
        if (!saved) return;
      }

      await exportMarkdownNote({
        id: note.id,
        title: note.id === selectedId ? title : note.title,
      });
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleExportPdf = async (note: NoteMetadata) => {
    try {
      if (note.id === selectedId) {
        const saved = await saveCurrentNote();
        if (!saved) return;
      }

      const currentNote = await getNote(note.id);
      const dataBase64 = await renderMarkdownPdf({
        title: currentNote.title,
        content: currentNote.content,
        fontSize: settingsConfig?.fontSize ?? 14,
        renderHtml: settingsConfig?.renderHtmlMarkdown ?? false,
        imageBaseDir: imageBaseDir ?? undefined,
      });
      const exported = await exportPdfDocument(currentNote.title, dataBase64);
      if (exported) {
        showToast(t("noteMenu.pdfExported", { defaultValue: "PDF 已保存" }));
      }
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleSaveOriginalPdf = async (note: NoteMetadata) => {
    try {
      const bytes = await getPdfBytes(note.id);
      let binary = "";
      const chunkSize = 0x8000;
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
      }
      const exported = await exportPdfDocument(note.title, btoa(binary));
      if (exported) showToast(t("noteMenu.pdfExported", { defaultValue: "PDF 已保存" }));
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleOpenNoteAsNotepad = async (noteId: string) => {
    try {
      if (noteId === selectedId) {
        const saved = await saveCurrentNote();
        if (!saved) return;
      }

      await openNotepadWindow(noteId);
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleOpenNoteInFolder = async (noteId: string) => {
    try {
      const filePath = await getNoteFilePath(noteId);
      await revealItemInDir(filePath);
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleCopyNoteFilePath = async (noteId: string) => {
    try {
      const filePath = await getNoteFilePath(noteId);
      await writeText(filePath);
      showToast(t("noteMenu.filePathCopied", { defaultValue: "文件路径已复制" }));
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleOpenOriginalWord = async (noteId: string) => {
    try {
      const filePath = await getOriginalWordPath(noteId);
      await openPath(filePath);
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleRevealOriginalWord = async (noteId: string) => {
    try {
      const filePath = await getOriginalWordPath(noteId);
      await revealItemInDir(filePath);
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleNoteMenuAction = (action: NoteContextMenuAction) => {
    const note = noteMenuTarget;
    if (!note) return;

    if (action === "openNotepad") {
      setNoteMenuClosing(true);
      void handleOpenNoteAsNotepad(note.id);
      return;
    }

    if (action === "openInFolder") {
      setNoteMenuClosing(true);
      void handleOpenNoteInFolder(note.id);
      return;
    }

    if (action === "copyFilePath") {
      setNoteMenuClosing(true);
      void handleCopyNoteFilePath(note.id);
      return;
    }

    if (action === "openOriginalWord") {
      setNoteMenuClosing(true);
      void handleOpenOriginalWord(note.id);
      return;
    }

    if (action === "revealOriginalWord") {
      setNoteMenuClosing(true);
      void handleRevealOriginalWord(note.id);
      return;
    }

    if (action === "exportMarkdown") {
      setNoteMenuClosing(true);
      void handleExportNote(note);
      return;
    }

    if (action === "exportPdf") {
      setNoteMenuClosing(true);
      void handleExportPdf(note);
      return;
    }

    if (action === "saveOriginalPdf") {
      setNoteMenuClosing(true);
      void handleSaveOriginalPdf(note);
      return;
    }

    if (action === "move") {
      setNoteMenuMode("move");
      return;
    }

    setNoteMenuClosing(true);
    void handleDeleteNote(note.id);
  };

  const handleMoveNote = async (noteId: string, targetCategory: string) => {
    setNoteMenuClosing(true);
    try {
      await moveNoteCategory(noteId, targetCategory);
      await refreshNotes();
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const importDroppedMarkdownFiles = async (
    markdownFiles: File[],
    targetCategory: string,
    selectImportedNote: boolean,
  ) => {
    let lastImportedNote: Note | null = null;
    for (const file of markdownFiles) {
      const fileContent = await file.text();
      const headingTitle = fileContent
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*#\s+(.+?)\s*$/)?.[1] ?? "")
        .find(Boolean);
      const fallbackTitle = file.name.replace(/\.(?:md|markdown)$/i, "");
      const note = await createNote({
        title: headingTitle || fallbackTitle,
        content: fileContent,
        category: targetCategory,
      });
      replaceNoteMetadata(note);
      lastImportedNote = note;
    }

    await refreshNotes();
    if (selectImportedNote && lastImportedNote) {
      applyNote(lastImportedNote);
      setActiveCategory(targetCategory);
    }
    showToast(
      t("main.category.markdownImported", {
        count: markdownFiles.length,
        defaultValue: "已导入 {{count}} 个 Markdown 文件",
      }),
    );
  };

  const handleDropOnCategory = async (
    event: ReactDragEvent<HTMLElement>,
    targetCategory: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    markdownDragDepthRef.current = 0;
    setMarkdownDropActive(false);
    setDragOverCategory(null);
    setDragOverNoteId(null);

    const internalNoteId =
      event.dataTransfer.getData("application/x-floral-note") ||
      event.dataTransfer.getData("text/plain");
    if (internalNoteId && notesRef.current.some((note) => note.id === internalNoteId)) {
      await handleMoveNote(internalNoteId, targetCategory);
      return;
    }

    const droppedFiles = Array.from(event.dataTransfer.files);
    if (droppedFiles.length === 0) return;
    const markdownFiles = droppedFiles.filter((file) => /\.(?:md|markdown)$/i.test(file.name));
    if (markdownFiles.length === 0) {
      showToast(
        t("main.category.markdownOnly", {
          defaultValue: "这里只接收 .md 或 .markdown 文件",
        }),
      );
      return;
    }

    try {
      await importDroppedMarkdownFiles(markdownFiles, targetCategory, false);
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleAppDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    markdownDragDepthRef.current += 1;
    setMarkdownDropActive(true);
  };

  const handleAppDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleAppDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    markdownDragDepthRef.current = Math.max(0, markdownDragDepthRef.current - 1);
    if (markdownDragDepthRef.current === 0) setMarkdownDropActive(false);
  };

  const handleAppDrop = async (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    markdownDragDepthRef.current = 0;
    setMarkdownDropActive(false);

    const markdownFiles = Array.from(event.dataTransfer.files).filter((file) =>
      /\.(?:md|markdown)$/i.test(file.name),
    );
    if (markdownFiles.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    try {
      if (selectedId) {
        const saved = await saveCurrentNote();
        if (!saved) return;
      }
      await importDroppedMarkdownFiles(markdownFiles, activeCategory, true);
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleNoteDragOver = (event: ReactDragEvent<HTMLElement>, targetNoteId: string) => {
    const sourceNoteId = draggedNoteId || event.dataTransfer.getData("application/x-floral-note");
    if (!sourceNoteId || sourceNoteId === targetNoteId || draggedCategory) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    setDragOverNoteId(targetNoteId);
    setNoteDropPosition(event.clientY < rect.top + rect.height / 2 ? "before" : "after");
    setDragOverCategory(null);
  };

  const handleNoteDrop = async (event: ReactDragEvent<HTMLElement>, targetNoteId: string) => {
    const sourceNoteId = draggedNoteId || event.dataTransfer.getData("application/x-floral-note");
    if (!sourceNoteId || sourceNoteId === targetNoteId) return;
    const sourceNote = notesRef.current.find((note) => note.id === sourceNoteId);
    const targetNote = notesRef.current.find((note) => note.id === targetNoteId);
    if (!sourceNote || !targetNote) return;

    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const position: NoteDropPosition =
      event.clientY < rect.top + rect.height / 2 ? "before" : "after";

    try {
      if (sourceNote.category !== targetNote.category) {
        await moveNoteCategory(sourceNoteId, targetNote.category);
      }
      setNoteOrder((current) =>
        moveNoteInOrder(
          current,
          notesRef.current.map((note) => note.id),
          sourceNoteId,
          targetNoteId,
          position,
        ),
      );
      await refreshNotes();
    } catch (error) {
      showToast(getErrorMessage(error));
    } finally {
      setDraggedNoteId(null);
      setDragOverNoteId(null);
      setDragOverCategory(null);
    }
  };

  const handleFolderDragOver = (event: ReactDragEvent<HTMLElement>, targetCategory: string) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverCategory(targetCategory);
    if (!draggedCategory) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setCategoryDropPosition(event.clientY < rect.top + rect.height / 2 ? "before" : "after");
  };

  const handleFolderHeaderDrop = (event: ReactDragEvent<HTMLElement>, targetCategory: string) => {
    const sourceCategory =
      draggedCategory || event.dataTransfer.getData("application/x-floral-category");
    if (!sourceCategory) {
      void handleDropOnCategory(event, targetCategory);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const position: CategoryDropPosition =
      event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setCategoryOrder((current) =>
      moveCategoryInOrder(current, categories, sourceCategory, targetCategory, position),
    );
    setDraggedCategory(null);
    setDragOverCategory(null);
  };

  const handleCreateCategory = async () => {
    const name = categoryInputValue.trim();
    if (!name) {
      setShowCategoryInput(false);
      return;
    }
    try {
      await createCategory(name);
      const nextCategories = [...categories, name].sort();
      setCategories(nextCategories);
      setCategoryOrder((current) => normalizeCategoryOrder(current, nextCategories));
      setShowCategoryInput(false);
      setCategoryInputValue("");
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleRenameCategory = async (oldName: string) => {
    const newName = renameCategoryValue.trim();
    if (!newName || newName === oldName) {
      setRenamingCategory(null);
      return;
    }

    try {
      await renameCategory(oldName, newName);
      setCategoryOrder((current) =>
        current.map((category) => (category === oldName ? newName : category)),
      );
      await refreshNotes();
      setRenamingCategory(null);
      setRenameCategoryValue("");
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleDeleteCategory = async (name: string) => {
    try {
      await deleteCategory(name);
      await refreshNotes();
      if (activeCategory === name) {
        setActiveCategory("");
      }
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const toggleCategoryCollapse = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const markDirty = () => {
    if (!selectedId) return;
    saveStateRef.current = "dirty";
    setSaveState("dirty");
  };

  const ensureNoteSaved = useCallback(async (): Promise<string | null> => {
    if (selectedId) return selectedId;
    try {
      const note = await createNote({ title, content, category: activeCategory });
      replaceNoteMetadata(note);
      applyNote(note);
      return note.id;
    } catch {
      return null;
    }
  }, [selectedId, title, content, activeCategory, replaceNoteMetadata, applyNote]);

  const {
    handlePaste: imagePasteHandler,
    handleDrop: imageDropHandler,
    handleDragOver: imageDragOverHandler,
  } = useImagePaste({
    noteId: selectedId,
    textareaRef: contentRef,
    setContent,
    markDirty,
    onEnsureNoteSaved: ensureNoteSaved,
    disabled: isExternal,
    onError: showToast,
    t,
  });

  const handleRichEditorImageUpload = useCallback(
    async (file: File) => {
      if (isExternal) {
        throw new Error(
          t("errors.externalImageUploadUnsupported", {
            defaultValue: "外部 Markdown 文件暂不支持保存本地图片，请使用图片网址。",
          }),
        );
      }

      const noteId = selectedId ?? (await ensureNoteSaved());
      if (!noteId) {
        throw new Error(t("errors.imagePasteFailed", { defaultValue: "图片粘贴失败" }));
      }

      try {
        return await saveImageFile(file, noteId, t);
      } catch (error) {
        showToast(getErrorMessage(error));
        throw error;
      }
    },
    [ensureNoteSaved, isExternal, selectedId, t],
  );

  const handleCleanUnusedImages = async () => {
    if (!selectedId || isExternal) return;
    try {
      const removed = await cleanUnusedImages(selectedId, content);
      if (removed.length > 0) {
        showToast(
          t("main.images.cleaned", {
            count: removed.length,
            defaultValue: "已清理 {{count}} 张图片",
          }),
          "info",
        );
      } else {
        showToast(t("main.images.cleanedNone", { defaultValue: "没有需要清理的图片" }), "info");
      }
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleUndo = () => {
    if (!selectedId) return;
    const textarea = contentRef.current;
    if (runEditorCommand(textarea, "undo")) {
      setContent(textarea?.value ?? content);
      markDirty();
      return;
    }
    richEditorRef.current?.focus(() => document.execCommand("undo"));
  };

  const handleOutlineHeadingClick = useCallback((headingIndex: number) => {
    const preview = previewScrollRef.current;
    const root = preview?.querySelector<HTMLElement>(".markdown-content-editor__content");
    const heading = root?.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")[headingIndex];
    if (!heading || !preview) return;

    const scrollContainer = findVerticalScrollContainer(heading, preview);
    if (!scrollContainer) return;

    // Repair any stale document-level offset left by older builds, then only scroll the editor.
    restoreDocumentScrollOrigin();
    scrollElementWithinContainer(heading, scrollContainer, {
      behavior: "smooth",
      block: "center",
    });
  }, []);

  const handleRedo = () => {
    if (!selectedId) return;
    const textarea = contentRef.current;
    if (runEditorCommand(textarea, "redo")) {
      setContent(textarea?.value ?? content);
      markDirty();
      return;
    }
    richEditorRef.current?.focus(() => document.execCommand("redo"));
  };

  const handleReloadFromDisk = useCallback(async () => {
    const noteId = selectedIdRef.current;
    if (!noteId || isReloadingFromDisk || saveStateRef.current === "saving") return;

    const hadUnsavedChanges = saveStateRef.current === "dirty";
    if (
      hadUnsavedChanges &&
      !window.confirm(
        t("main.confirm.reloadFromDisk", {
          defaultValue: "当前有未保存的修改。从磁盘重新加载会放弃这些修改，是否继续？",
        }),
      )
    ) {
      return;
    }

    // 先取消可能尚在等待的自动保存，避免用户确认放弃的内容反过来覆盖磁盘文件。
    if (hadUnsavedChanges) {
      saveStateRef.current = "idle";
      setSaveState("idle");
    }
    setIsReloadingFromDisk(true);

    try {
      const externalFile = externalFilesRef.current.find((file) => file.id === noteId) ?? null;
      if (externalFile) {
        const epoch = loadEpoch.bump();
        const [fileContent, mtime] = await Promise.all([
          readExternalFile(externalFile.filePath),
          getFileModifiedTime(externalFile.filePath),
        ]);
        if (!loadEpoch.isCurrent(epoch) || selectedIdRef.current !== noteId) return;

        contentValueRef.current = fileContent;
        saveStateRef.current = "saved";
        externalFileMtimeRef.current = mtime;
        setContent(fileContent);
        setSaveState("saved");
        setNoteTransitionKey((key) => key + 1);
      } else {
        const loadedNotes = await refreshNotes();
        if (selectedIdRef.current !== noteId) return;
        if (!loadedNotes.some((note) => note.id === noteId)) {
          clearCurrentNote();
          showToast(
            t("main.editor.reloadMissing", {
              defaultValue: "磁盘中的这篇笔记已不存在，已从列表移除",
            }),
            "warning",
          );
          return;
        }
        await loadNote(noteId);
      }

      if (selectedIdRef.current === noteId) {
        showToast(t("main.editor.reloadedFromDisk", { defaultValue: "已从磁盘重新加载" }), "info");
      }
    } catch (error) {
      if (hadUnsavedChanges && selectedIdRef.current === noteId) {
        saveStateRef.current = "dirty";
        setSaveState("dirty");
      }
      showToast(getErrorMessage(error));
    } finally {
      setIsReloadingFromDisk(false);
    }
  }, [clearCurrentNote, isReloadingFromDisk, loadEpoch, loadNote, refreshNotes, t]);

  const handleOpenNotepad = async () => {
    if (!selectedNote) return;
    await handleOpenNoteAsNotepad(selectedNote.id);
  };

  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    void isCurrentWindowMaximized().then(setIsMaximized);
    const unlisten = getCurrentWindow().onResized(() => {
      void isCurrentWindowMaximized().then(setIsMaximized);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!isResizingSidebar) return;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (e: globalThis.MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX, 180), 500);
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => setIsResizingSidebar(false);

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    if (!isResizingSplit) return;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (e: globalThis.MouseEvent) => {
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      setSplitRatio(Math.min(Math.max(ratio, 0.2), 0.8));
    };
    const onMouseUp = () => setIsResizingSplit(false);

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizingSplit]);

  const cancelScrollMeasurement = useCallback(() => {
    if (measureDebounceRef.current) clearTimeout(measureDebounceRef.current);
    cancelAnimationFrame(measureRafRef.current);
    measureControllerRef.current?.abort();
  }, []);

  const scrollSyncEnabled = settingsConfig?.splitScrollSync ?? true;

  const resolvePreviewScroller = useCallback(() => {
    const preview = previewScrollRef.current;
    if (!preview) return null;
    // MDXEditor renders its scroll viewport after the surrounding React tree has
    // mounted. Prefer that structural viewport even when the document is still
    // too short to overflow; otherwise findVerticalScrollContainer falls back to
    // the non-scrolling wrapper and the reverse-sync listener is attached there.
    const editorViewport = preview.querySelector<HTMLElement>(
      ".markdown-content-editor__root > div:last-child",
    );
    const previewContent = preview.querySelector<HTMLElement>(
      ".markdown-content-editor__content, .font-body",
    );
    const scroller =
      editorViewport ??
      (previewContent ? findVerticalScrollContainer(previewContent, preview) : preview);
    previewScrollerRef.current = scroller;
    return scroller;
  }, []);

  const scheduleScrollMeasurement = useCallback(
    (delayMs: number) => {
      if (viewMode !== "content-source" || !scrollSyncEnabled) return;
      if (!contentRef.current || !previewScrollRef.current) return;

      // 布局和测量稳定前先清空旧偏移量
      blockOffsets.current = [];
      previewBlockOffsets.current = [];
      cancelScrollMeasurement();

      const controller = new AbortController();
      measureControllerRef.current = controller;

      const measure = async () => {
        if (!contentRef.current || !previewScrollRef.current) return;
        const offsets = await measureBlockOffsets(content, contentRef.current, controller.signal);
        if (controller.signal.aborted) return;
        blockOffsets.current = offsets;
        if (!controller.signal.aborted && previewScrollRef.current) {
          tagPreviewBlocks(previewScrollRef.current);
          const scroller = resolvePreviewScroller();
          if (scroller) {
            previewBlockOffsets.current = measurePreviewBlockOffsets(
              previewScrollRef.current,
              scroller,
            );
          }
        }
      };

      const runAfterLayout = () => {
        measureRafRef.current = requestAnimationFrame(() => {
          void measure();
        });
      };

      if (delayMs > 0) {
        measureDebounceRef.current = setTimeout(runAfterLayout, delayMs);
      } else {
        runAfterLayout();
      }
    },
    [cancelScrollMeasurement, content, resolvePreviewScroller, scrollSyncEnabled, viewMode],
  );

  // 切换笔记时通过 rAF 测量（不阻塞首帧渲染），编辑时 debounce 避免频繁重排
  useEffect(() => {
    if (viewMode !== "content-source" || !scrollSyncEnabled) {
      blockOffsets.current = [];
      previewBlockOffsets.current = [];
      cancelScrollMeasurement();
      return;
    }

    const isNoteSwitch = prevSelectedIdRef.current !== selectedId;
    prevSelectedIdRef.current = selectedId;
    scheduleScrollMeasurement(isNoteSwitch ? 0 : 250);

    return () => {
      cancelScrollMeasurement();
    };
  }, [
    cancelScrollMeasurement,
    content,
    scrollSyncEnabled,
    scheduleScrollMeasurement,
    selectedId,
    settingsConfig?.fontSize,
    settingsConfig?.renderHtmlMarkdown,
    splitRatio,
    viewMode,
  ]);

  useEffect(() => {
    if (viewMode !== "content-source") return;

    const observedElements: Element[] = [];
    if (splitContainerRef.current) observedElements.push(splitContainerRef.current);
    if (contentRef.current) observedElements.push(contentRef.current);
    if (previewScrollRef.current) observedElements.push(previewScrollRef.current);
    const previewContent = previewScrollRef.current?.querySelector(
      ".markdown-content-editor__content, .font-body",
    );
    if (previewContent) observedElements.push(previewContent);

    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => scheduleScrollMeasurement(120);
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }

    if (observedElements.length === 0) return;

    const observer = new ResizeObserver(() => {
      scheduleScrollMeasurement(120);
    });
    observedElements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, [scheduleScrollMeasurement, viewMode]);

  // Reset preview scroll on note switch
  useEffect(() => {
    const preview = previewScrollRef.current;
    if (preview) preview.scrollTop = 0;
    const scroller = resolvePreviewScroller();
    if (scroller) scroller.scrollTop = 0;
  }, [resolvePreviewScroller, selectedId]);

  const handleEditorScroll = useCallback(() => {
    if (viewMode !== "content-source" || !scrollSyncEnabled) return;
    if (scrollSource.current === "preview") return;

    const textarea = contentRef.current;
    const preview = previewScrollRef.current;
    if (!textarea || !preview) return;

    scrollSource.current = "editor";
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      scrollSource.current = null;
    }, 150);

    const scrollContainer = previewScrollerRef.current ?? resolvePreviewScroller();
    if (!scrollContainer) return;
    scrollContainer.scrollTop = mapScrollPosition({
      sourceScrollTop: textarea.scrollTop,
      sourceOffsets: blockOffsets.current,
      targetOffsets: previewBlockOffsets.current,
      sourceMaxScroll: textarea.scrollHeight - textarea.clientHeight,
      targetMaxScroll: scrollContainer.scrollHeight - scrollContainer.clientHeight,
    });
  }, [resolvePreviewScroller, scrollSyncEnabled, viewMode]);

  const handlePreviewScroll = useCallback(() => {
    if (viewMode !== "content-source" || !scrollSyncEnabled) return;
    if (scrollSource.current === "editor") return;

    const textarea = contentRef.current;
    const preview = previewScrollRef.current;
    if (!textarea || !preview) return;

    scrollSource.current = "preview";
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      scrollSource.current = null;
    }, 150);

    const scrollContainer = previewScrollerRef.current ?? resolvePreviewScroller();
    if (!scrollContainer) return;
    textarea.scrollTop = mapScrollPosition({
      sourceScrollTop: scrollContainer.scrollTop,
      sourceOffsets: previewBlockOffsets.current,
      targetOffsets: blockOffsets.current,
      sourceMaxScroll: scrollContainer.scrollHeight - scrollContainer.clientHeight,
      targetMaxScroll: textarea.scrollHeight - textarea.clientHeight,
    });
  }, [resolvePreviewScroller, scrollSyncEnabled, viewMode]);

  useEffect(() => {
    if (viewMode !== "content-source" || !scrollSyncEnabled) return;
    const preview = previewScrollRef.current;
    if (!preview) return;

    let boundScroller: HTMLElement | null = null;
    const bindScroller = () => {
      const nextScroller = resolvePreviewScroller();
      if (!nextScroller || nextScroller === boundScroller) return;
      boundScroller?.removeEventListener("scroll", handlePreviewScroll);
      nextScroller.addEventListener("scroll", handlePreviewScroll, { passive: true });
      boundScroller = nextScroller;
    };

    bindScroller();

    // The MDXEditor viewport can be inserted or replaced after this effect runs
    // (for example when changing notes). Rebind instead of leaving the listener
    // on the outer overflow-hidden wrapper.
    const observer = new MutationObserver(bindScroller);
    observer.observe(preview, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      boundScroller?.removeEventListener("scroll", handlePreviewScroll);
    };
  }, [handlePreviewScroll, resolvePreviewScroller, scrollSyncEnabled, selectedId, viewMode]);

  const handlePinEntry = async () => {
    if (!selectedId) return;
    const isPinned = pinnedTileIds.has(selectedId);
    if (!isPinned) {
      await saveCurrentNote();
    }
    try {
      const pinned = await toggleTileWindow(selectedId);
      setPinnedTileIds((previous) => {
        return syncPinnedTileIds(previous, selectedId, pinned);
      });
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const selectedTilePinned = selectedId ? pinnedTileIds.has(selectedId) : false;

  const toggleMaximize = () => {
    void toggleMaximizeCurrentWindow().then(() => isCurrentWindowMaximized().then(setIsMaximized));
  };

  const handleTitleBarMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    if (event.button !== 0) return;
    if (event.detail === 2) {
      toggleMaximize();
      return;
    }
    void startCurrentWindowDrag().catch(() => undefined);
  };

  const handleMinimize = () => {
    void minimizeCurrentWindow();
  };

  const handleMaximize = () => {
    toggleMaximize();
  };

  const handleClose = () => {
    void closeCurrentWindow();
  };
  const aboutButtonLabel = t("settings.update.title", { defaultValue: "更新" });
  const aboutButtonExpanded = aboutUpdateReminder.showText;
  const aboutButtonTitle = aboutUpdateReminder.hasPendingUpdate
    ? aboutButtonLabel
    : t("main.window.about", { defaultValue: "关于" });
  const quickNotepadButtonTitle = selectedNote?.documentKind === "pdf"
    ? t("main.window.pdfNotepadUnsupported", { defaultValue: "PDF 文档不支持快捷便签" })
    : selectedNote
      ? t("main.window.openCurrentAsNotepad", { defaultValue: "将当前笔记打开为快捷便签" })
    : selectedExternalFile
      ? t("main.window.externalNotepadUnsupported", {
          defaultValue: "外部文件暂不支持快捷便签",
        })
      : t("main.window.selectNoteForNotepad", { defaultValue: "请先选择一篇笔记" });
  const manualSyncButtonTitle =
    manualSyncState === "syncing"
      ? t("main.window.manualSyncing", { defaultValue: "正在同步…" })
      : manualSyncState === "success"
        ? t("main.window.manualSyncSuccess", { defaultValue: "同步完成" })
        : manualSyncState === "error"
          ? t("main.window.manualSyncFailed", { defaultValue: "同步失败，点击重试" })
          : t("main.window.manualSync", { defaultValue: "立即同步到 GitHub" });

  return (
    <div
      className="w-full h-screen min-h-0 overflow-clip flex flex-col"
      onDragEnter={handleAppDragEnter}
      onDragOver={handleAppDragOver}
      onDragLeave={handleAppDragLeave}
      onDrop={(event) => void handleAppDrop(event)}
    >
      {markdownDropActive && (
        <div className="pointer-events-none fixed inset-3 z-[10000] flex items-center justify-center rounded-2xl border-2 border-dashed border-bamboo/55 bg-cloud/88 backdrop-blur-sm">
          <div className="flex flex-col items-center rounded-2xl border border-paper-deep/70 bg-cloud px-10 py-8 shadow-xl shadow-ink/10">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-bamboo-mist text-bamboo">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3" />
              </svg>
            </div>
            <p className="text-[16px] font-medium text-ink">
              {t("main.category.markdownDropHint", { defaultValue: "松开即可导入 Markdown" })}
            </p>
            <p className="mt-2 text-[11px] text-ink-ghost">
              {t("main.category.markdownDropDetail", {
                defaultValue: "文件会放入当前文件夹",
              })}
            </p>
          </div>
        </div>
      )}
      <div
        data-testid="main-window-viewport"
        className="relative noise-bg bg-cloud min-h-0 overflow-clip flex flex-col flex-1"
      >
        <BackgroundLayer config={settingsConfig} />
        <div
          className={`relative z-10 flex items-center justify-between h-11 bg-paper/55 backdrop-blur-[1px] border-b border-paper-deep/30 shrink-0 select-none cursor-default ${
            isMacOS ? "pl-20 pr-5" : "pl-5 pr-0"
          }`}
          onMouseDown={handleTitleBarMouseDown}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[15px] font-serif font-medium text-ink-soft tracking-wide leading-none">
              花笺
            </span>
            <span className="text-[11px] text-ink-ghost font-body leading-none translate-y-px">
              —
            </span>
            <span className="text-[11px] text-ink-faint font-body truncate max-w-[240px] leading-none translate-y-px">
              <span data-testid="session-greeting">{sessionGreeting}</span>
            </span>
          </div>
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => void handleManualSync()}
              disabled={manualSyncState === "syncing"}
              data-testid="manual-sync-button"
              aria-label={manualSyncButtonTitle}
              aria-busy={manualSyncState === "syncing"}
              className={`w-10 h-11 flex items-center justify-center transition-all cursor-pointer disabled:cursor-wait ${
                manualSyncState === "success"
                  ? "text-bamboo bg-bamboo-mist/45"
                  : manualSyncState === "error"
                    ? "text-red-400 bg-red-50/45"
                    : "text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50"
              }`}
              title={manualSyncButtonTitle}
            >
              <ManualSyncIcon state={manualSyncState} />
            </button>
            <button
              onClick={() => void handleOpenNotepad()}
              disabled={!selectedNote || selectedNote.documentKind === "pdf"}
              data-testid="open-current-note-notepad"
              aria-label={quickNotepadButtonTitle}
              className="w-10 h-11 flex items-center justify-center text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-ink-ghost disabled:hover:bg-transparent"
              title={quickNotepadButtonTitle}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4h16v14H7l-3 3V4z" />
                <path d="M8 9h8M8 13h5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleOpenActivity}
              data-testid="open-activity-panel"
              className={`w-10 h-11 flex items-center justify-center transition-all cursor-pointer ${
                activityOpen
                  ? "text-bamboo bg-bamboo-mist/55"
                  : "text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50"
              }`}
              title="工作足迹"
              aria-label="打开工作足迹"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3.5" y="5" width="17" height="15" rx="2" />
                <path d="M7.5 3v4M16.5 3v4M7.5 10h9M8 14h.01M12 14h.01M16 14h.01" />
              </svg>
            </button>
            <button
              onClick={() => void handleOpenSettings()}
              className="w-10 h-11 flex items-center justify-center text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
              title={t("main.window.settings", { defaultValue: "设置" })}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button
              data-testid="main-about-button"
              onClick={handleOpenAbout}
              className={`h-11 flex items-center justify-center overflow-hidden text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-[width,padding,gap,background-color,color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] cursor-pointer ${
                aboutButtonExpanded ? "w-[72px] gap-1.5 px-3" : "w-10 gap-0 px-0"
              }`}
              title={aboutButtonTitle}
              aria-label={aboutButtonTitle}
            >
              {aboutUpdateReminder.hasPendingUpdate ? (
                <svg
                  data-testid="main-about-update-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 16V8" />
                  <path d="m8.5 11.5 3.5-3.5 3.5 3.5" />
                </svg>
              ) : (
                <svg
                  data-testid="main-about-info-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
              )}
              {aboutUpdateReminder.hasPendingUpdate ? (
                <span
                  data-testid="main-about-update-label"
                  className={`overflow-hidden whitespace-nowrap text-[11px] font-body leading-none transition-[max-width,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    aboutButtonExpanded
                      ? "max-w-[24px] translate-x-0 opacity-100"
                      : "max-w-0 translate-x-1 opacity-0"
                  }`}
                >
                  {aboutButtonLabel}
                </span>
              ) : null}
            </button>

            {!isMacOS && (
              <>
                <div className="w-px h-4 bg-paper-deep/30 mx-0.5" />

                <button
                  onClick={handleMinimize}
                  className="w-11 h-11 flex items-center justify-center text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-all cursor-pointer"
                  title={t("main.window.minimize", { defaultValue: "最小化" })}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <rect x="1" y="5.5" width="10" height="1" fill="currentColor" rx="0.5" />
                  </svg>
                </button>
                <button
                  onClick={handleMaximize}
                  className="w-11 h-11 flex items-center justify-center text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-all cursor-pointer"
                  title={
                    isMaximized
                      ? t("main.window.restore", { defaultValue: "还原" })
                      : t("main.window.maximize", { defaultValue: "最大化" })
                  }
                >
                  {isMaximized ? (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    >
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <path d="M3 5H2V2a1 1 0 0 1 1-1h5v1" />
                    </svg>
                  ) : (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    >
                      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={handleClose}
                  className="w-11 h-11 flex items-center justify-center text-ink-ghost hover:text-red-500 hover:bg-danger-bg transition-all cursor-pointer"
                  title={t("main.window.close", { defaultValue: "关闭" })}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <path d="M2 2l8 8M10 2l-8 8" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="relative z-10 flex flex-1 min-h-0">
          <div
            className="app-sidebar border-r border-paper-deep/30 bg-paper/40 shrink-0 overflow-hidden transition-[width] duration-[600ms]"
            style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
          >
            <div className="flex flex-col h-full" style={{ width: `${sidebarWidth}px` }}>
              <div className="px-3 pt-3 pb-2 shrink-0">
                <div className="flex items-center gap-2 px-2.5 h-8 rounded-lg bg-paper-warm/80 border border-paper-deep/40 focus-within:border-bamboo/30 focus-within:bg-cloud transition-all">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="text-ink-ghost shrink-0"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t("main.sidebar.searchPlaceholder", { defaultValue: "搜索笔记…" })}
                    className="flex-1 text-[12px] font-body text-ink placeholder:text-ink-ghost/60 bg-transparent"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="text-ink-ghost hover:text-ink-faint transition-colors cursor-pointer"
                      title={t("main.sidebar.clearSearch", { defaultValue: "清空搜索" })}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              <div className="px-3 pb-2 shrink-0 space-y-1">
                <button
                  onClick={handleNewNote}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-body text-bamboo hover:bg-bamboo-mist/60 transition-all cursor-pointer group"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="group-hover:rotate-90 transition-transform duration-200"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>{t("main.sidebar.newNote", { defaultValue: "新建笔记" })}</span>
                </button>
                <button
                  onClick={() => void handleImportNote()}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-body text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer group"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3v12" />
                    <path d="m7 10 5 5 5-5" />
                    <path d="M5 21h14" />
                  </svg>
                  <span>{t("main.sidebar.importDocument", { defaultValue: "导入文档" })}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowCategoryInput(true)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-body text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer group"
                  data-testid="new-folder-button"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2.5h6.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
                    <path d="M12 10v6M9 13h6" />
                  </svg>
                  <span>{t("main.sidebar.newFolder", { defaultValue: "新建文件夹" })}</span>
                </button>
              </div>

              <div className="flex items-center px-5 pb-1.5 shrink-0">
                <span className="text-[10px] text-ink-ghost font-mono tracking-wider uppercase">
                  {t("common.noteCount", {
                    count: filteredNotes.length,
                    defaultValue: "{{count}} 篇笔记",
                  })}
                  {externalFiles.length > 0
                    ? ` · ${t("common.externalFileCount", {
                        count: externalFiles.length,
                        defaultValue: "{{count}} 个外部文件",
                      })}`
                    : ""}
                </span>
              </div>

              {showCategoryInput && (
                <div className="px-3 pb-2 shrink-0">
                  <input
                    type="text"
                    autoFocus
                    value={categoryInputValue}
                    onChange={(e) => setCategoryInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleCreateCategory();
                      if (e.key === "Escape") {
                        setShowCategoryInput(false);
                        setCategoryInputValue("");
                      }
                    }}
                    onBlur={() => void handleCreateCategory()}
                    placeholder={t("main.category.placeholder", { defaultValue: "输入文件夹名…" })}
                    className="w-full px-2.5 h-7 rounded-lg text-[12px] font-body text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/30 placeholder:text-ink-ghost/60"
                  />
                </div>
              )}

              <div className="flex-1 overflow-y-auto px-2 pb-2">
                <div className="space-y-0.5">
                  <div className="sticky top-0 z-20 bg-cloud/95 px-1 pb-2 pt-0.5 backdrop-blur-sm">
                    <div
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition-all duration-200 ${
                        dragOverCategory === "" && !draggedCategory
                          ? "border-bamboo/45 bg-bamboo-mist shadow-sm"
                          : "border-dashed border-paper-deep/45 bg-paper-warm/70"
                      }`}
                      onDragOver={(event) => {
                        if (draggedCategory) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDragOverCategory("");
                      }}
                      onDragLeave={() => setDragOverCategory(null)}
                      onDrop={(event) => void handleDropOnCategory(event, "")}
                      data-testid="uncategorized-drop-zone"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-bamboo/60"
                      >
                        <path d="M4 5h16v14H4z" />
                        <path d="M8 9h8M8 13h5" />
                      </svg>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] text-ink-faint">
                          {t("main.category.uncategorized", { defaultValue: "未放入文件夹" })}
                        </span>
                        <span className="block text-[9px] text-ink-ghost/70">
                          {t("main.category.dropToRemove", {
                            defaultValue: "把笔记拖到这里即可移出文件夹",
                          })}
                        </span>
                      </span>
                      <span className="text-[9px] font-mono text-ink-ghost/70">
                        {uncategorizedCount}
                      </span>
                    </div>
                  </div>
                  {externalFiles.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] text-ink-ghost/50 font-mono tracking-wider uppercase">
                        {t("main.externalFiles.title", { defaultValue: "外部文件" })}
                      </div>
                      {externalFiles.map((file) => {
                        const isSelected = file.id === selectedId;
                        const isHovered = file.id === hoveredId;

                        return (
                          <button
                            key={file.id}
                            onClick={() => void handleSelectExternalFile(file.id)}
                            onMouseEnter={() => setHoveredId(file.id)}
                            onMouseLeave={() => setHoveredId(null)}
                            className={`w-full text-left rounded-xl px-3 py-2.5 transition-all duration-[600ms] cursor-pointer group relative ${
                              isSelected
                                ? "bg-bamboo-mist/70"
                                : isHovered
                                  ? "bg-paper-warm/70"
                                  : "bg-transparent"
                            }`}
                          >
                            <div
                              className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-bamboo/60 transition-all duration-[600ms] ${
                                isSelected ? "h-5 opacity-100" : "h-0 opacity-0"
                              }`}
                            />

                            <div className="flex items-baseline justify-between mb-0.5">
                              <span
                                className={`text-[13px] font-display font-medium truncate pr-2 transition-colors flex items-center gap-1.5 ${
                                  isSelected ? "text-bamboo" : "text-ink-soft"
                                }`}
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="shrink-0 opacity-60"
                                >
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                </svg>
                                {file.title}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveExternalFile(file.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 text-ink-ghost hover:text-red-400 transition-all p-0.5"
                                title={t("main.externalFiles.remove", {
                                  defaultValue: "从列表移除",
                                })}
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                >
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            </div>

                            <p className="text-[11px] text-ink-ghost leading-relaxed line-clamp-2 group-hover:text-ink-faint transition-colors pl-[18px]">
                              {file.filePath}
                            </p>
                          </button>
                        );
                      })}
                    </>
                  )}

                  {categoryGroups.map((group: CategoryGroup) => {
                    if (!group.category) {
                      return (
                        <div
                          key="__uncategorized__"
                          className={`rounded-lg transition-all duration-200 ${
                            dragOverCategory === "" ? "bg-bamboo/10 ring-1 ring-bamboo/20" : ""
                          }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setDragOverCategory("");
                          }}
                          onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                              setDragOverCategory(null);
                            }
                          }}
                          onDrop={(e) => {
                            void handleDropOnCategory(e, "");
                          }}
                        >
                          {group.notes.map((note) => {
                            const isSelected = note.id === selectedId;
                            const isHovered = note.id === hoveredId;
                            return (
                              <div
                                key={note.id}
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData("application/x-floral-note", note.id);
                                  e.dataTransfer.setData("text/plain", note.id);
                                  e.dataTransfer.effectAllowed = "move";
                                  setDraggedNoteId(note.id);
                                  setDragOverNoteId(null);
                                }}
                                onDragEnd={() => {
                                  setDraggedNoteId(null);
                                  setDragOverNoteId(null);
                                  setDragOverCategory(null);
                                }}
                                onDragOver={(event) => handleNoteDragOver(event, note.id)}
                                onDragLeave={() => setDragOverNoteId(null)}
                                onDrop={(event) => void handleNoteDrop(event, note.id)}
                                onClick={() => void handleSelectNote(note.id)}
                                onContextMenu={(event) => handleOpenNoteMenu(event, note.id)}
                                onMouseEnter={() => setHoveredId(note.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                className={`w-full text-left rounded-xl px-3 py-2.5 transition-all duration-[600ms] cursor-grab active:cursor-grabbing group relative ${
                                  isSelected
                                    ? "bg-bamboo-mist/70"
                                    : isHovered
                                      ? "bg-paper-warm/70"
                                      : "bg-transparent"
                                }`}
                              >
                                {draggedNoteId &&
                                  draggedNoteId !== note.id &&
                                  dragOverNoteId === note.id && (
                                    <span
                                      className={`pointer-events-none absolute left-2 right-2 z-20 h-0.5 rounded-full bg-bamboo/75 ${
                                        noteDropPosition === "before" ? "-top-px" : "-bottom-px"
                                      }`}
                                      data-testid="note-order-indicator"
                                    />
                                  )}
                                <div
                                  className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-bamboo/60 transition-all duration-[600ms] ${
                                    isSelected ? "h-5 opacity-100" : "h-0 opacity-0"
                                  }`}
                                />
                                <div className="flex items-baseline justify-between mb-0.5">
                                  <span
                                    className={`text-[13px] font-display font-medium truncate pr-2 transition-colors ${
                                      isSelected ? "text-bamboo" : "text-ink-soft"
                                    }`}
                                  >
                                    {getDisplayTitle(note, t)}
                                  </span>
                                  <DocumentTypeBadges note={note} />
                                  <div className="flex shrink-0 items-center gap-1">
                                    {note.documentKind !== "pdf" && (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void handleOpenNoteAsNotepad(note.id);
                                      }}
                                      className="relative z-10 flex h-5 w-5 items-center justify-center rounded-md text-ink-ghost opacity-0 transition-all hover:bg-bamboo-mist hover:text-bamboo focus:opacity-100 group-hover:opacity-100"
                                      title={t("noteMenu.openNotepad", {
                                        defaultValue: "作为快捷便签打开",
                                      })}
                                      aria-label={t("noteMenu.openNotepad", {
                                        defaultValue: "作为快捷便签打开",
                                      })}
                                    >
                                      <svg
                                        width="11"
                                        height="11"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      >
                                        <path d="M4 4h16v14H7l-3 3V4z" />
                                        <path d="M8 9h8M8 13h5" />
                                      </svg>
                                    </button>
                                    )}
                                    <span className="text-[10px] text-ink-ghost font-mono tabular-nums">
                                      {formatShortDate(note.updatedAt)}
                                    </span>
                                  </div>
                                </div>
                                <p className="text-[11px] text-ink-ghost leading-relaxed line-clamp-1 group-hover:text-ink-faint transition-colors">
                                  {note.preview ||
                                    t("common.blankNote", { defaultValue: "空白笔记" })}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                    {formatTime(note.updatedAt)}
                                  </span>
                                  <span className="text-[10px] text-ink-ghost/40">·</span>
                                  <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                    {t("common.wordCount", {
                                      count: note.wordCount,
                                      defaultValue: "{{count}} 字",
                                    })}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }

                    const isCollapsed = collapsedCategories.has(group.category);

                    return (
                      <div key={group.category} className="px-2 mb-0.5">
                        <div
                          className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg group/cat cursor-pointer select-none transition-all duration-200 ${
                            dragOverCategory === group.category
                              ? "bg-bamboo/15 border border-bamboo/40 ring-1 ring-bamboo/20"
                              : isCollapsed
                                ? "bg-transparent border border-bamboo/15"
                                : "bg-bamboo/8 border border-bamboo/15 rounded-b-none"
                          }`}
                          onClick={() => toggleCategoryCollapse(group.category)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setCategoryMenu({
                              x: e.clientX,
                              y: e.clientY,
                              category: group.category,
                            });
                            setCategoryMenuClosing(false);
                            setCategoryMenuConfirmDelete(false);
                          }}
                          onDragOver={(event) => {
                            handleFolderDragOver(event, group.category);
                          }}
                          onDragLeave={() => setDragOverCategory(null)}
                          onDrop={(event) => {
                            handleFolderHeaderDrop(event, group.category);
                          }}
                        >
                          {draggedCategory &&
                            draggedCategory !== group.category &&
                            dragOverCategory === group.category && (
                              <span
                                className={`pointer-events-none absolute left-1.5 right-1.5 h-0.5 rounded-full bg-bamboo/70 ${
                                  categoryDropPosition === "before" ? "-top-1" : "-bottom-1"
                                }`}
                                data-testid="folder-order-indicator"
                              />
                            )}
                          <span
                            draggable={renamingCategory !== group.category}
                            className="-my-1 -ml-1 flex h-6 w-4 shrink-0 cursor-grab items-center justify-center rounded active:cursor-grabbing hover:bg-bamboo-mist/70"
                            title={t("main.category.dragToReorder", {
                              defaultValue: "拖动调整文件夹顺序",
                            })}
                            onClick={(event) => event.stopPropagation()}
                            onDragStart={(event) => {
                              event.stopPropagation();
                              event.dataTransfer.setData(
                                "application/x-floral-category",
                                group.category,
                              );
                              event.dataTransfer.setData("text/plain", group.category);
                              event.dataTransfer.effectAllowed = "move";
                              setDraggedCategory(group.category);
                              setDragOverCategory(null);
                            }}
                            onDragEnd={() => {
                              setDraggedCategory(null);
                              setDragOverCategory(null);
                            }}
                          >
                            <svg
                              width="9"
                              height="12"
                              viewBox="0 0 9 12"
                              fill="currentColor"
                              className="text-bamboo/35"
                              aria-hidden="true"
                            >
                              <circle cx="2" cy="2" r="1" />
                              <circle cx="7" cy="2" r="1" />
                              <circle cx="2" cy="6" r="1" />
                              <circle cx="7" cy="6" r="1" />
                              <circle cx="2" cy="10" r="1" />
                              <circle cx="7" cy="10" r="1" />
                            </svg>
                          </span>
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`text-bamboo/50 shrink-0 transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`}
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-bamboo/50 shrink-0"
                          >
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          {renamingCategory === group.category ? (
                            <input
                              type="text"
                              autoFocus
                              value={renameCategoryValue}
                              onChange={(e) => setRenameCategoryValue(e.target.value)}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") void handleRenameCategory(group.category);
                                if (e.key === "Escape") setRenamingCategory(null);
                              }}
                              onBlur={() => void handleRenameCategory(group.category)}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 px-1 text-[10px] font-mono text-ink bg-paper-warm/80 border border-bamboo/30 rounded"
                            />
                          ) : (
                            <span className="text-[11px] text-bamboo/70 font-medium truncate">
                              {group.category}
                            </span>
                          )}
                          <span className="text-[9px] text-bamboo/40 font-mono ml-auto shrink-0">
                            {group.notes.length}
                          </span>
                        </div>

                        <div className={`category-body ${isCollapsed ? "" : "expanded"}`}>
                          <div
                            className="category-body-inner bg-bamboo/[0.03] border border-t-0 border-bamboo/10 rounded-b-lg pb-1 pt-1"
                            onDragOver={(e) => {
                              if (draggedCategory) {
                                handleFolderDragOver(e, group.category);
                                return;
                              }
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              setDragOverCategory(group.category);
                            }}
                            onDragLeave={(e) => {
                              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                setDragOverCategory(null);
                              }
                            }}
                            onDrop={(e) => {
                              if (draggedCategory) {
                                handleFolderHeaderDrop(e, group.category);
                                return;
                              }
                              void handleDropOnCategory(e, group.category);
                            }}
                          >
                            {group.notes.length === 0 ? (
                              <div className="px-3 py-3 text-center text-[11px] text-ink-ghost/50">
                                {t("main.category.emptyFolder", { defaultValue: "空文件夹" })}
                              </div>
                            ) : (
                              group.notes.map((note) => {
                                const isSelected = note.id === selectedId;
                                const isHovered = note.id === hoveredId;

                                return (
                                  <div
                                    key={note.id}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData("application/x-floral-note", note.id);
                                      e.dataTransfer.setData("text/plain", note.id);
                                      e.dataTransfer.effectAllowed = "move";
                                      setDraggedNoteId(note.id);
                                      setDragOverNoteId(null);
                                    }}
                                    onDragEnd={() => {
                                      setDraggedNoteId(null);
                                      setDragOverNoteId(null);
                                      setDragOverCategory(null);
                                    }}
                                    onDragOver={(event) => handleNoteDragOver(event, note.id)}
                                    onDragLeave={() => setDragOverNoteId(null)}
                                    onDrop={(event) => void handleNoteDrop(event, note.id)}
                                    onClick={() => void handleSelectNote(note.id)}
                                    onContextMenu={(event) => handleOpenNoteMenu(event, note.id)}
                                    onMouseEnter={() => setHoveredId(note.id)}
                                    onMouseLeave={() => setHoveredId(null)}
                                    className={`w-full text-left rounded-lg mx-1 px-2.5 py-2 transition-all duration-[600ms] cursor-grab active:cursor-grabbing group relative ${
                                      isSelected
                                        ? "bg-bamboo-mist/70"
                                        : isHovered
                                          ? "bg-paper-warm/70"
                                          : "bg-transparent"
                                    }`}
                                    style={{ width: "calc(100% - 8px)" }}
                                  >
                                    {draggedNoteId &&
                                      draggedNoteId !== note.id &&
                                      dragOverNoteId === note.id && (
                                        <span
                                          className={`pointer-events-none absolute left-2 right-2 z-20 h-0.5 rounded-full bg-bamboo/75 ${
                                            noteDropPosition === "before" ? "-top-px" : "-bottom-px"
                                          }`}
                                          data-testid="note-order-indicator"
                                        />
                                      )}
                                    <div
                                      className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-bamboo/60 transition-all duration-[600ms] ${
                                        isSelected ? "h-5 opacity-100" : "h-0 opacity-0"
                                      }`}
                                    />

                                    <div className="flex items-baseline justify-between mb-0.5">
                                      <span
                                        className={`text-[13px] font-display font-medium truncate pr-2 transition-colors ${
                                          isSelected ? "text-bamboo" : "text-ink-soft"
                                        }`}
                                      >
                                        {getDisplayTitle(note, t)}
                                      </span>
                                      <DocumentTypeBadges note={note} />
                                      <div className="flex shrink-0 items-center gap-1">
                                        {note.documentKind !== "pdf" && (
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            void handleOpenNoteAsNotepad(note.id);
                                          }}
                                          className="relative z-10 flex h-5 w-5 items-center justify-center rounded-md text-ink-ghost opacity-0 transition-all hover:bg-bamboo-mist hover:text-bamboo focus:opacity-100 group-hover:opacity-100"
                                          title={t("noteMenu.openNotepad", {
                                            defaultValue: "作为快捷便签打开",
                                          })}
                                          aria-label={t("noteMenu.openNotepad", {
                                            defaultValue: "作为快捷便签打开",
                                          })}
                                        >
                                          <svg
                                            width="11"
                                            height="11"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2.2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          >
                                            <path d="M4 4h16v14H7l-3 3V4z" />
                                            <path d="M8 9h8M8 13h5" />
                                          </svg>
                                        </button>
                                        )}
                                        <span className="text-[10px] text-ink-ghost font-mono tabular-nums">
                                          {formatShortDate(note.updatedAt)}
                                        </span>
                                      </div>
                                    </div>

                                    <p className="text-[11px] text-ink-ghost leading-relaxed line-clamp-1 group-hover:text-ink-faint transition-colors">
                                      {note.preview ||
                                        t("common.blankNote", { defaultValue: "空白笔记" })}
                                    </p>

                                    <div className="flex items-center gap-2 mt-1">
                                      <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                        {formatTime(note.updatedAt)}
                                      </span>
                                      <span className="text-[10px] text-ink-ghost/40">·</span>
                                      <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                        {t("common.wordCount", {
                                          count: note.wordCount,
                                          defaultValue: "{{count}} 字",
                                        })}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {!isLoading && filteredNotes.length === 0 && externalFiles.length === 0 && (
                    <div className="px-3 py-8 text-center text-[12px] text-ink-ghost leading-relaxed">
                      {searchQuery
                        ? t("main.search.noResults", { defaultValue: "没有匹配的笔记" })
                        : t("main.search.empty", { defaultValue: "还没有笔记" })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {!sidebarCollapsed && (
            <div
              className={`w-1 shrink-0 cursor-col-resize group relative ${isResizingSidebar ? "bg-bamboo/30" : "hover:bg-bamboo/20"} transition-colors`}
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingSidebar(true);
              }}
            >
              <div
                className={`absolute inset-y-0 -left-1 -right-1 ${isResizingSidebar ? "" : "group-hover:bg-bamboo/5"}`}
              />
            </div>
          )}

          <div className="app-content flex-1 w-0 flex flex-col min-w-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 h-10 border-b border-paper-deep/20 shrink-0 bg-paper/20">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
                  title={
                    sidebarCollapsed
                      ? t("main.window.expandSidebar", { defaultValue: "展开侧栏" })
                      : t("main.window.collapseSidebar", { defaultValue: "收起侧栏" })
                  }
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                  </svg>
                </button>

                <div className="h-4 w-px bg-paper-deep/30 mx-1" />

                <button
                  onClick={() => void handlePinEntry()}
                  disabled={!selectedId || selectedNote?.documentKind === "pdf"}
                  aria-label={pinTileButtonTitle(selectedTilePinned)}
                  className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                    selectedTilePinned
                      ? "text-bamboo bg-bamboo-mist/40 hover:text-red-400 hover:bg-danger-bg"
                      : "text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50"
                  }`}
                  title={pinTileButtonTitle(selectedTilePinned)}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 17v5" />
                    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z" />
                  </svg>
                </button>

                <button
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleUndo}
                  disabled={!selectedId}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t("main.editor.undo", { defaultValue: "撤销（Ctrl+Z）" })}
                  aria-label={t("main.editor.undoLabel", { defaultValue: "撤销" })}
                >
                  <svg
                    data-testid="main-editor-undo-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 14 4 9l5-5" />
                    <path d="M4 9h10a6 6 0 0 1 0 12h-1" />
                  </svg>
                </button>

                <button
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleRedo}
                  disabled={!selectedId}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t("main.editor.redo", { defaultValue: "重做（Ctrl+Y）" })}
                  aria-label={t("main.editor.redoLabel", { defaultValue: "重做" })}
                >
                  <svg
                    data-testid="main-editor-redo-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ transform: "scaleX(-1)" }}
                  >
                    <path d="M9 14 4 9l5-5" />
                    <path d="M4 9h10a6 6 0 0 1 0 12h-1" />
                  </svg>
                </button>

                <button
                  onClick={() => void saveCurrentNote(true)}
                  disabled={!selectedId || saveState === "saving"}
                  className="px-2.5 h-7 flex items-center justify-center rounded-lg text-[11px] text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t("common.save", { defaultValue: "保存" })}
                >
                  {t("common.save", { defaultValue: "保存" })}
                </button>

                <button
                  onClick={() => void handleReloadFromDisk()}
                  disabled={!selectedId || saveState === "saving" || isReloadingFromDisk}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t("main.editor.reloadFromDisk", { defaultValue: "从磁盘重新加载" })}
                  aria-label={t("main.editor.reloadFromDisk", {
                    defaultValue: "从磁盘重新加载",
                  })}
                >
                  <svg
                    data-testid="main-editor-reload-icon"
                    className={isReloadingFromDisk ? "animate-spin" : ""}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 11a8.1 8.1 0 1 0 2 5.3" />
                    <path d="M20 4v7h-7" />
                  </svg>
                </button>

                {deleteConfirm ? (
                  <div
                    className={`flex items-center gap-1 ml-1 ${deleteExiting ? "animate-delete-confirm-exit" : "animate-delete-confirm"}`}
                  >
                    <span className="text-[11px] text-red-400 whitespace-nowrap">
                      {t("main.editor.confirmDelete", { defaultValue: "确认删除？" })}
                    </span>
                    <button
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setDeleteExiting(true);
                        setTimeout(() => {
                          setDeleteExiting(false);
                          setDeleteConfirm(false);
                          void handleDeleteNote();
                        }, 150);
                      }}
                      className="px-2 h-6 rounded-md text-[11px] text-cloud bg-red-400 hover:bg-red-500 transition-colors cursor-pointer whitespace-nowrap outline-none"
                    >
                      {t("common.delete", { defaultValue: "删除" })}
                    </button>
                    <button
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setDeleteExiting(true);
                        setTimeout(() => {
                          setDeleteExiting(false);
                          setDeleteConfirm(false);
                        }, 150);
                      }}
                      className="px-2 h-6 rounded-md text-[11px] text-ink-faint hover:text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer outline-none"
                    >
                      {t("common.cancel", { defaultValue: "取消" })}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    disabled={!selectedId}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-red-400 hover:bg-danger-bg transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    title={t("noteMenu.delete", { defaultValue: "删除笔记" })}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3,6 5,6 21,6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            <div
              key={noteTransitionKey}
              className="note-heading-panel relative animate-note-enter px-6 pt-4 pb-2 shrink-0 border-b border-paper-deep/15"
            >
              <textarea
                ref={titleInputRef}
                rows={1}
                wrap="soft"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value.replace(/[\r\n]+/g, " "));
                  markDirty();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    richEditorRef.current?.focus();
                  }
                }}
                placeholder={t("common.untitledNote", { defaultValue: "无标题笔记" })}
                disabled={!selectedId}
                className="note-title-input w-full text-[20px] font-display font-bold text-ink placeholder:text-ink-ghost/50 tracking-wide disabled:opacity-60"
              />
              <div className="flex items-center gap-3 mt-1.5">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[10px] text-ink-ghost font-mono tabular-nums truncate max-w-[200px]">
                    {selectedExternalFile
                      ? t("main.externalFile.label", {
                          path: selectedExternalFile.filePath,
                          defaultValue: "外部文件 · {{path}}",
                        })
                      : selectedNote
                        ? `${formatShortDate(selectedNote.updatedAt)} ${formatTime(selectedNote.updatedAt)}`
                        : "--"}
                  </span>
                  <span className="text-[10px] text-ink-ghost/40">·</span>
                  <span className="text-[10px] text-ink-ghost font-mono tabular-nums whitespace-nowrap">
                    {t("common.wordCount", { count: charCount, defaultValue: "{{count}} 字" })}
                  </span>
                  <span className="text-[10px] text-ink-ghost/40">·</span>
                  <span
                    key={saveState}
                    className={`text-[10px] font-mono tabular-nums whitespace-nowrap animate-status-fade ${
                      saveState === "error"
                        ? "text-red-400"
                        : saveState === "dirty"
                          ? "text-amber-500/70"
                          : "text-bamboo/60"
                    }`}
                  >
                    {saveStateLabel[saveState]}
                  </span>
                </div>
              </div>
              {selectedId &&
                (writingPetVisible ? (
                  <WritingPet
                    noteKey={selectedId}
                    saveState={saveState}
                    onHide={() => {
                      setWritingPetVisible(false);
                      showToast(
                        t("main.writingPet.hidden", {
                          defaultValue: "橘团先去休息了。双击标题右侧空白处可叫它回来。",
                        }),
                        "info",
                      );
                    }}
                  />
                ) : (
                  <div
                    className="writing-pet-habitat writing-pet-habitat--hidden"
                    onDoubleClick={() => {
                      setWritingPetVisible(true);
                      showToast(
                        t("main.writingPet.restored", { defaultValue: "橘团回来啦。" }),
                        "info",
                      );
                    }}
                    title={t("main.writingPet.restore", {
                      defaultValue: "双击恢复橘猫",
                    })}
                    aria-hidden="true"
                  />
                ))}
            </div>

            {selectedNote?.documentKind === "pdf" ? (
              <div className="min-h-0 flex-1">
                <PdfDocumentViewer noteId={selectedNote.id} title={selectedNote.title} />
              </div>
            ) : (
              <>
            <div className="flex h-8 w-full max-w-full min-w-0 shrink-0 items-center overflow-hidden border-b border-paper-deep/20 bg-paper/10 px-5">
              <span className="text-[10px] font-medium tracking-[0.12em] text-ink-ghost">
                {t("main.editor.contentLabel", { defaultValue: "内容编辑" })}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={viewMode === "content-source"}
                onClick={() =>
                  setViewMode(viewMode === "content-source" ? "content" : "content-source")
                }
                className="ml-4 flex shrink-0 items-center gap-2 rounded-lg px-2 py-1 text-[10px] text-ink-faint hover:bg-paper-warm cursor-pointer transition-colors"
              >
                <span
                  className={`relative h-4 w-7 rounded-full transition-colors ${
                    viewMode === "content-source" ? "bg-bamboo" : "bg-paper-deep"
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                      viewMode === "content-source" ? "translate-x-3" : "translate-x-0"
                    }`}
                  />
                </span>
                <span className="whitespace-nowrap">
                  {t("main.editor.showSource", { defaultValue: "显示 Markdown 源码" })}
                </span>
              </button>
            </div>

            <div
              key={viewMode}
              ref={splitContainerRef}
              className="relative flex-1 flex min-h-0 animate-view-fade"
            >
              {!selectedId && !isLoading ? (
                <div className="flex-1 flex items-center justify-center text-[13px] text-ink-ghost">
                  {t("main.editor.emptyHint", { defaultValue: "选择或新建一篇笔记" })}
                </div>
              ) : (
                <>
                  {viewMode === "content-source" && (
                    <div
                      className="markdown-source-panel flex flex-col min-h-0 shrink-0"
                      style={{ width: `${splitRatio * 100}%` }}
                    >
                      <div className="flex items-center gap-0.5 px-4 pt-2 pb-1 shrink-0 border-b border-paper-deep/20">
                        <span className="mr-2 text-[10px] text-ink-ghost/70 font-mono tracking-wider uppercase">
                          {t("main.editor.sourceLabel", { defaultValue: "Markdown 源码" })}
                        </span>
                        {toolbarButtons.map((button) => (
                          <button
                            key={button.label}
                            title={button.title}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              if (contentRef.current) {
                                applyFormat(
                                  contentRef.current,
                                  button.action,
                                  t,
                                  setContent,
                                  markDirty,
                                );
                              }
                            }}
                            className={`w-6 h-6 flex items-center justify-center rounded text-[11px] text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer ${button.style}`}
                          >
                            {button.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex-1 overflow-hidden px-5 pb-4">
                        <textarea
                          ref={contentRef}
                          data-tab-indent="true"
                          value={content}
                          onChange={(event) => {
                            setContent(event.target.value);
                            setEditorSelectionStats(
                              getTextEditorSelectionStats(
                                event.target.value,
                                event.target.selectionStart,
                                event.target.selectionEnd,
                              ),
                            );
                            markDirty();
                          }}
                          onSelect={(event) => {
                            updateSourceEditorStats(event.currentTarget);
                          }}
                          onClick={(event) => updateSourceEditorStats(event.currentTarget)}
                          onKeyUp={(event) => updateSourceEditorStats(event.currentTarget)}
                          onMouseUp={(event) => updateSourceEditorStats(event.currentTarget)}
                          onPaste={imagePasteHandler}
                          onDrop={imageDropHandler}
                          onDragOver={imageDragOverHandler}
                          onScroll={handleEditorScroll}
                          className="w-full h-full leading-[1.9] text-ink-soft font-body placeholder:text-ink-ghost/40"
                          style={{
                            fontSize: `${settingsConfig?.fontSize ?? 14}px`,
                            tabSize: `var(--tab-indent-size, 2)`,
                          }}
                          placeholder={t("main.editor.contentPlaceholder", {
                            defaultValue: "开始写作……",
                          })}
                          spellCheck={false}
                          disabled={!selectedId}
                        />
                      </div>
                    </div>
                  )}

                  {viewMode === "content-source" && (
                    <div
                      className={`w-1.5 shrink-0 cursor-col-resize group relative flex items-center justify-center ${isResizingSplit ? "bg-bamboo/30" : "hover:bg-bamboo/20"} transition-colors`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setIsResizingSplit(true);
                      }}
                    >
                      <div
                        className={`absolute inset-y-0 -left-1.5 -right-1.5 ${isResizingSplit ? "" : "group-hover:bg-bamboo/5"}`}
                      />
                      {/* 拖拽手柄指示器 */}
                      <div className="relative z-10 flex flex-col gap-[3px] opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-[3px] h-[3px] rounded-full bg-ink-ghost/60" />
                        <div className="w-[3px] h-[3px] rounded-full bg-ink-ghost/60" />
                        <div className="w-[3px] h-[3px] rounded-full bg-ink-ghost/60" />
                      </div>
                    </div>
                  )}

                  <div className="paper-margin-layout flex min-h-0 min-w-0 flex-1">
                    <div ref={previewScrollRef} className="min-w-0 flex-1 min-h-0 overflow-hidden">
                      <MarkdownContentEditor
                        key={`${selectedId ?? "empty"}:${noteTransitionKey}`}
                        editorRef={richEditorRef}
                        content={content}
                        fontSize={settingsConfig?.fontSize ?? 14}
                        imageBaseDir={imageBaseDir ?? undefined}
                        imageUploadHandler={isExternal ? undefined : handleRichEditorImageUpload}
                        placeholder={t("main.editor.contentPlaceholder", {
                          defaultValue: "开始写作……输入 ## 加空格可创建二级标题",
                        })}
                        disabled={!selectedId}
                        onChange={(nextContent) => {
                          setContent(nextContent);
                          markDirty();
                        }}
                        onSelectionChange={(stats) =>
                          setEditorSelectionStats({
                            ...stats,
                            currentLine: Math.min(stats.currentLine, lineCount),
                          })
                        }
                        onError={() =>
                          showToast(
                            t("main.editor.richEditorError", {
                              defaultValue:
                                "这段 Markdown 暂时无法在内容编辑中显示，请打开源码面板修改。",
                            }),
                          )
                        }
                      />
                    </div>
                    {viewMode === "content" && (
                      <PaperMarginPanel
                        content={content}
                        noteKey={selectedId}
                        lineCount={lineCount}
                        characterCount={charCount}
                        onHeadingClick={handleOutlineHeadingClick}
                      />
                    )}
                  </div>
                  {(settingsConfig?.fontSize ?? DEFAULT_EDITOR_FONT_SIZE) !==
                    DEFAULT_EDITOR_FONT_SIZE && (
                    <div className="markdown-zoom-badge editor-zoom-badge">
                      <span>
                        {t("main.editor.textZoom", {
                          percent: Math.round(
                            ((settingsConfig?.fontSize ?? DEFAULT_EDITOR_FONT_SIZE) /
                              DEFAULT_EDITOR_FONT_SIZE) *
                              100,
                          ),
                          defaultValue: "正文 {{percent}}%",
                        })}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditorFontSize(DEFAULT_EDITOR_FONT_SIZE)}
                      >
                        {t("common.reset", { defaultValue: "恢复默认" })}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
              </>
            )}

            <div className="flex items-center justify-between px-4 h-7 border-t border-paper-deep/20 bg-paper/30 shrink-0">
              <div className="flex items-center gap-3">
                <span
                  data-testid="status-line-position"
                  className="text-[10px] text-ink-ghost font-mono tabular-nums"
                >
                  {t("main.statusBar.linePosition", {
                    current: editorSelectionStats.currentLine,
                    total: lineCount,
                    defaultValue: "第 {{current}} / {{total}} 行",
                  })}
                </span>
                <span className="text-[10px] text-ink-ghost/40">|</span>
                <span
                  data-testid="status-total-characters"
                  className="text-[10px] text-ink-ghost font-mono tabular-nums whitespace-nowrap"
                >
                  {t("main.statusBar.totalCharacters", {
                    count: charCount,
                    defaultValue: "共 {{count}} 字",
                  })}
                </span>
                {editorSelectionStats.selectedChars > 0 && (
                  <>
                    <span className="text-[10px] text-ink-ghost/40">|</span>
                    <span
                      data-testid="status-selected-characters"
                      className="text-[10px] text-bamboo/75 font-mono tabular-nums whitespace-nowrap"
                    >
                      {t("main.statusBar.selectedCharacters", {
                        count: editorSelectionStats.selectedChars,
                        defaultValue: "已选 {{count}} 字",
                      })}
                    </span>
                  </>
                )}
                <span className="text-[10px] text-ink-ghost/40">|</span>
                <span className="text-[10px] text-ink-ghost font-mono">
                  {t("main.statusBar.format", { defaultValue: "Markdown + LaTeX" })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {selectedId && !isExternal && content.includes("images/") && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleCleanUnusedImages()}
                      className="text-[10px] text-ink-ghost hover:text-bamboo font-mono cursor-pointer transition-colors"
                    >
                      {t("main.images.cleanUnused", { defaultValue: "清理未使用图片" })}
                    </button>
                    <span className="text-[10px] text-ink-ghost/40">|</span>
                  </>
                )}
                <span className="text-[10px] text-ink-ghost font-mono">
                  {t("main.statusBar.encoding", { defaultValue: "UTF-8" })}
                </span>
                <span className="text-[10px] text-ink-ghost/40">|</span>
                <span className="text-[10px] text-ink-ghost font-mono tabular-nums">
                  {t("main.statusBar.byteSize", { size: byteSize, defaultValue: "{{size}} KB" })}
                </span>
              </div>
            </div>
          </div>
          {visibleSidePanel && settingsOverlay && (
            <div className="absolute inset-0 z-20" onClick={() => { setSettingsOpen(false); setAboutOpen(false); setActivityOpen(false); }} />
          )}
          <div
            data-testid="side-panel-host"
            className={`relative shrink-0 h-full min-h-0 overflow-clip bg-cloud ${
              sidePanelExpanded ? "border-l border-paper-deep/20" : "border-l-0"
            } ${
              settingsOverlay
                ? `absolute right-0 top-0 bottom-0 z-30 ${visibleSidePanel ? "w-[360px] shadow-xl" : "w-0"}`
                : `${sidePanelExpanded ? "w-[360px]" : "w-0"}`
            }`}
          >
            {visibleSidePanel === "about" ? <AboutPanel onClose={handleCloseAbout} /> : null}
            {visibleSidePanel === "activity" ? (
              <ActivityPanel
                onClose={handleCloseActivity}
                onCreateReport={async (reportTitle, reportContent) => {
                  const note = await createNote({ title: reportTitle, content: reportContent, category: "" });
                  replaceNoteMetadata(note);
                }}
              />
            ) : null}
            {visibleSidePanel === "settings" && settingsConfig ? (
              <SettingsPanel
                config={settingsConfig}
                showWritingPet={writingPetVisible}
                onChange={handleSettingsChange}
                onWritingPetVisibilityChange={setWritingPetVisible}
                onOpenDataDir={() => void handleOpenDataDir()}
                onClose={handleCloseSettings}
              />
            ) : null}
          </div>
        </div>
      </div>
      {noteMenu && noteMenuTarget && (
        <div
          ref={noteMenuRef}
          className={`popup-menu fixed z-[9999] min-w-[168px] py-1.5 bg-cloud/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-x-hidden overflow-y-auto select-none ${noteMenuClosing ? "animate-menu-exit" : "animate-menu-enter"}`}
          style={{
            left: noteMenuPosition?.x ?? noteMenu.x,
            top: noteMenuPosition?.y ?? noteMenu.y,
            maxWidth: `calc(100vw - ${POPUP_VIEWPORT_MARGIN * 2}px)`,
            maxHeight: `calc(100vh - ${POPUP_VIEWPORT_MARGIN * 2}px)`,
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {noteMenuMode === "main" ? (
            <div key="main" className="animate-menu-slide-right">
              {noteContextMenuItems.map((item, index) => (
                <button
                  key={item.action}
                  onClick={() => handleNoteMenuAction(item.action)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-[12px] font-body transition-colors cursor-pointer ${
                    item.tone === "danger"
                      ? "text-red-400 hover:bg-danger-bg hover:text-red-500"
                      : "text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo"
                  } ${index > 0 ? "border-t border-paper-deep/20" : ""}`}
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div key="move" className="animate-menu-slide-left">
              <button
                onClick={() => setNoteMenuMode("main")}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-body text-ink-ghost hover:bg-paper-warm transition-colors cursor-pointer border-b border-paper-deep/20"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span>{t("common.back", { defaultValue: "返回" })}</span>
              </button>
              <button
                onClick={() => void handleMoveNote(noteMenuTarget.id, "")}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
              >
                {t("main.category.uncategorized", { defaultValue: "未分类" })}
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => void handleMoveNote(noteMenuTarget.id, cat)}
                  className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {categoryMenu && (
        <div
          ref={categoryMenuRef}
          className={`popup-menu fixed z-[9999] min-w-[140px] py-1.5 bg-cloud/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-x-hidden overflow-y-auto select-none ${categoryMenuClosing ? "animate-menu-exit" : "animate-menu-enter"}`}
          data-hover-suppressed={categoryMenuHoverSuppressed ? "" : undefined}
          style={{
            left: categoryMenuPosition?.x ?? categoryMenu.x,
            top: categoryMenuPosition?.y ?? categoryMenu.y,
            maxWidth: `calc(100vw - ${POPUP_VIEWPORT_MARGIN * 2}px)`,
            maxHeight: `calc(100vh - ${POPUP_VIEWPORT_MARGIN * 2}px)`,
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {categoryMenuConfirmDelete ? (
            <div key="category-confirm" className="animate-menu-slide-left">
              <div className="px-3 py-1.5 text-[11px] font-body text-ink-faint border-b border-paper-deep/20">
                {t("main.category.confirmDelete", {
                  category: categoryMenu.category,
                  defaultValue: "确认删除「{{category}}」？",
                })}
              </div>
              <button
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  void handleDeleteCategory(categoryMenu.category);
                  setCategoryMenuClosing(true);
                }}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-red-400 hover:bg-danger-bg hover:text-red-500 transition-colors cursor-pointer outline-none"
              >
                {t("main.category.confirmDeleteAction", { defaultValue: "确认删除" })}
              </button>
              <button
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => switchCategoryMenuPanel(false)}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer outline-none"
              >
                {t("common.cancel", { defaultValue: "取消" })}
              </button>
            </div>
          ) : (
            <div key="category-main" className="animate-menu-slide-right">
              <button
                onClick={() => {
                  setCategoryMenuClosing(true);
                  setRenamingCategory(categoryMenu.category);
                  setRenameCategoryValue(categoryMenu.category);
                }}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
              >
                {t("main.category.rename", { defaultValue: "重命名" })}
              </button>
              <button
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => switchCategoryMenuPanel(true)}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-red-400 hover:bg-danger-bg hover:text-red-500 transition-colors cursor-pointer border-t border-paper-deep/20 outline-none"
              >
                {t("main.category.delete", { defaultValue: "删除分类" })}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
