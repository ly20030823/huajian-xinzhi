import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { getTableContextTarget, runTableContextAction } from "./tableContextActions";
import { TABLE_COLUMN_REORDER_EVENT, type TableColumnReorderDetail } from "./tableColumnReorder";

interface TableInteractionLayerProps {
  containerRef: RefObject<HTMLDivElement | null>;
  disabled: boolean;
}

interface ToolbarPosition {
  table: HTMLTableElement;
  left: number;
  top: number;
}

function isContentCell(element: Element | null): element is HTMLTableCellElement {
  return Boolean(
    element instanceof HTMLTableCellElement &&
    element.dataset.toolCell !== "true" &&
    element.closest(".markdown-content-editor__content"),
  );
}

function findContentCell(target: EventTarget | Element | null) {
  const element = target instanceof Element ? target : null;
  const cell = element?.closest<HTMLTableCellElement>("th,td") ?? null;
  return isContentCell(cell) ? cell : null;
}

function contentCells(table: HTMLTableElement) {
  return Array.from(table.tBodies[0]?.rows ?? []).flatMap((row) =>
    Array.from(row.cells).filter(isContentCell),
  );
}

function contentCellCoordinates(cell: HTMLTableCellElement) {
  const row = cell.parentElement as HTMLTableRowElement | null;
  const table = cell.closest("table");
  if (!row || !table?.tBodies[0]) return null;
  const rows = Array.from(table.tBodies[0].rows);
  const cells = Array.from(row.cells).filter(isContentCell);
  return { row: rows.indexOf(row), column: cells.indexOf(cell) };
}

interface HighlightRegistry {
  delete(name: string): void;
  set(name: string, highlight: unknown): void;
}

function getHighlightRegistry() {
  return (CSS as typeof CSS & { highlights?: HighlightRegistry }).highlights;
}

function createTextHighlight(ranges: Range[]) {
  const HighlightConstructor = (
    window as typeof window & {
      Highlight?: new (...ranges: Range[]) => unknown;
    }
  ).Highlight;
  const registry = getHighlightRegistry();
  if (!HighlightConstructor || !registry) return;
  registry.set("floral-table-selection", new HighlightConstructor(...ranges));
}

function selectAcrossCells(start: HTMLTableCellElement, end: HTMLTableCellElement) {
  const table = start.closest("table");
  if (!table || table !== end.closest("table")) return false;
  const allCells = contentCells(table);
  const startIndex = allCells.indexOf(start);
  const endIndex = allCells.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || startIndex === endIndex) return false;

  const startCoordinates = contentCellCoordinates(start);
  const endCoordinates = contentCellCoordinates(end);
  if (!startCoordinates || !endCoordinates) return false;

  const minColumn = Math.min(startCoordinates.column, endCoordinates.column);
  const maxColumn = Math.max(startCoordinates.column, endCoordinates.column);
  const minRow = Math.min(startCoordinates.row, endCoordinates.row);
  const maxRow = Math.max(startCoordinates.row, endCoordinates.row);
  table.dataset.floralSelectedColumns = Array.from(
    { length: maxColumn - minColumn + 1 },
    (_, index) => String(minColumn + index),
  ).join(",");
  table.dataset.floralSelectedText = Array.from(table.tBodies[0]?.rows ?? [])
    .slice(minRow, maxRow + 1)
    .map((row) =>
      Array.from(row.cells)
        .filter(isContentCell)
        .slice(minColumn, maxColumn + 1)
        .map((cell) => cell.innerText)
        .join("\t"),
    )
    .join("\n");

  const ranges = allCells
    .filter((cell) => {
      const coordinates = contentCellCoordinates(cell);
      return Boolean(
        coordinates &&
        coordinates.row >= minRow &&
        coordinates.row <= maxRow &&
        coordinates.column >= minColumn &&
        coordinates.column <= maxColumn,
      );
    })
    .map((cell) => {
      const editor = cell.querySelector<HTMLElement>('[contenteditable="true"]') ?? cell;
      const range = document.createRange();
      range.selectNodeContents(editor);
      return range;
    });
  createTextHighlight(ranges);
  window.getSelection()?.removeAllRanges();
  return true;
}

function clearCellSelection(container: HTMLElement) {
  container
    .querySelectorAll<HTMLTableElement>("table[data-floral-selected-columns]")
    .forEach((table) => {
      delete table.dataset.floralSelectedColumns;
      delete table.dataset.floralSelectedText;
    });
  getHighlightRegistry()?.delete("floral-table-selection");
}

function applyColumnWidth(table: HTMLTableElement, columnIndex: number, width: number) {
  const columns = Array.from(table.querySelectorAll<HTMLTableColElement>("colgroup > col"));
  // The colgroup only describes the visible Markdown columns. The editor's
  // hidden row/column controls live in separate tool cells and must not shift
  // the colgroup index; otherwise dragging column N resizes N + 1 instead.
  const column = columns[columnIndex];
  column?.style.setProperty("width", `${width}px`, "important");
  column?.style.setProperty("min-width", `${width}px`, "important");
  table.querySelectorAll<HTMLTableRowElement>("tbody > tr").forEach((row) => {
    const cell = Array.from(row.cells).filter(isContentCell)[columnIndex];
    cell?.style.setProperty("width", `${width}px`, "important");
    cell?.style.setProperty("min-width", `${width}px`, "important");
  });
}

function getColumnWidths(table: HTMLTableElement) {
  const firstRow = table.tBodies[0]?.rows[0];
  if (!firstRow) return [];
  return Array.from(firstRow.cells)
    .filter(isContentCell)
    .map((cell) => cell.getBoundingClientRect().width);
}

function firstRowContentCells(table: HTMLTableElement) {
  const firstRow = table.tBodies[0]?.rows[0];
  return firstRow ? Array.from(firstRow.cells).filter(isContentCell) : [];
}

function isNearColumnTop(event: PointerEvent, cell: HTMLTableCellElement) {
  const rect = cell.getBoundingClientRect();
  return (
    event.clientX >= rect.left + 7 &&
    event.clientX <= rect.right - 7 &&
    Math.abs(event.clientY - rect.top) <= 8
  );
}

function getColumnInsertionIndex(table: HTMLTableElement, clientX: number) {
  const cells = firstRowContentCells(table);
  const insertionIndex = cells.findIndex((cell) => {
    const rect = cell.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2;
  });
  return insertionIndex < 0 ? cells.length : insertionIndex;
}

function clearColumnDragClasses(table: HTMLTableElement) {
  table
    .querySelectorAll(
      ".floral-table-column-drag-source,.floral-table-column-drop-before,.floral-table-column-drop-after",
    )
    .forEach((element) =>
      element.classList.remove(
        "floral-table-column-drag-source",
        "floral-table-column-drop-before",
        "floral-table-column-drop-after",
      ),
    );
}

function markContentColumn(table: HTMLTableElement, columnIndex: number, className: string) {
  table.querySelectorAll<HTMLTableRowElement>("tbody > tr").forEach((row) => {
    Array.from(row.cells).filter(isContentCell)[columnIndex]?.classList.add(className);
  });
}

function showColumnDropPosition(table: HTMLTableElement, insertionIndex: number) {
  table
    .querySelectorAll(".floral-table-column-drop-before,.floral-table-column-drop-after")
    .forEach((element) =>
      element.classList.remove("floral-table-column-drop-before", "floral-table-column-drop-after"),
    );
  const columnCount = firstRowContentCells(table).length;
  if (insertionIndex >= columnCount) {
    markContentColumn(table, columnCount - 1, "floral-table-column-drop-after");
  } else {
    markContentColumn(table, insertionIndex, "floral-table-column-drop-before");
  }
}

function applyColumnWidths(table: HTMLTableElement, widths: number[], tableWidth: number) {
  table.style.setProperty("width", `${tableWidth}px`, "important");
  table.style.setProperty("table-layout", "fixed", "important");
  widths.forEach((width, columnIndex) => applyColumnWidth(table, columnIndex, width));
}

export function TableInteractionLayer({ containerRef, disabled }: TableInteractionLayerProps) {
  const { t } = useTranslation();
  const [toolbar, setToolbar] = useState<ToolbarPosition | null>(null);
  const [alignmentScope, setAlignmentScope] = useState<"current" | "all">("current");
  const activeTableRef = useRef<HTMLTableElement | null>(null);

  const updateToolbar = useCallback(() => {
    const container = containerRef.current;
    const table = activeTableRef.current;
    if (!container || !table?.isConnected) {
      table?.classList.remove("floral-table-toolbar-active");
      activeTableRef.current = null;
      setToolbar(null);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    setToolbar({
      table,
      left: Math.max(8, tableRect.left - containerRect.left + 5),
      top: Math.max(42, tableRect.top - containerRect.top - 31),
    });
  }, [containerRef]);

  useEffect(() => {
    if (disabled) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    let selectionStart: HTMLTableCellElement | null = null;
    let crossingCells = false;
    let resize:
      | {
          table: HTMLTableElement;
          column: number;
          startX: number;
          widths: number[];
          tableWidth: number;
        }
      | undefined;
    let resizeTarget: HTMLTableCellElement | null = null;
    let reorderTarget: HTMLTableCellElement | null = null;
    let reorder:
      | {
          table: HTMLTableElement;
          sourceColumn: number;
          insertionIndex: number;
        }
      | undefined;

    const showForTable = (table: HTMLTableElement | null) => {
      const previousTable = activeTableRef.current;
      if (previousTable && previousTable !== table) {
        previousTable.classList.remove("floral-table-toolbar-active");
      }

      if (table) {
        if (previousTable !== table) setAlignmentScope("current");
        table.classList.add("floral-table-toolbar-active");
        activeTableRef.current = table;
        updateToolbar();
      } else {
        previousTable?.classList.remove("floral-table-toolbar-active");
        activeTableRef.current = null;
        setToolbar(null);
      }
    };

    const handleFocusOrClick = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      const table = target?.closest<HTMLTableElement>(".markdown-content-editor__content table");
      if (table) {
        showForTable(table);
      } else if (!target?.closest(".table-format-toolbar")) {
        showForTable(null);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (reorder) {
        event.preventDefault();
        reorder.insertionIndex = getColumnInsertionIndex(reorder.table, event.clientX);
        showColumnDropPosition(reorder.table, reorder.insertionIndex);
        return;
      }

      if (resize) {
        event.preventDefault();
        const minimumWidth = 72;
        const leftWidth = resize.widths[resize.column];
        const rightWidth = resize.widths[resize.column + 1];
        const requestedDelta = event.clientX - resize.startX;
        const delta = Math.max(
          minimumWidth - leftWidth,
          Math.min(rightWidth - minimumWidth, requestedDelta),
        );
        const nextWidths = [...resize.widths];
        nextWidths[resize.column] = leftWidth + delta;
        nextWidths[resize.column + 1] = rightWidth - delta;
        applyColumnWidths(resize.table, nextWidths, resize.tableWidth);
        updateToolbar();
        return;
      }

      if (selectionStart && event.buttons === 1) {
        const hovered = findContentCell(document.elementFromPoint(event.clientX, event.clientY));
        if (hovered && selectAcrossCells(selectionStart, hovered)) {
          crossingCells = true;
          event.preventDefault();
          updateToolbar();
        }
        return;
      }

      resizeTarget?.classList.remove("floral-table-resize-target");
      resizeTarget = null;
      reorderTarget?.classList.remove("floral-table-reorder-target");
      reorderTarget = null;
      const cell = findContentCell(event.target);
      if (!cell) return;
      const coordinates = contentCellCoordinates(cell);
      const columnCount = getColumnWidths(cell.closest("table") as HTMLTableElement).length;
      if (!coordinates || coordinates.column >= columnCount - 1) return;
      const rect = cell.getBoundingClientRect();
      if (Math.abs(event.clientX - rect.right) <= 6) {
        resizeTarget = cell;
        cell.classList.add("floral-table-resize-target");
      } else if (coordinates.row === 0 && isNearColumnTop(event, cell)) {
        reorderTarget = cell;
        cell.classList.add("floral-table-reorder-target");
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const pointerTarget = event.target instanceof Element ? event.target : null;
      if (pointerTarget?.closest(".table-format-toolbar")) return;
      clearCellSelection(container);
      const cell = findContentCell(event.target);
      selectionStart = null;
      crossingCells = false;
      if (!cell) return;

      const rect = cell.getBoundingClientRect();
      const table = cell.closest("table") as HTMLTableElement;
      const coordinates = contentCellCoordinates(cell);
      if (!coordinates) return;

      if (
        Math.abs(event.clientX - rect.right) > 6 &&
        coordinates.row === 0 &&
        isNearColumnTop(event, cell)
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (
          document.activeElement instanceof HTMLElement &&
          table.contains(document.activeElement)
        ) {
          document.activeElement.blur();
        }
        reorder = {
          table,
          sourceColumn: coordinates.column,
          insertionIndex: coordinates.column,
        };
        markContentColumn(table, coordinates.column, "floral-table-column-drag-source");
        showColumnDropPosition(table, coordinates.column);
        table.classList.add("is-reordering-columns");
        document.body.classList.add("floral-column-reordering");
        return;
      }

      selectionStart = cell;
      if (Math.abs(event.clientX - rect.right) > 6) return;
      const widths = getColumnWidths(table);
      if (coordinates.column >= widths.length - 1) return;
      event.preventDefault();
      event.stopPropagation();
      const tableWidth = table.getBoundingClientRect().width;
      applyColumnWidths(table, widths, tableWidth);
      resize = {
        table,
        column: coordinates.column,
        startX: event.clientX,
        widths,
        tableWidth,
      };
      table.classList.add("is-resizing-columns");
      document.body.classList.add("floral-column-resizing");
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (reorder) {
        const { table, sourceColumn, insertionIndex } = reorder;
        const toColumn = insertionIndex > sourceColumn ? insertionIndex - 1 : insertionIndex;
        const tables = Array.from(
          container.querySelectorAll<HTMLTableElement>(".markdown-content-editor__content table"),
        );
        const tableIndex = tables.indexOf(table);
        clearColumnDragClasses(table);
        table.classList.remove("is-reordering-columns");
        document.body.classList.remove("floral-column-reordering");
        reorder = undefined;

        if (tableIndex >= 0 && toColumn !== sourceColumn) {
          const detail: TableColumnReorderDetail = {
            tableIndex,
            fromColumn: sourceColumn,
            toColumn,
          };
          const editorRoot = table.closest<HTMLElement>(".markdown-content-editor__content");
          editorRoot?.dispatchEvent(new CustomEvent(TABLE_COLUMN_REORDER_EVENT, { detail }));
          window.requestAnimationFrame(updateToolbar);
        }
        event.preventDefault();
        event.stopPropagation();
        selectionStart = null;
        crossingCells = false;
        return;
      }

      if (resize) {
        resize.table.classList.remove("is-resizing-columns");
        document.body.classList.remove("floral-column-resizing");
        resize = undefined;
      }
      if (crossingCells) {
        event.preventDefault();
        event.stopPropagation();
      }
      selectionStart = null;
      crossingCells = false;
    };

    const handleCopy = (event: ClipboardEvent) => {
      const text = activeTableRef.current?.dataset.floralSelectedText;
      if (!text || !event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", text);
    };

    const handleScrollOrResize = () => updateToolbar();
    container.addEventListener("focusin", handleFocusOrClick);
    container.addEventListener("click", handleFocusOrClick);
    container.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", handlePointerUp, true);
    container.addEventListener("copy", handleCopy, true);
    container.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      container.removeEventListener("focusin", handleFocusOrClick);
      container.removeEventListener("click", handleFocusOrClick);
      container.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp, true);
      container.removeEventListener("copy", handleCopy, true);
      container.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      document.body.classList.remove("floral-column-resizing");
      document.body.classList.remove("floral-column-reordering");
      if (reorder) clearColumnDragClasses(reorder.table);
      reorderTarget?.classList.remove("floral-table-reorder-target");
      activeTableRef.current?.classList.remove("floral-table-toolbar-active");
      activeTableRef.current = null;
      getHighlightRegistry()?.delete("floral-table-selection");
    };
  }, [containerRef, disabled, updateToolbar]);

  const align = (action: "align-left" | "align-center" | "align-right") => {
    if (!toolbar) return;
    const context = getTableContextTarget(toolbar.table);
    if (context) {
      void runTableContextAction(context, action, { alignmentScope });
    }
  };

  if (!toolbar || disabled) return null;
  const alignTarget =
    alignmentScope === "all"
      ? t("contextMenu.table.wholeTable", { defaultValue: "整个表格" })
      : t("contextMenu.table.currentColumn", { defaultValue: "当前列" });
  return (
    <>
      <style>{`
        ::highlight(floral-table-selection) {
          background: color-mix(in srgb, #78b7ff 48%, transparent);
          color: inherit;
        }
      `}</style>
      <div
        className="table-format-toolbar"
        style={{ left: toolbar.left, top: toolbar.top }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <select
          value={alignmentScope}
          onChange={(event) => setAlignmentScope(event.target.value as "current" | "all")}
          onMouseDown={(event) => event.stopPropagation()}
          title={t("contextMenu.table.alignmentScope", { defaultValue: "选择对齐范围" })}
          aria-label={t("contextMenu.table.alignmentScope", { defaultValue: "选择对齐范围" })}
        >
          <option value="current">
            {t("contextMenu.table.currentColumn", { defaultValue: "当前列" })}
          </option>
          <option value="all">
            {t("contextMenu.table.wholeTable", { defaultValue: "整个表格" })}
          </option>
        </select>
        <button
          type="button"
          onClick={() => align("align-left")}
          title={`${alignTarget}左对齐`}
          aria-label={`${alignTarget}左对齐`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M4 10h10M4 14h16M4 18h11" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => align("align-center")}
          title={`${alignTarget}居中`}
          aria-label={`${alignTarget}居中`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M7 10h10M4 14h16M6.5 18h11" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => align("align-right")}
          title={`${alignTarget}右对齐`}
          aria-label={`${alignTarget}右对齐`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M10 10h10M4 14h16M9 18h11" />
          </svg>
        </button>
      </div>
    </>
  );
}
