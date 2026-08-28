export type TableContextAction =
  | "insert-row-above"
  | "insert-row-below"
  | "insert-column-left"
  | "insert-column-right"
  | "align-left"
  | "align-center"
  | "align-right"
  | "auto-fit"
  | "delete-row"
  | "delete-column"
  | "delete-table";

export interface TableContextTarget {
  table: HTMLTableElement;
  rowIndex: number;
  columnIndex: number;
}

export type TableAlignmentScope = "selection-or-current" | "current" | "all";

function isContentCell(cell: HTMLTableCellElement) {
  return cell.dataset.toolCell !== "true";
}

export function getTableContextTarget(target: Element): TableContextTarget | null {
  const table = target.closest<HTMLTableElement>(".markdown-content-editor__content table");
  if (!table) return null;

  const activeCell = table.querySelector<HTMLTableCellElement>('[data-active="true"]');
  const clickedCell = target.closest<HTMLTableCellElement>("th, td");
  const cell = clickedCell && isContentCell(clickedCell) ? clickedCell : activeCell;
  const row = cell?.closest<HTMLTableRowElement>("tbody tr") ?? table.tBodies[0]?.rows[0];
  if (!row) return null;

  const rows = Array.from(table.tBodies[0]?.rows ?? []);
  const contentCells = Array.from(row.cells).filter(isContentCell);

  return {
    table,
    rowIndex: Math.max(0, rows.indexOf(row)),
    columnIndex: Math.max(0, cell ? contentCells.indexOf(cell) : 0),
  };
}

function nextFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function runHiddenTableMenu(trigger: HTMLButtonElement | null, actionIndex: number) {
  if (!trigger) return;

  trigger.click();
  await nextFrame();

  const popovers = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[class*="tableColumnEditorPopoverContent"][data-state="open"]',
    ),
  );
  const popover = popovers[popovers.length - 1];
  if (!popover) return;

  const buttons = Array.from(popover.querySelectorAll<HTMLButtonElement>("button"));
  // Both the row and column popovers finish with: insert before, insert after, delete.
  buttons[buttons.length - 3 + actionIndex]?.click();
}

function getRowMenuTrigger(context: TableContextTarget) {
  const row = context.table.tBodies[0]?.rows[context.rowIndex];
  return (
    row?.querySelector<HTMLButtonElement>(':scope > [data-tool-cell="true"]:first-child button') ??
    null
  );
}

function getColumnMenuTrigger(context: TableContextTarget) {
  const headerRow = context.table.tHead?.rows[0];
  // The first header cell is the hidden row-tools spacer.
  return (
    headerRow?.cells[context.columnIndex + 1]?.querySelector<HTMLButtonElement>("button") ?? null
  );
}

async function setColumnAlignment(context: TableContextTarget, alignmentIndex: number) {
  const trigger = getColumnMenuTrigger(context);
  if (!trigger) return;

  trigger.click();
  await nextFrame();
  const popovers = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[class*="tableColumnEditorPopoverContent"][data-state="open"]',
    ),
  );
  const popover = popovers[popovers.length - 1];
  const buttons = Array.from(popover?.querySelectorAll<HTMLButtonElement>("button") ?? []);
  buttons[alignmentIndex]?.click();
  await nextFrame();
  if (trigger.getAttribute("aria-expanded") === "true") trigger.click();
}

function getAlignmentColumns(
  context: TableContextTarget,
  scope: TableAlignmentScope = "selection-or-current",
) {
  if (scope === "current") return [context.columnIndex];
  if (scope === "all") {
    const firstRow = context.table.tBodies[0]?.rows[0];
    const columnCount = firstRow
      ? Array.from(firstRow.cells).filter(isContentCell).length
      : 0;
    return Array.from({ length: columnCount }, (_, columnIndex) => columnIndex);
  }

  const selected = context.table.dataset.floralSelectedColumns
    ?.split(",")
    .map(Number)
    .filter((column) => Number.isInteger(column) && column >= 0);
  return selected?.length ? Array.from(new Set(selected)) : [context.columnIndex];
}

async function setTargetColumnsAlignment(
  context: TableContextTarget,
  alignmentIndex: number,
  scope?: TableAlignmentScope,
) {
  for (const columnIndex of getAlignmentColumns(context, scope)) {
    await setColumnAlignment({ ...context, columnIndex }, alignmentIndex);
  }
}

function autoFitTable(table: HTMLTableElement) {
  table.dataset.floralAutoFit = "true";
  table.style.setProperty("width", "100%", "important");
  table.style.setProperty("height", "auto", "important");
  table.style.setProperty("table-layout", "auto", "important");

  table.querySelectorAll<HTMLElement>("col, th, td").forEach((element) => {
    element.style.removeProperty("width");
    element.style.removeProperty("min-width");
    element.style.removeProperty("max-width");
    element.style.removeProperty("height");
  });
}

export async function runTableContextAction(
  context: TableContextTarget,
  action: TableContextAction,
  options?: { alignmentScope?: TableAlignmentScope },
) {
  switch (action) {
    case "insert-row-above":
      await runHiddenTableMenu(getRowMenuTrigger(context), 0);
      break;
    case "insert-row-below":
      await runHiddenTableMenu(getRowMenuTrigger(context), 1);
      break;
    case "insert-column-left":
      await runHiddenTableMenu(getColumnMenuTrigger(context), 0);
      break;
    case "insert-column-right":
      await runHiddenTableMenu(getColumnMenuTrigger(context), 1);
      break;
    case "align-left":
      await setTargetColumnsAlignment(context, 0, options?.alignmentScope);
      break;
    case "align-center":
      await setTargetColumnsAlignment(context, 1, options?.alignmentScope);
      break;
    case "align-right":
      await setTargetColumnsAlignment(context, 2, options?.alignmentScope);
      break;
    case "delete-row":
      await runHiddenTableMenu(getRowMenuTrigger(context), 2);
      break;
    case "delete-column":
      await runHiddenTableMenu(getColumnMenuTrigger(context), 2);
      break;
    case "delete-table": {
      const headerRow = context.table.tHead?.rows[0];
      headerRow?.cells[headerRow.cells.length - 1]
        ?.querySelector<HTMLButtonElement>("button")
        ?.click();
      break;
    }
    case "auto-fit":
      autoFitTable(context.table);
      break;
  }
}
