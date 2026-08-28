import chroma from "chroma-js";
import { createRoot } from "react-dom/client";
import { MarkdownPreview } from "../markdown/MarkdownPreview";

interface PdfExportDocument {
  title: string;
  content: string;
  fontSize?: number;
  renderHtml?: boolean;
  imageBaseDir?: string;
}

const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const PAGE_MARGIN_MM = 14;
const DOCUMENT_WIDTH_PX = 794;
const MODERN_COLOR_FUNCTION_PATTERN = /okl(?:ab|ch)\([^)]*\)/gi;

export function normalizePdfColorFunctions(value: string): string {
  return value.replace(MODERN_COLOR_FUNCTION_PATTERN, (color) => {
    try {
      const [red, green, blue, alpha] = chroma(color).rgba();
      return `rgba(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}, ${Number(alpha.toFixed(4))})`;
    } catch {
      return color;
    }
  });
}

function sanitizePdfCloneColors(root: HTMLElement): void {
  const view = root.ownerDocument.defaultView;
  if (!view) return;

  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  elements.forEach((element) => {
    const computedStyle = view.getComputedStyle(element);
    for (const property of Array.from(computedStyle)) {
      const value = computedStyle.getPropertyValue(property);
      if (!/okl(?:ab|ch)\(/i.test(value)) continue;
      const normalized = normalizePdfColorFunctions(value);
      if (normalized !== value) {
        element.style.setProperty(property, normalized, "important");
      }
    }
  });

  // Tailwind 的 marker 透明色会生成 oklab()，而伪元素无法通过行内样式覆盖。
  const compatibilityStyle = root.ownerDocument.createElement("style");
  compatibilityStyle.textContent = `
    [data-pdf-export-surface] li::marker {
      color: rgba(37, 99, 235, 0.55) !important;
    }
  `;
  root.ownerDocument.head.appendChild(compatibilityStyle);
}

function waitForLayout(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function waitForImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  images.forEach((image) => {
    image.loading = "eager";
  });
  await Promise.all(
    images.map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 8000);
        const finish = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        image.addEventListener("load", finish, { once: true });
        image.addEventListener("error", finish, { once: true });
      });
    }),
  );
}

function collectPageBreaks(root: HTMLElement): number[] {
  const rootTop = root.getBoundingClientRect().top;
  return Array.from(
    root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,pre,blockquote,table,.markdown-alert"),
  )
    .map((element) => element.getBoundingClientRect().bottom - rootTop)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
}

function chooseSliceEnd(
  startCssPx: number,
  targetCssPx: number,
  documentHeightCssPx: number,
  pageBreaks: number[],
): number {
  if (targetCssPx >= documentHeightCssPx) return documentHeightCssPx;
  const minimumUsefulPage = startCssPx + (targetCssPx - startCssPx) * 0.72;
  const candidates = pageBreaks.filter(
    (value) => value >= minimumUsefulPage && value <= targetCssPx,
  );
  return candidates.length > 0 ? candidates[candidates.length - 1] : targetCssPx;
}

export async function renderMarkdownPdf(document: PdfExportDocument): Promise<string> {
  const host = window.document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-12000px",
    top: "0",
    width: `${DOCUMENT_WIDTH_PX}px`,
    background: "#ffffff",
    pointerEvents: "none",
    zIndex: "-1",
  });

  const surface = window.document.createElement("article");
  surface.dataset.pdfExportSurface = "true";
  Object.assign(surface.style, {
    boxSizing: "border-box",
    width: `${DOCUMENT_WIDTH_PX}px`,
    padding: "56px 64px 64px",
    background: "#ffffff",
    color: "#343541",
  });
  const pdfColors: Record<string, string> = {
    "--color-paper": "#ffffff",
    "--color-paper-warm": "#f4f5f6",
    "--color-paper-deep": "#e2e5e9",
    "--color-ink": "#202123",
    "--color-ink-soft": "#343541",
    "--color-ink-faint": "#6b7280",
    "--color-ink-ghost": "#9aa0a8",
    "--color-bamboo": "#2563eb",
    "--color-bamboo-light": "#3b82f6",
    "--color-bamboo-mist": "#eff6ff",
    "--color-bamboo-glow": "#dbeafe",
    "--color-cloud": "#ffffff",
  };
  Object.entries(pdfColors).forEach(([name, value]) => surface.style.setProperty(name, value));
  host.appendChild(surface);
  window.document.body.appendChild(host);

  const root = createRoot(surface);
  try {
    root.render(
      <>
        <header className="mb-7 border-b border-paper-deep/70 pb-5">
          <h1 className="m-0 text-[28px] font-display font-bold tracking-wide text-ink">
            {document.title}
          </h1>
        </header>
        <MarkdownPreview
          content={document.content}
          fontSize={document.fontSize ?? 14}
          renderHtml={document.renderHtml}
          imageBaseDir={document.imageBaseDir}
        />
      </>,
    );

    await waitForLayout();
    await window.document.fonts?.ready;
    await waitForImages(surface);
    await waitForLayout();

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
    const pageBreaks = collectPageBreaks(surface);
    const canvas = await html2canvas(surface, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: DOCUMENT_WIDTH_PX,
      windowHeight: Math.max(surface.scrollHeight, window.innerHeight),
      onclone: (_clonedDocument, clonedSurface) => {
        sanitizePdfCloneColors(clonedSurface);
      },
    });

    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    const printableWidthMm = PAGE_WIDTH_MM - PAGE_MARGIN_MM * 2;
    const printableHeightMm = PAGE_HEIGHT_MM - PAGE_MARGIN_MM * 2;
    const pxPerMm = canvas.width / printableWidthMm;
    const idealSliceHeightPx = printableHeightMm * pxPerMm;
    const canvasPerCssPx = canvas.width / surface.scrollWidth;
    let startCanvasPx = 0;
    let pageIndex = 0;

    while (startCanvasPx < canvas.height) {
      const startCssPx = startCanvasPx / canvasPerCssPx;
      const targetCssPx = (startCanvasPx + idealSliceHeightPx) / canvasPerCssPx;
      const endCssPx = chooseSliceEnd(startCssPx, targetCssPx, surface.scrollHeight, pageBreaks);
      let endCanvasPx = Math.min(canvas.height, Math.round(endCssPx * canvasPerCssPx));
      if (endCanvasPx <= startCanvasPx) {
        endCanvasPx = Math.min(canvas.height, Math.round(startCanvasPx + idealSliceHeightPx));
      }

      const sliceHeightPx = endCanvasPx - startCanvasPx;
      const pageCanvas = window.document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeightPx;
      const context = pageCanvas.getContext("2d");
      if (!context) throw new Error("PDF canvas is unavailable");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      context.drawImage(
        canvas,
        0,
        startCanvasPx,
        canvas.width,
        sliceHeightPx,
        0,
        0,
        canvas.width,
        sliceHeightPx,
      );

      if (pageIndex > 0) pdf.addPage();
      pdf.addImage(
        pageCanvas.toDataURL("image/jpeg", 0.94),
        "JPEG",
        PAGE_MARGIN_MM,
        PAGE_MARGIN_MM,
        printableWidthMm,
        sliceHeightPx / pxPerMm,
        undefined,
        "FAST",
      );

      startCanvasPx = endCanvasPx;
      pageIndex += 1;
    }

    const dataUri = pdf.output("datauristring");
    return dataUri.slice(dataUri.indexOf(",") + 1);
  } finally {
    root.unmount();
    host.remove();
  }
}
