import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type RenderState =
  | { status: "loading"; svg: ""; error: "" }
  | { status: "ready"; svg: string; error: "" }
  | { status: "error"; svg: ""; error: string };

let mermaidConfigured = false;

async function loadMermaid() {
  const { default: mermaid } = await import("mermaid");
  if (!mermaidConfigured) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: {
        background: "transparent",
        primaryColor: "#eef4ff",
        primaryBorderColor: "#89a9ed",
        primaryTextColor: "#303744",
        secondaryColor: "#f7f4ed",
        secondaryBorderColor: "#c6bfae",
        tertiaryColor: "#ffffff",
        tertiaryBorderColor: "#d9dee8",
        lineColor: "#718096",
        textColor: "#303744",
        fontFamily: "HarmonyOS Sans SC, Microsoft YaHei, sans-serif",
      },
      flowchart: {
        htmlLabels: true,
        curve: "basis",
      },
    });
    mermaidConfigured = true;
  }
  return mermaid;
}

function conciseMermaidError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, "").split("\n")[0]?.trim() || "Unknown error";
}

interface MermaidDiagramProps {
  code: string;
}

interface DiagramSize {
  width: number;
  height: number;
}

const MIN_DIAGRAM_SCALE = 0.5;
const MAX_DIAGRAM_SCALE = 2.5;
const DIAGRAM_SCALE_STEP = 0.1;

export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const { t } = useTranslation();
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const renderNonce = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [baseSize, setBaseSize] = useState<DiagramSize | null>(null);
  const [renderState, setRenderState] = useState<RenderState>({
    status: "loading",
    svg: "",
    error: "",
  });

  useEffect(() => {
    const source = code.trim();
    let cancelled = false;
    const nonce = ++renderNonce.current;

    if (!source) {
      setRenderState({ status: "error", svg: "", error: "empty" });
      return undefined;
    }

    setRenderState({ status: "loading", svg: "", error: "" });
    const timer = window.setTimeout(() => {
      void loadMermaid()
        .then((mermaid) => mermaid.render(`floral-mermaid-${reactId}-${nonce}`, source))
        .then(({ svg }) => {
          if (!cancelled && nonce === renderNonce.current) {
            setRenderState({ status: "ready", svg, error: "" });
          }
        })
        .catch((error: unknown) => {
          if (!cancelled && nonce === renderNonce.current) {
            setRenderState({ status: "error", svg: "", error: conciseMermaidError(error) });
          }
        });
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, reactId]);

  const measureDiagram = useCallback(() => {
    const viewport = viewportRef.current;
    const svg = stageRef.current?.querySelector<SVGSVGElement>("svg");
    if (!viewport || !svg) return;

    const viewBox = svg.viewBox.baseVal;
    if (!viewBox.width || !viewBox.height) return;
    const availableWidth = Math.max(220, viewport.clientWidth - 32);
    const width = Math.min(viewBox.width, availableWidth);
    setBaseSize({ width, height: (width * viewBox.height) / viewBox.width });
  }, []);

  useLayoutEffect(() => {
    if (renderState.status !== "ready") return undefined;
    measureDiagram();
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measureDiagram);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [measureDiagram, renderState.status, renderState.svg]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const direction = event.deltaY < 0 ? DIAGRAM_SCALE_STEP : -DIAGRAM_SCALE_STEP;
      setScale((current) =>
        Math.min(MAX_DIAGRAM_SCALE, Math.max(MIN_DIAGRAM_SCALE, current + direction)),
      );
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [renderState.status]);

  if (renderState.status === "loading") {
    return (
      <div className="mermaid-diagram-state" role="status">
        {t("markdown.mermaid.rendering", { defaultValue: "正在绘制流程图…" })}
      </div>
    );
  }

  if (renderState.status === "error") {
    return (
      <div className="mermaid-diagram-error" role="alert">
        <span>{t("markdown.mermaid.invalid", { defaultValue: "流程图语法暂时无法渲染" })}</span>
        {renderState.error !== "empty" && <small>{renderState.error}</small>}
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className="mermaid-diagram-viewport"
      title={t("markdown.mermaid.zoomHint", {
        defaultValue: "按住 Ctrl 并滚动滚轮可单独缩放流程图",
      })}
    >
      <div
        ref={stageRef}
        className="mermaid-diagram-canvas"
        role="img"
        aria-label={t("markdown.mermaid.diagram", { defaultValue: "Mermaid 流程图" })}
        style={
          baseSize
            ? {
                width: `${baseSize.width * scale}px`,
                height: `${baseSize.height * scale}px`,
              }
            : undefined
        }
        dangerouslySetInnerHTML={{ __html: renderState.svg }}
      />
      {Math.abs(scale - 1) > 0.001 && (
        <div className="markdown-zoom-badge mermaid-zoom-badge">
          <span>
            {t("markdown.mermaid.zoom", {
              percent: Math.round(scale * 100),
              defaultValue: "流程图 {{percent}}%",
            })}
          </span>
          <button type="button" onClick={() => setScale(1)}>
            {t("common.reset", { defaultValue: "恢复默认" })}
          </button>
        </div>
      )}
    </div>
  );
}
