import { useEffect, useMemo, useRef, useState } from "react";
import {
  CodeMirrorEditor,
  useCodeBlockEditorContext,
  type CodeBlockEditorProps,
} from "@mdxeditor/editor";
import { useTranslation } from "react-i18next";
import {
  detectCodeLanguage,
  filterCodeLanguages,
  findCodeLanguage,
  type CodeLanguageOption,
} from "./codeBlockLanguages";

export function SmartCodeBlockEditor(props: CodeBlockEditorProps) {
  const { t } = useTranslation();
  const { setLanguage, lexicalNode, parentEditor } = useCodeBlockEditorContext();
  const autoDetectionAttempted = useRef(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const currentOption = useMemo(() => findCodeLanguage(props.language), [props.language]);
  const [query, setQuery] = useState(currentOption?.name ?? props.language ?? "Text");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestions = useMemo(() => filterCodeLanguages(query), [query]);

  useEffect(() => {
    setQuery(currentOption?.name ?? props.language ?? "Text");
  }, [currentOption?.name, props.language]);

  useEffect(() => {
    if (!props.language?.trim()) setLanguage("text");
  }, [props.language, setLanguage]);

  useEffect(() => {
    if (autoDetectionAttempted.current || !props.code.trim()) return;
    if (props.language && !["text", "txt", "plaintext"].includes(props.language.toLowerCase())) {
      autoDetectionAttempted.current = true;
      return;
    }
    const detected = detectCodeLanguage(props.code);
    if (detected) {
      autoDetectionAttempted.current = true;
      setLanguage(detected);
    }
  }, [props.code, props.language, setLanguage]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && blockRef.current?.contains(target)) return;
      setActive(false);
      setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    const block = blockRef.current;
    if (!block) return undefined;
    const handleDelete = () => parentEditor.update(() => lexicalNode.remove());
    block.addEventListener("floral-delete-code-block", handleDelete);
    return () => block.removeEventListener("floral-delete-code-block", handleDelete);
  }, [lexicalNode, parentEditor]);

  const chooseLanguage = (option: CodeLanguageOption) => {
    setLanguage(option.id);
    setQuery(option.name);
    setOpen(false);
    setActiveIndex(0);
  };

  return (
    <div
      ref={blockRef}
      data-context-menu="code-block"
      className={`smart-code-block ${active ? "is-active" : ""}`}
      onFocusCapture={() => setActive(true)}
      onMouseDownCapture={() => setActive(true)}
      onContextMenu={() => {
        setActive(true);
        setOpen(false);
      }}
    >
      <div className="smart-code-block__editor">
        <CodeMirrorEditor {...props} />
      </div>
      {active && (
        <div className="smart-code-block__controls">
          <div className="smart-code-block__language">
            <input
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={`code-language-${props.nodeKey}`}
              aria-label={t("markdown.codeBlock.searchLanguage", { defaultValue: "搜索代码语言" })}
              value={query}
              onFocus={(event) => {
                event.currentTarget.select();
                setOpen(true);
              }}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
                setActiveIndex(0);
              }}
              onBlur={() => window.setTimeout(() => setOpen(false), 120)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setOpen(true);
                  setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter" && suggestions[activeIndex]) {
                  event.preventDefault();
                  chooseLanguage(suggestions[activeIndex]);
                } else if (event.key === "Escape") {
                  setOpen(false);
                  setQuery(currentOption?.name ?? props.language ?? "Text");
                }
              }}
            />
            <svg aria-hidden="true" viewBox="0 0 16 16" className="smart-code-block__chevron">
              <path
                d="m4 6 4 4 4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            {open && (
              <div
                id={`code-language-${props.nodeKey}`}
                role="listbox"
                className="smart-code-block__suggestions"
              >
                {suggestions.map((option, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    key={`${option.id}-${option.name}`}
                    className={index === activeIndex ? "is-active" : ""}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseLanguage(option)}
                  >
                    <span>{option.name}</span>
                    <small>{option.id}</small>
                  </button>
                ))}
                {suggestions.length === 0 && (
                  <span className="smart-code-block__empty">
                    {t("markdown.codeBlock.noLanguage", { defaultValue: "没有匹配的语言" })}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
