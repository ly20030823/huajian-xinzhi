import { useCallback, useEffect, useMemo, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  Separator,
  StrikeThroughSupSubToggles,
  codeBlockPlugin,
  codeMirrorPlugin,
  frontmatterPlugin,
  headingsPlugin,
  imagePlugin,
  linkPlugin,
  linkDialogPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  searchPlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type MDXEditorMethods,
  type ImageUploadHandler,
  type CodeBlockEditorDescriptor,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { resolveMarkdownImageSrc } from "./imageSrc";
import { resetInlineFormattingOnEnterPlugin } from "./resetInlineFormattingOnEnter";
import { countSelectedCharacters, type EditorSelectionStats } from "./editorStats";
import { createEditorTranslation } from "./editorTranslation";
import {
  prepareMarkdownForContentEditor,
  restoreMarkdownFromContentEditor,
} from "./contentEditorMarkdown";
import { MermaidCodeBlockEditor } from "./MermaidCodeBlockEditor";
import { SmartCodeBlockEditor } from "./SmartCodeBlockEditor";
import { CODE_BLOCK_LANGUAGES } from "./codeBlockLanguages";
import { EditorFindReplace } from "./EditorFindReplace";
import { RootUndoRedo } from "./RootUndoRedo";
import { TableInteractionLayer } from "./TableInteractionLayer";
import { tableColumnReorderPlugin } from "./tableColumnReorder";
import { findVerticalScrollContainer, scrollElementWithinContainer } from "./scrollWithinContainer";

const mermaidCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  priority: 100,
  match: (language) => language?.toLowerCase() === "mermaid",
  Editor: MermaidCodeBlockEditor,
};

const smartCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  priority: 50,
  match: (language) => language?.toLowerCase() !== "mermaid",
  Editor: SmartCodeBlockEditor,
};

interface MarkdownContentEditorProps {
  content: string;
  fontSize?: number;
  imageBaseDir?: string;
  disabled?: boolean;
  placeholder?: string;
  onChange: (markdown: string) => void;
  onSelectionChange?: (stats: EditorSelectionStats) => void;
  onError?: (message: string) => void;
  imageUploadHandler?: ImageUploadHandler;
  editorRef?: React.RefObject<MDXEditorMethods | null>;
}

export function MarkdownContentEditor({
  content,
  fontSize = 14,
  imageBaseDir,
  disabled = false,
  placeholder,
  onChange,
  onSelectionChange,
  onError,
  imageUploadHandler,
  editorRef,
}: MarkdownContentEditorProps) {
  const { i18n } = useTranslation();
  const internalRef = useRef<MDXEditorMethods>(null);
  const resolvedRef = editorRef ?? internalRef;
  const preparedContent = useMemo(() => prepareMarkdownForContentEditor(content), [content]);
  const lastEditorValue = useRef(preparedContent);
  const containerRef = useRef<HTMLDivElement>(null);

  const reportSelection = useCallback(() => {
    if (!onSelectionChange) return;
    const selection = document.getSelection();
    const root = containerRef.current?.querySelector<HTMLElement>(
      ".markdown-content-editor__content",
    );
    if (!root || !selection?.anchorNode || !root.contains(selection.anchorNode)) return;

    const blockSelector = "h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,table,hr";
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(blockSelector)).filter(
      (block) => !block.querySelector(blockSelector),
    );
    const anchorElement =
      selection.anchorNode instanceof HTMLElement
        ? selection.anchorNode
        : selection.anchorNode.parentElement;
    const currentBlock = blocks.find((block) => block.contains(anchorElement)) ?? null;
    const blockIndex = currentBlock ? blocks.indexOf(currentBlock) : 0;
    const linesBefore = blocks.slice(0, Math.max(0, blockIndex)).reduce((total, block) => {
      return total + Math.max(1, block.innerText.split("\n").length);
    }, 0);

    let lineInsideBlock = 1;
    if (currentBlock) {
      try {
        const range = document.createRange();
        range.selectNodeContents(currentBlock);
        range.setEnd(selection.anchorNode, selection.anchorOffset);
        lineInsideBlock = Math.max(1, range.toString().split("\n").length);
      } catch {
        lineInsideBlock = 1;
      }
    }

    onSelectionChange({
      currentLine: Math.max(1, linesBefore + lineInsideBlock),
      selectedChars: countSelectedCharacters(selection.toString()),
    });
  }, [onSelectionChange]);

  const handleLinkClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if ((!event.ctrlKey && !event.metaKey) || event.button !== 0) return;

      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest<HTMLAnchorElement>("a[href]");
      const editorContent = link?.closest(".markdown-content-editor__content");
      if (!link || !editorContent || !containerRef.current?.contains(editorContent)) return;

      const href = link.getAttribute("href")?.trim();
      if (!href) return;

      event.preventDefault();
      event.stopPropagation();

      if (href.startsWith("#")) {
        let id = href.slice(1);
        try {
          id = decodeURIComponent(id);
        } catch {
          // Keep the literal fragment when it contains malformed percent escapes.
        }
        const anchorTarget = containerRef.current.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
        if (anchorTarget) {
          const scrollContainer = findVerticalScrollContainer(anchorTarget, containerRef.current);
          if (scrollContainer) {
            scrollElementWithinContainer(anchorTarget, scrollContainer, {
              behavior: "smooth",
              block: "center",
            });
          }
        }
        return;
      }

      const externalUrl = href.startsWith("//")
        ? `https:${href}`
        : /^www\./i.test(href)
          ? `https://${href}`
          : href;
      if (!/^(https?:|mailto:|tel:)/i.test(externalUrl)) return;

      void openUrl(externalUrl).catch((error: unknown) => {
        onError?.(error instanceof Error ? error.message : String(error));
      });
    },
    [onError],
  );

  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      frontmatterPlugin(),
      tablePlugin(),
      tableColumnReorderPlugin(),
      imagePlugin({
        disableImageResize: false,
        disableImageSettingsButton: true,
        imageUploadHandler,
        imagePreviewHandler: async (src) =>
          resolveMarkdownImageSrc(src, imageBaseDir, convertFileSrc),
      }),
      codeBlockPlugin({
        defaultCodeBlockLanguage: "text",
        codeBlockEditorDescriptors: [mermaidCodeBlockDescriptor, smartCodeBlockDescriptor],
      }),
      codeMirrorPlugin({
        codeBlockLanguages: CODE_BLOCK_LANGUAGES,
      }),
      toolbarPlugin({
        toolbarClassName: "markdown-content-editor__toolbar",
        toolbarContents: () => (
          <>
            <RootUndoRedo />
            <Separator />
            <BlockTypeSelect />
            <BoldItalicUnderlineToggles />
            <StrikeThroughSupSubToggles options={["Strikethrough"]} />
            <CodeToggle />
            <Separator />
            <CreateLink />
            <InsertImage />
            <InsertTable />
            <Separator />
            <ListsToggle />
            <InsertThematicBreak />
            <InsertCodeBlock />
            <EditorFindReplace />
          </>
        ),
      }),
      markdownShortcutPlugin(),
      resetInlineFormattingOnEnterPlugin(),
      searchPlugin(),
    ],
    [imageBaseDir, imageUploadHandler],
  );

  const editorTranslation = useMemo(
    () => createEditorTranslation(i18n.resolvedLanguage ?? i18n.language),
    [i18n.language, i18n.resolvedLanguage],
  );

  useEffect(() => {
    if (preparedContent === lastEditorValue.current) return;
    lastEditorValue.current = preparedContent;
    resolvedRef.current?.setMarkdown(preparedContent);
  }, [preparedContent, resolvedRef]);

  useEffect(() => {
    if (!onSelectionChange) return undefined;
    document.addEventListener("selectionchange", reportSelection);
    return () => document.removeEventListener("selectionchange", reportSelection);
  }, [onSelectionChange, reportSelection]);

  return (
    <div
      ref={containerRef}
      className="markdown-content-editor h-full"
      style={{ "--content-editor-font-size": `${fontSize}px` } as React.CSSProperties}
      onClickCapture={handleLinkClick}
    >
      <MDXEditor
        ref={resolvedRef}
        markdown={preparedContent}
        plugins={plugins}
        readOnly={disabled}
        spellCheck={false}
        trim={false}
        className="markdown-content-editor__root"
        contentEditableClassName="markdown-content-editor__content"
        placeholder={placeholder}
        translation={editorTranslation}
        onChange={(markdown, initialMarkdownNormalize) => {
          if (initialMarkdownNormalize) return;
          lastEditorValue.current = markdown;
          onChange(restoreMarkdownFromContentEditor(markdown));
        }}
        onError={({ error }) => onError?.(error)}
      />
      <TableInteractionLayer containerRef={containerRef} disabled={disabled} />
    </div>
  );
}
