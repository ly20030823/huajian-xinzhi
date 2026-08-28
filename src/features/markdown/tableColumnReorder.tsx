import { useEffect } from "react";
import { $nodesOfType } from "lexical";
import { useCellValue } from "@mdxeditor/gurx";
import { TableNode, addComposerChild$, realmPlugin, rootEditor$ } from "@mdxeditor/editor";

export const TABLE_COLUMN_REORDER_EVENT = "floral:table-column-reorder";

export interface TableColumnReorderDetail {
  tableIndex: number;
  fromColumn: number;
  toColumn: number;
}

interface ReorderableTable {
  children: Array<{ children: unknown[] }>;
  align?: unknown[];
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): boolean {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return false;
  }

  const [item] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, item);
  return true;
}

export function reorderTableColumn(
  table: ReorderableTable,
  fromColumn: number,
  toColumn: number,
): boolean {
  const columnCount = table.children[0]?.children.length ?? 0;
  if (
    fromColumn === toColumn ||
    fromColumn < 0 ||
    toColumn < 0 ||
    fromColumn >= columnCount ||
    toColumn >= columnCount
  ) {
    return false;
  }

  table.children.forEach((row) => moveArrayItem(row.children, fromColumn, toColumn));
  if (table.align?.length) moveArrayItem(table.align, fromColumn, toColumn);
  return true;
}

function TableColumnReorderBridge() {
  const editor = useCellValue(rootEditor$);

  useEffect(() => {
    if (!editor) return undefined;

    let activeRoot: HTMLElement | null = null;
    const handleReorder = (event: Event) => {
      const detail = (event as CustomEvent<TableColumnReorderDetail>).detail;
      if (!detail) return;

      editor.update(() => {
        const table = $nodesOfType(TableNode)[detail.tableIndex];
        if (!table) return;
        const writableTable = table.getWritable();
        reorderTableColumn(
          writableTable.getMdastNode() as ReorderableTable,
          detail.fromColumn,
          detail.toColumn,
        );
      });
    };

    const unregisterRootListener = editor.registerRootListener((root) => {
      activeRoot?.removeEventListener(TABLE_COLUMN_REORDER_EVENT, handleReorder);
      activeRoot = root;
      activeRoot?.addEventListener(TABLE_COLUMN_REORDER_EVENT, handleReorder);
    });

    return () => {
      activeRoot?.removeEventListener(TABLE_COLUMN_REORDER_EVENT, handleReorder);
      unregisterRootListener();
    };
  }, [editor]);

  return null;
}

export const tableColumnReorderPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, TableColumnReorderBridge);
  },
});
