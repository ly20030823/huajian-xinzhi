import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getConfig } from "../features/settings/api";
import type { AppConfig } from "../features/settings/types";
import { requestSurfaceAction } from "../features/windows/surfaceActions";
import { getTileContextMenuItems } from "../features/windows/tileContextMenu";
import { POPUP_VIEWPORT_MARGIN, useViewportPopupPosition } from "./popupPosition";
import {
  getTableContextTarget,
  runTableContextAction,
  type TableContextAction,
  type TableContextTarget,
} from "../features/markdown/tableContextActions";

interface MenuState {
  x: number;
  y: number;
  hasSelection: boolean;
  codeBlock: boolean;
  table: boolean;
  type: "edit" | "tile";
}

const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuClosing, setMenuClosing] = useState(false);
  const { popupRef: menuRef, popupPosition: menuPosition } = useViewportPopupPosition(
    menu,
    menu?.type,
  );
  const editableTargetRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLElement | null>(
    null,
  );
  const codeBlockTargetRef = useRef<HTMLElement | null>(null);
  const tableTargetRef = useRef<TableContextTarget | null>(null);
  const tileCtrlCloseRef = useRef(true);
  const tileContextMenuItems = useMemo(() => getTileContextMenuItems(t), [t]);

  useEffect(() => {
    getConfig()
      .then((c) => {
        tileCtrlCloseRef.current = c.tileCtrlClose ?? true;
      })
      .catch(() => {});
    const unlisten = listen<AppConfig>("config-changed", (event) => {
      tileCtrlCloseRef.current = event.payload.tileCtrlClose ?? true;
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    function handleContextMenu(event: MouseEvent) {
      const target = event.target as HTMLElement;
      const isEditable =
        target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable;
      const tileTarget = target.closest<HTMLElement>('[data-context-menu="tile"]');
      const codeBlockTarget = target.closest<HTMLElement>('[data-context-menu="code-block"]');
      const tableTarget = getTableContextTarget(target);

      if (!isEditable && !tileTarget && !codeBlockTarget && !tableTarget) {
        event.preventDefault();
        return;
      }

      event.preventDefault();

      if (tileTarget && event.ctrlKey && tileCtrlCloseRef.current) {
        requestSurfaceAction("close");
        return;
      }
      let selection = window.getSelection()?.toString() || "";
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        selection = target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? 0);
      }

      if (tileTarget) {
        editableTargetRef.current = null;
        codeBlockTargetRef.current = null;
        tableTargetRef.current = null;
        setMenuClosing(false);
        setMenu({
          x: event.clientX,
          y: event.clientY,
          hasSelection: false,
          codeBlock: false,
          table: false,
          type: "tile",
        });
        return;
      }

      editableTargetRef.current = isEditable
        ? target
        : (codeBlockTarget?.querySelector<HTMLElement>(".cm-content") ?? target);
      codeBlockTargetRef.current = codeBlockTarget;
      tableTargetRef.current = tableTarget;
      setMenuClosing(false);
      setMenu({
        x: event.clientX,
        y: event.clientY,
        hasSelection: selection.length > 0,
        codeBlock: Boolean(codeBlockTarget),
        table: Boolean(tableTarget),
        type: "edit",
      });
    }

    function handleClick() {
      setMenuClosing(true);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuClosing(true);
    }

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!menuClosing || !menu) return;
    const timer = window.setTimeout(() => {
      setMenu(null);
      setMenuClosing(false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [menuClosing, menu]);

  const dismissMenu = useCallback(() => {
    setMenuClosing(true);
  }, []);

  const runCommand = async (command: string) => {
    const target = editableTargetRef.current;
    const selectedTableText = tableTargetRef.current?.table.dataset.floralSelectedText;

    if (command === "copy" && selectedTableText) {
      await writeText(selectedTableText);
      dismissMenu();
      return;
    }

    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const start = target.selectionStart ?? 0;
      const end = target.selectionEnd ?? 0;
      const value = target.value;
      const selected = value.slice(start, end);
      const before = value.slice(0, start);
      const after = value.slice(end);

      target.focus();

      const nativeSetter = target instanceof HTMLTextAreaElement ? textareaSetter : inputSetter;
      const setValue = (newValue: string, cursorPos: number) => {
        nativeSetter?.call(target, newValue);
        target.selectionStart = target.selectionEnd = cursorPos;
        target.dispatchEvent(new Event("input", { bubbles: true }));
      };

      switch (command) {
        case "copy":
          if (selected) await writeText(selected);
          break;
        case "cut":
          if (selected) {
            await writeText(selected);
            setValue(before + after, start);
          }
          break;
        case "paste": {
          const text = await readText();
          setValue(before + text + after, start + text.length);
          break;
        }
        case "selectAll":
          target.select();
          break;
      }
    } else {
      target?.focus();
      document.execCommand(command);
    }

    dismissMenu();
  };

  const runSurfaceAction = (action: (typeof tileContextMenuItems)[number]["action"]) => {
    requestSurfaceAction(action);
    dismissMenu();
  };

  const deleteCodeBlock = () => {
    codeBlockTargetRef.current?.dispatchEvent(new Event("floral-delete-code-block"));
    dismissMenu();
  };

  const runTableAction = (action: TableContextAction) => {
    const context = tableTargetRef.current;
    if (context) void runTableContextAction(context, action);
    dismissMenu();
  };

  const items = useMemo(
    () =>
      menu
        ? menu.type === "tile"
          ? tileContextMenuItems.map((item) => ({
              ...item,
              shortcut: "",
              action: () => runSurfaceAction(item.action),
              disabled: false,
            }))
          : [
              {
                label: t("contextMenu.edit.cut", { defaultValue: "剪切" }),
                shortcut: "Ctrl+X",
                action: () => runCommand("cut"),
                disabled: !menu.hasSelection,
              },
              {
                label: t("contextMenu.edit.copy", { defaultValue: "复制" }),
                shortcut: "Ctrl+C",
                action: () => runCommand("copy"),
                disabled: !menu.hasSelection,
              },
              {
                label: t("contextMenu.edit.paste", { defaultValue: "粘贴" }),
                shortcut: "Ctrl+V",
                action: () => runCommand("paste"),
                disabled: false,
              },
              { separator: true as const },
              {
                label: t("contextMenu.edit.selectAll", { defaultValue: "全选" }),
                shortcut: "Ctrl+A",
                action: () => runCommand("selectAll"),
                disabled: false,
              },
              ...(menu.codeBlock
                ? [
                    { separator: true as const },
                    {
                      label: t("markdown.codeBlock.delete", { defaultValue: "删除代码块" }),
                      shortcut: "",
                      action: deleteCodeBlock,
                      disabled: false,
                      tone: "danger" as const,
                    },
                  ]
                : []),
              ...(menu.table
                ? [
                    { separator: true as const },
                    {
                      label: t("contextMenu.table.insertRowAbove", {
                        defaultValue: "在上方插入一行",
                      }),
                      shortcut: "",
                      action: () => runTableAction("insert-row-above"),
                      disabled: false,
                    },
                    {
                      label: t("contextMenu.table.insertRowBelow", {
                        defaultValue: "在下方插入一行",
                      }),
                      shortcut: "",
                      action: () => runTableAction("insert-row-below"),
                      disabled: false,
                    },
                    {
                      label: t("contextMenu.table.insertColumnLeft", {
                        defaultValue: "在左侧插入一列",
                      }),
                      shortcut: "",
                      action: () => runTableAction("insert-column-left"),
                      disabled: false,
                    },
                    {
                      label: t("contextMenu.table.insertColumnRight", {
                        defaultValue: "在右侧插入一列",
                      }),
                      shortcut: "",
                      action: () => runTableAction("insert-column-right"),
                      disabled: false,
                    },
                    { separator: true as const },
                    {
                      label: t("contextMenu.table.autoFit", {
                        defaultValue: "自适应表格大小",
                      }),
                      shortcut: "",
                      action: () => runTableAction("auto-fit"),
                      disabled: false,
                    },
                    {
                      label: t("contextMenu.table.alignLeft", {
                        defaultValue: "左对齐（选区或当前列）",
                      }),
                      shortcut: "",
                      action: () => runTableAction("align-left"),
                      disabled: false,
                    },
                    {
                      label: t("contextMenu.table.alignCenter", {
                        defaultValue: "居中（选区或当前列）",
                      }),
                      shortcut: "",
                      action: () => runTableAction("align-center"),
                      disabled: false,
                    },
                    {
                      label: t("contextMenu.table.alignRight", {
                        defaultValue: "右对齐（选区或当前列）",
                      }),
                      shortcut: "",
                      action: () => runTableAction("align-right"),
                      disabled: false,
                    },
                    { separator: true as const },
                    {
                      label: t("contextMenu.table.deleteRow", {
                        defaultValue: "删除当前行",
                      }),
                      shortcut: "",
                      action: () => runTableAction("delete-row"),
                      disabled: false,
                      tone: "danger" as const,
                    },
                    {
                      label: t("contextMenu.table.deleteColumn", {
                        defaultValue: "删除当前列",
                      }),
                      shortcut: "",
                      action: () => runTableAction("delete-column"),
                      disabled: false,
                      tone: "danger" as const,
                    },
                    {
                      label: t("contextMenu.table.deleteTable", {
                        defaultValue: "删除表格",
                      }),
                      shortcut: "",
                      action: () => runTableAction("delete-table"),
                      disabled: false,
                      tone: "danger" as const,
                    },
                  ]
                : []),
            ]
        : [],
    [menu, runCommand, t, tileContextMenuItems],
  );

  return (
    <>
      {children}
      {menu && (
        <div
          ref={menuRef}
          className={`fixed z-[9999] min-w-[152px] py-1.5 bg-cloud/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-x-hidden overflow-y-auto select-none ${menuClosing ? "animate-menu-exit" : "animate-menu-enter"}`}
          style={{
            left: menuPosition?.x ?? menu.x,
            top: menuPosition?.y ?? menu.y,
            maxWidth: `calc(100vw - ${POPUP_VIEWPORT_MARGIN * 2}px)`,
            maxHeight: `calc(100vh - ${POPUP_VIEWPORT_MARGIN * 2}px)`,
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {items.map((item, index) =>
            "separator" in item ? (
              <div key={index} className="mx-2 my-1 h-px bg-paper-deep/40" />
            ) : (
              <button
                key={item.label}
                onClick={() => void item.action()}
                disabled={item.disabled}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-[12px] font-body transition-colors cursor-pointer disabled:text-ink-ghost/40 disabled:cursor-default disabled:hover:bg-transparent ${
                  "tone" in item && item.tone === "danger"
                    ? "text-red-400 hover:bg-danger-bg hover:text-red-500"
                    : "text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo"
                }`}
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className="text-[10px] text-ink-ghost/60 font-mono ml-6">
                    {item.shortcut}
                  </span>
                )}
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}
