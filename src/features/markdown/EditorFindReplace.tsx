import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditorSearch } from "@mdxeditor/editor";
import { useTranslation } from "react-i18next";
import { escapeEditorSearchTerm } from "./editorSearch";

export function EditorFindReplace() {
  const { t } = useTranslation();
  const {
    closeSearch,
    cursor,
    isSearchOpen,
    next,
    openSearch,
    prev,
    replace,
    replaceAll,
    setSearch,
    total,
  } = useEditorSearch();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [replaceVisible, setReplaceVisible] = useState(false);

  const focusQuery = useCallback(() => {
    window.requestAnimationFrame(() => {
      queryInputRef.current?.focus();
      queryInputRef.current?.select();
    });
  }, []);

  const showSearch = useCallback(
    (withReplace: boolean) => {
      setReplaceVisible(withReplace);
      setSearch(escapeEditorSearchTerm(query));
      openSearch();
      focusQuery();
    },
    [focusQuery, openSearch, query, setSearch],
  );

  const hideSearch = useCallback(() => {
    closeSearch();
    setSearch(null);
  }, [closeSearch, setSearch]);

  useEffect(() => {
    setHost(anchorRef.current?.closest<HTMLElement>(".markdown-content-editor") ?? null);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: Event) => {
      const detail = (event as CustomEvent<{ replace?: boolean }>).detail;
      showSearch(Boolean(detail?.replace));
    };

    window.addEventListener("floral-editor-find", handleShortcut);
    return () => window.removeEventListener("floral-editor-find", handleShortcut);
  }, [showSearch]);

  useEffect(() => {
    if (isSearchOpen) focusQuery();
  }, [focusQuery, isSearchOpen]);

  const updateQuery = (value: string) => {
    setQuery(value);
    setSearch(escapeEditorSearchTerm(value));
  };

  const panel = isSearchOpen ? (
    <div
      className="editor-find-panel"
      role="search"
      aria-label={t("main.find.title", { defaultValue: "查找与替换" })}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          hideSearch();
        }
      }}
    >
      <div className="editor-find-panel__row">
        <button
          type="button"
          className={`editor-find-panel__icon-button editor-find-panel__toggle ${replaceVisible ? "is-active" : ""}`}
          onClick={() => setReplaceVisible((visible) => !visible)}
          title={t("main.find.toggleReplace", { defaultValue: "展开替换" })}
          aria-label={t("main.find.toggleReplace", { defaultValue: "展开替换" })}
          aria-expanded={replaceVisible}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m9 6 6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="editor-find-panel__field">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="m16.5 16.5 4 4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <input
            ref={queryInputRef}
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (event.shiftKey) prev();
              else next();
            }}
            placeholder={t("main.find.placeholder", { defaultValue: "查找当前笔记" })}
            aria-label={t("main.find.query", { defaultValue: "查找内容" })}
            spellCheck={false}
          />
          <span className="editor-find-panel__count" aria-live="polite">
            {query ? `${total > 0 ? cursor : 0} / ${total}` : "0 / 0"}
          </span>
        </div>
        <button
          type="button"
          className="editor-find-panel__icon-button"
          onClick={prev}
          disabled={total === 0}
          title={t("main.find.previous", { defaultValue: "上一个（Shift+Enter）" })}
          aria-label={t("main.find.previous", { defaultValue: "上一个" })}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m6 15 6-6 6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="editor-find-panel__icon-button"
          onClick={next}
          disabled={total === 0}
          title={t("main.find.next", { defaultValue: "下一个（Enter）" })}
          aria-label={t("main.find.next", { defaultValue: "下一个" })}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m6 9 6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="editor-find-panel__icon-button"
          onClick={hideSearch}
          title={t("common.close", { defaultValue: "关闭" })}
          aria-label={t("common.close", { defaultValue: "关闭" })}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6 6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {replaceVisible ? (
        <div className="editor-find-panel__row editor-find-panel__replace-row">
          <span className="editor-find-panel__replace-indent" aria-hidden="true" />
          <div className="editor-find-panel__field">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 7h11m0 0-3-3m3 3-3 3M19 17H8m0 0 3-3m-3 3 3 3"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <input
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                replace(replacement);
              }}
              placeholder={t("main.find.replacePlaceholder", { defaultValue: "替换为" })}
              aria-label={t("main.find.replacement", { defaultValue: "替换内容" })}
              spellCheck={false}
            />
          </div>
          <button
            type="button"
            className="editor-find-panel__text-button"
            onClick={() => replace(replacement)}
            disabled={total === 0}
            title={t("main.find.replaceOneTitle", { defaultValue: "替换当前匹配" })}
          >
            {t("main.find.replaceOne", { defaultValue: "替换" })}
          </button>
          <button
            type="button"
            className="editor-find-panel__text-button"
            onClick={() => replaceAll(replacement)}
            disabled={total === 0}
            title={t("main.find.replaceAllTitle", { defaultValue: "替换全部匹配" })}
          >
            {t("main.find.replaceAll", { defaultValue: "全部" })}
          </button>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <span ref={anchorRef} className="hidden" aria-hidden="true" />
      <style>{`
        ::highlight(MdxSearch) {
          background: color-mix(in srgb, #f5c451 48%, transparent);
        }
        ::highlight(MdxFocusSearch) {
          background: color-mix(in srgb, var(--color-bamboo) 42%, transparent);
          text-decoration: underline;
          text-decoration-color: var(--color-bamboo);
          text-underline-offset: 2px;
        }
      `}</style>
      {host && panel ? createPortal(panel, host) : null}
    </>
  );
}
