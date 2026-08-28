import { useEffect, useState } from "react";
import { useCellValues } from "@mdxeditor/gurx";
import {
  activeEditor$,
  ButtonWithTooltip,
  iconComponentFor$,
  rootEditor$,
} from "@mdxeditor/editor";
import {
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import { mergeRegister } from "@lexical/utils";
import { useTranslation } from "react-i18next";

/**
 * MDXEditor's stock control follows the currently focused nested editor. Table cells
 * each have their own editor, so that control loses the document history after a cell
 * is blurred. These buttons deliberately stay connected to the root document editor.
 */
export function RootUndoRedo() {
  const { t } = useTranslation();
  const [rootEditor, activeEditor, iconComponentFor] = useCellValues(
    rootEditor$,
    activeEditor$,
    iconComponentFor$,
  );
  const [rootCanUndo, setRootCanUndo] = useState(false);
  const [rootCanRedo, setRootCanRedo] = useState(false);
  const [activeCanUndo, setActiveCanUndo] = useState(false);
  const [activeCanRedo, setActiveCanRedo] = useState(false);
  const [, setFocusRevision] = useState(0);

  useEffect(() => {
    if (!rootEditor) return undefined;
    return mergeRegister(
      rootEditor.registerCommand(
        CAN_UNDO_COMMAND,
        (value) => {
          setRootCanUndo(value);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      rootEditor.registerCommand(
        CAN_REDO_COMMAND,
        (value) => {
          setRootCanRedo(value);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    );
  }, [rootEditor]);

  useEffect(() => {
    setActiveCanUndo(false);
    setActiveCanRedo(false);
    if (!activeEditor || activeEditor === rootEditor) return undefined;
    return mergeRegister(
      activeEditor.registerCommand(
        CAN_UNDO_COMMAND,
        (value) => {
          setActiveCanUndo(value);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      activeEditor.registerCommand(
        CAN_REDO_COMMAND,
        (value) => {
          setActiveCanRedo(value);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    );
  }, [activeEditor, rootEditor]);

  useEffect(() => {
    const updateFocus = () => setFocusRevision((revision) => revision + 1);
    document.addEventListener("focusin", updateFocus, true);
    document.addEventListener("focusout", updateFocus, true);
    return () => {
      document.removeEventListener("focusin", updateFocus, true);
      document.removeEventListener("focusout", updateFocus, true);
    };
  }, []);

  const nestedRoot = activeEditor && activeEditor !== rootEditor ? activeEditor.getRootElement() : null;
  const nestedTableEditorActive = Boolean(
    nestedRoot?.isConnected &&
      nestedRoot.closest("th,td") &&
      (nestedRoot.contains(document.activeElement) ||
        nestedRoot.closest<HTMLTableCellElement>('[data-active="true"]')),
  );
  const undoEnabled = nestedTableEditorActive ? activeCanUndo || rootCanUndo : rootCanUndo;
  const redoEnabled = nestedTableEditorActive ? activeCanRedo || rootCanRedo : rootCanRedo;

  const dispatchUndo = () => {
    const editor = nestedTableEditorActive && activeCanUndo ? activeEditor : rootEditor;
    editor?.dispatchCommand(UNDO_COMMAND, undefined);
  };

  const dispatchRedo = () => {
    const editor = nestedTableEditorActive && activeCanRedo ? activeEditor : rootEditor;
    editor?.dispatchCommand(REDO_COMMAND, undefined);
  };

  return (
    <div className="root-undo-redo">
      <ButtonWithTooltip
        title={t("toolbar.undo", { defaultValue: "撤销（Ctrl+Z）" })}
        disabled={!undoEnabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={dispatchUndo}
      >
        {iconComponentFor("undo")}
      </ButtonWithTooltip>
      <ButtonWithTooltip
        title={t("toolbar.redo", { defaultValue: "重做（Ctrl+Y）" })}
        disabled={!redoEnabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={dispatchRedo}
      >
        {iconComponentFor("redo")}
      </ButtonWithTooltip>
    </div>
  );
}
