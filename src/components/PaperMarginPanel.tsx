import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { estimateReadingMinutes, extractDocumentHeadings } from "../features/markdown/paperMargin";

const INSPIRATION_KEYS = [
  "main.paperMargin.prompts.detail",
  "main.paperMargin.prompts.question",
  "main.paperMargin.prompts.reverse",
  "main.paperMargin.prompts.small",
  "main.paperMargin.prompts.senses",
] as const;

interface PaperMarginPanelProps {
  content: string;
  noteKey: string | null;
  lineCount: number;
  characterCount: number;
  onHeadingClick: (index: number) => void;
}

export function PaperMarginPanel({
  content,
  noteKey,
  lineCount,
  characterCount,
  onHeadingClick,
}: PaperMarginPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => localStorage.getItem("floral-paper-margin") !== "closed");
  const [promptIndex, setPromptIndex] = useState(0);
  const headings = useMemo(() => extractDocumentHeadings(content), [content]);
  const readingMinutes = estimateReadingMinutes(characterCount);

  useEffect(() => {
    const seed = noteKey ? [...noteKey].reduce((total, char) => total + char.charCodeAt(0), 0) : 0;
    setPromptIndex(seed % INSPIRATION_KEYS.length);
  }, [noteKey]);

  const toggleOpen = () => {
    setOpen((current) => {
      const next = !current;
      localStorage.setItem("floral-paper-margin", next ? "open" : "closed");
      return next;
    });
  };

  return (
    <aside
      className={`paper-margin-panel ${open ? "is-open" : "is-closed"}`}
      aria-label={t("main.paperMargin.title", { defaultValue: "纸边栏" })}
    >
      <button
        type="button"
        className="paper-margin-toggle"
        onClick={toggleOpen}
        title={
          open
            ? t("main.paperMargin.collapse", { defaultValue: "收起纸边栏" })
            : t("main.paperMargin.expand", { defaultValue: "展开纸边栏" })
        }
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={open ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
        </svg>
      </button>

      {open && (
        <div className="paper-margin-inner">
          <div className="paper-margin-flourish" aria-hidden="true">
            <span className="paper-margin-flower flower-one" />
            <span className="paper-margin-flower flower-two" />
            <svg viewBox="0 0 120 54">
              <path d="M6 48c30-2 38-28 65-30 16-1 24 7 43-9" />
              <path d="M39 32c-8-1-13-5-17-11 9-1 15 2 19 8M72 18c-3-8-1-14 4-19 5 8 4 14-1 20" />
            </svg>
          </div>

          <section className="paper-margin-section paper-margin-stats">
            <div className="paper-margin-eyebrow">
              {t("main.paperMargin.today", { defaultValue: "这一页" })}
            </div>
            <div className="paper-margin-stat-row">
              <span>
                <strong>{lineCount}</strong>
                {t("main.paperMargin.lines", { defaultValue: "行" })}
              </span>
              <span>
                <strong>{characterCount}</strong>
                {t("main.paperMargin.characters", { defaultValue: "字" })}
              </span>
              <span>
                <strong>{readingMinutes}</strong>
                {t("main.paperMargin.minutes", { defaultValue: "分钟" })}
              </span>
            </div>
          </section>

          <section className="paper-margin-section paper-margin-outline">
            <div className="paper-margin-section-title">
              <span>{t("main.paperMargin.outline", { defaultValue: "文章脉络" })}</span>
              <span className="paper-margin-count">{headings.length}</span>
            </div>
            {headings.length > 0 ? (
              <nav className="paper-margin-outline-list">
                {headings.map((heading, index) => (
                  <button
                    key={`${heading.level}-${heading.text}-${index}`}
                    type="button"
                    className="paper-margin-heading"
                    style={{ paddingLeft: `${5 + (heading.level - 1) * 8}px` } as CSSProperties}
                    onClick={() => onHeadingClick(index)}
                    title={heading.text}
                  >
                    <span>{heading.text}</span>
                  </button>
                ))}
              </nav>
            ) : (
              <p className="paper-margin-empty">
                {t("main.paperMargin.noHeadings", {
                  defaultValue: "加一个标题，文章的脉络就会从这里长出来。",
                })}
              </p>
            )}
          </section>

          <section className="paper-margin-section paper-margin-inspiration">
            <div className="paper-margin-section-title">
              <span>{t("main.paperMargin.inspiration", { defaultValue: "灵感签" })}</span>
              <button
                type="button"
                onClick={() => setPromptIndex((current) => (current + 1) % INSPIRATION_KEYS.length)}
                title={t("main.paperMargin.nextPrompt", { defaultValue: "换一签" })}
                aria-label={t("main.paperMargin.nextPrompt", { defaultValue: "换一签" })}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" />
                </svg>
              </button>
            </div>
            <p>“{t(INSPIRATION_KEYS[promptIndex])}”</p>
          </section>

          <div className="paper-margin-footnote">
            {t("main.paperMargin.footnote", { defaultValue: "慢慢写，纸会记得。" })}
          </div>
        </div>
      )}
    </aside>
  );
}
