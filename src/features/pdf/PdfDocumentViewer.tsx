import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs, type DocumentProps } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { getPdfBytes } from "../importExport/documentImport";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PdfDocumentViewerProps {
  noteId: string;
  title: string;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

export function PdfDocumentViewer({ noteId, title }: PdfDocumentViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const [data, setData] = useState<Uint8Array | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [continuous, setContinuous] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState<"width" | "page">("width");
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [pageRatio, setPageRatio] = useState(0.707);
  const [query, setQuery] = useState("");
  const [pageTexts, setPageTexts] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    void getPdfBytes(noteId)
      .then((bytes) => { if (!cancelled) setData(bytes); })
      .catch((reason) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [noteId]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const matchingPages = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return pageTexts.flatMap((text, index) =>
      text.toLocaleLowerCase().includes(needle) ? [index + 1] : [],
    );
  }, [pageTexts, query]);

  const baseWidth = Math.max(320, containerSize.width - 64);
  const pageFitWidth = Math.max(280, (containerSize.height - 96) * pageRatio);
  const renderedWidth = (fitMode === "page" ? Math.min(baseWidth, pageFitWidth) : baseWidth) * zoom;
  const pages = continuous
    ? Array.from({ length: numPages }, (_, index) => index + 1)
    : [Math.min(pageNumber, Math.max(1, numPages))];

  const jumpToPage = (nextPage: number) => {
    const normalized = Math.min(Math.max(1, nextPage), Math.max(1, numPages));
    setPageNumber(normalized);
    pageRefs.current.get(normalized)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onLoadSuccess: DocumentProps["onLoadSuccess"] = async (pdf) => {
    setNumPages(pdf.numPages);
    const firstPage = await pdf.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1 });
    setPageRatio(viewport.width / viewport.height);
    const texts = await Promise.all(
      Array.from({ length: pdf.numPages }, async (_, index) => {
        const page = await pdf.getPage(index + 1);
        const content = await page.getTextContent();
        return content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
      }),
    );
    setPageTexts(texts);
  };

  const renderText = ({ str }: { str: string }) => {
    const needle = query.trim();
    if (!needle) return escapeHtml(str);
    const escaped = escapeHtml(str);
    const pattern = new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return escaped.replace(pattern, '<mark class="pdf-search-hit">$1</mark>');
  };

  return (
    <div ref={rootRef} className="pdf-viewer flex h-full min-h-0 flex-col bg-paper-warm/35">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-paper-deep/40 bg-cloud/90 px-4 text-[11px] text-ink-faint">
        <button onClick={() => jumpToPage(pageNumber - 1)} disabled={pageNumber <= 1}>上一页</button>
        <input
          aria-label="当前页码"
          className="w-12 rounded border border-paper-deep bg-cloud px-1.5 py-1 text-center"
          type="number" min={1} max={numPages || 1} value={pageNumber}
          onChange={(event) => jumpToPage(Number(event.target.value) || 1)}
        />
        <span>/ {numPages || "--"}</span>
        <button onClick={() => jumpToPage(pageNumber + 1)} disabled={pageNumber >= numPages}>下一页</button>
        <span className="mx-1 h-4 w-px bg-paper-deep" />
        <button onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}>−</button>
        <span className="w-11 text-center font-mono">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((value) => Math.min(3, value + 0.1))}>＋</button>
        <button onClick={() => { setZoom(1); setFitMode("width"); }}>适合宽度</button>
        <button onClick={() => { setZoom(1); setFitMode("page"); }}>适合页面</button>
        <button onClick={() => setContinuous((value) => !value)}>{continuous ? "连续滚动" : "单页模式"}</button>
        <div className="ml-auto flex items-center gap-1.5">
          <input
            className="w-40 rounded-lg border border-paper-deep bg-cloud px-2 py-1"
            value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 PDF…"
          />
          <span className="min-w-12 text-ink-ghost">{query ? `${matchingPages.length} 页` : ""}</span>
          {matchingPages[0] ? <button onClick={() => jumpToPage(matchingPages[0])}>定位</button> : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {error ? <div className="m-auto max-w-lg rounded-xl bg-danger-bg p-5 text-red-500">PDF 打开失败：{error}</div> : null}
        {!data && !error ? <div className="py-16 text-center text-ink-ghost">正在打开 PDF…</div> : null}
        {data ? (
          <Document file={{ data }} onLoadSuccess={onLoadSuccess} loading="正在解析 PDF…" error="无法解析这个 PDF 文件">
            <div className="flex flex-col items-center gap-5">
              {pages.map((page) => (
                <div
                  key={page}
                  ref={(element) => { if (element) pageRefs.current.set(page, element); }}
                  className="pdf-page-shell bg-white shadow-lg"
                  aria-label={`${title} 第 ${page} 页`}
                >
                  <Page
                    pageNumber={page} width={renderedWidth}
                    renderAnnotationLayer renderTextLayer
                    customTextRenderer={renderText}
                    onRenderSuccess={() => setPageNumber((current) => current || page)}
                  />
                </div>
              ))}
            </div>
          </Document>
        ) : null}
      </div>
    </div>
  );
}
