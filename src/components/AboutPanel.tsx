import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCustomizationContent } from "../features/customization/api";
import { renderAboutMarkdown } from "../features/customization/content";
import { MarkdownPreview } from "../features/markdown/MarkdownPreview";
import defaultAboutMarkdown from "../../customization/about.md?raw";
import defaultSyncGuideMarkdown from "../../customization/sync-guide.md?raw";

const mischievousNotes = [
  "认真记笔记，偷偷长灵感。",
  "别催，灵感正在系鞋带。",
  "纸很白，话可以不太乖。",
  "写下来，脑袋就能偷偷下班。",
  "抓住它——刚才有个念头路过。",
];

function pickAnotherNote(current: string): string {
  const choices = mischievousNotes.filter((note) => note !== current);
  return choices[Math.floor(Math.random() * choices.length)] ?? mischievousNotes[0];
}

interface AboutPanelProps {
  onClose: () => void;
}

export function AboutPanel({ onClose }: AboutPanelProps) {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");
  const [aboutMarkdown, setAboutMarkdown] = useState(defaultAboutMarkdown);
  const [syncGuideMarkdown, setSyncGuideMarkdown] = useState(defaultSyncGuideMarkdown);
  const [customizationDirectory, setCustomizationDirectory] = useState<string>();
  const [guideOpen, setGuideOpen] = useState(false);
  const [mischievousNote, setMischievousNote] = useState(
    () =>
      mischievousNotes[Math.floor(Math.random() * mischievousNotes.length)] ?? mischievousNotes[0],
  );

  useEffect(() => {
    let cancelled = false;
    void getVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => undefined);
    void getCustomizationContent()
      .then((content) => {
        if (cancelled) return;
        setAboutMarkdown(content.aboutMarkdown || defaultAboutMarkdown);
        setSyncGuideMarkdown(content.syncGuideMarkdown || defaultSyncGuideMarkdown);
        setCustomizationDirectory(content.directory);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const renderedAboutMarkdown = useMemo(
    () => renderAboutMarkdown(aboutMarkdown, version, new Date().getFullYear()),
    [aboutMarkdown, version],
  );

  return (
    <aside
      className="relative isolate w-[360px] h-full min-h-0 shrink-0 overflow-clip border-l border-paper-deep/30 bg-cloud flex flex-col"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between h-11 px-4 border-b border-paper-deep/25">
        <h2 className="text-[13px] font-display font-medium text-ink-soft">
          {guideOpen ? "Markdown 同步指南" : t("about.title", { defaultValue: "关于" })}
        </h2>
        <button
          type="button"
          onClick={() => {
            if (guideOpen) {
              setGuideOpen(false);
            } else {
              onClose();
            }
          }}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer"
          title={guideOpen ? "关闭同步指南" : t("about.closeTitle", { defaultValue: "关闭关于" })}
          aria-label={guideOpen ? "关闭同步指南" : t("about.closeTitle", { defaultValue: "关闭关于" })}
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
      </div>

      {guideOpen ? (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hidden px-5 py-5">
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-bamboo/15 bg-bamboo-mist/25 px-3 py-2">
            <span className="min-w-0">
              <span className="block text-[10px] tracking-[0.14em] text-bamboo/65">
                本地内置文档
              </span>
              <span className="block truncate text-[9px] text-ink-ghost" title={customizationDirectory}>
                customization/sync-guide.md
              </span>
            </span>
            <button
              type="button"
              onClick={() => setGuideOpen(false)}
              className="shrink-0 rounded-lg border border-paper-deep/35 px-2.5 py-1 text-[10px] text-ink-faint transition-colors hover:border-bamboo/30 hover:bg-cloud hover:text-bamboo"
            >
              关闭指南
            </button>
          </div>
          <section
            className="about-markdown"
            data-testid="sync-guide-markdown"
            title={
              customizationDirectory
                ? `${customizationDirectory}/sync-guide.md`
                : "customization/sync-guide.md"
            }
          >
            <MarkdownPreview
              content={syncGuideMarkdown}
              fontSize={11}
              imageBaseDir={customizationDirectory}
            />
          </section>
        </div>
      ) : (
      <div className="about-playground flex-1 min-h-0 overflow-y-auto scrollbar-hidden px-5 py-5">
        <div className="about-flower" aria-hidden="true">
          <span className="about-flower__petal about-flower__petal--one" />
          <span className="about-flower__petal about-flower__petal--two" />
          <span className="about-flower__petal about-flower__petal--three" />
          <span className="about-flower__petal about-flower__petal--four" />
          <span className="about-flower__face">⌣</span>
        </div>

        <section
          className="about-markdown mt-2"
          data-testid="about-custom-markdown"
          title={customizationDirectory}
        >
          <MarkdownPreview
            content={renderedAboutMarkdown}
            fontSize={11}
            imageBaseDir={customizationDirectory}
          />
        </section>

        <button
          type="button"
          className="mt-4 w-full rounded-2xl border border-bamboo/20 bg-bamboo-mist/25 px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-bamboo/35 hover:bg-bamboo-mist/45 hover:shadow-sm"
          onClick={() => setGuideOpen(true)}
          data-testid="open-sync-guide"
        >
          <span className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cloud text-lg shadow-sm"
              aria-hidden="true"
            >
              ☁
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-medium text-ink-soft">
                Markdown 多设备同步指南
              </span>
              <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-ghost">
                从创建仓库到连接第二台设备，一步一步来。
              </span>
            </span>
            <span className="text-[15px] text-bamboo/55" aria-hidden="true">
              ›
            </span>
          </span>
        </button>

        <button
          type="button"
          className="about-mischief-card group"
          onClick={() => setMischievousNote((current) => pickAnotherNote(current))}
          data-testid="about-mischief-button"
          title="戳一下，换句悄悄话"
        >
          <span className="about-mischief-card__spark" aria-hidden="true">
            ✦
          </span>
          <span className="min-w-0 text-left">
            <span className="block text-[10px] tracking-[0.18em] text-bamboo/55 mb-1">
              花笺悄悄话
            </span>
            <span
              className="block text-[12px] leading-relaxed text-ink-faint"
              data-testid="about-mischief-text"
            >
              {mischievousNote}
            </span>
          </span>
          <span className="about-mischief-card__wink" aria-hidden="true">
            换一句
          </span>
        </button>

        <p className="mt-4 text-center text-[10px] leading-relaxed text-ink-ghost/65">
          主要介绍可在安装目录旁的 customization/about.md 里随意改写。
        </p>
      </div>
      )}
    </aside>
  );
}
