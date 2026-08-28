import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useCodeBlockEditorContext,
  type CodeBlockEditorProps,
} from "@mdxeditor/editor";
import { MermaidDiagram } from "./MermaidDiagram";

export function MermaidCodeBlockEditor({ code, focusEmitter }: CodeBlockEditorProps) {
  const { t } = useTranslation();
  const { setCode, parentEditor } = useCodeBlockEditorContext();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const editable = parentEditor.isEditable();

  useEffect(() => {
    focusEmitter.subscribe(() => {
      if (!editable) return;
      setSourceOpen(true);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    });
  }, [editable, focusEmitter]);

  return (
    <div className="mermaid-editor-card">
      <div className="mermaid-editor-header">
        <span>{t("markdown.mermaid.diagram", { defaultValue: "Mermaid 流程图" })}</span>
        {editable && (
          <button
            type="button"
            onClick={() => setSourceOpen((open) => !open)}
            className="mermaid-editor-toggle"
          >
            {sourceOpen
              ? t("markdown.mermaid.hideSource", { defaultValue: "收起源码" })
              : t("markdown.mermaid.editSource", { defaultValue: "编辑源码" })}
          </button>
        )}
      </div>
      {sourceOpen && editable && (
        <textarea
          ref={textareaRef}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          spellCheck={false}
          className="mermaid-editor-source"
          aria-label={t("markdown.mermaid.source", { defaultValue: "流程图源码" })}
        />
      )}
      <MermaidDiagram code={code} />
    </div>
  );
}
