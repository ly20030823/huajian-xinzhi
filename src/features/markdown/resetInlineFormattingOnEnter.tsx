import { useEffect } from "react";
import { addComposerChild$, realmPlugin } from "@mdxeditor/editor";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createRangeSelection,
  $getSelection,
  $isLineBreakNode,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  type LexicalNode,
  type RangeSelection,
} from "lexical";
import { $isQuoteNode, type QuoteNode } from "@lexical/rich-text";

export function isCurrentQuoteLineEmpty(textBeforeCaret: string, textAfterCaret: string) {
  const beforeLines = textBeforeCaret.split(/\r?\n/);
  const currentLineBefore = beforeLines[beforeLines.length - 1] ?? "";
  const currentLineAfter = textAfterCaret.split(/\r?\n/, 1)[0] ?? "";
  return `${currentLineBefore}${currentLineAfter}`.trim().length === 0;
}

function getQuoteAncestor(selection: RangeSelection) {
  let node: LexicalNode | null = selection.anchor.getNode();
  while (node) {
    if ($isQuoteNode(node)) return node;
    node = node.getParent();
  }
  return null;
}

function getQuoteTextAroundCaret(selection: RangeSelection, quote: QuoteNode) {
  const before = $createRangeSelection();
  before.anchor.set(quote.getKey(), 0, "element");
  before.focus.set(selection.anchor.key, selection.anchor.offset, selection.anchor.type);

  const after = $createRangeSelection();
  after.anchor.set(selection.anchor.key, selection.anchor.offset, selection.anchor.type);
  after.focus.set(quote.getKey(), quote.getChildrenSize(), "element");

  return { before: before.getTextContent(), after: after.getTextContent() };
}

function exitQuote(quote: QuoteNode, textAfterCaret: string) {
  // Remove the line break that created the empty final quote line. This keeps
  // the saved Markdown as `> text` followed by a real blank separator line.
  if (textAfterCaret.length === 0) {
    const lastDescendant = quote.getLastDescendant();
    if ($isLineBreakNode(lastDescendant)) lastDescendant.remove();
  }

  const paragraph = $createParagraphNode();
  if (quote.getTextContent().trim().length === 0) {
    quote.replace(paragraph);
  } else {
    quote.insertAfter(paragraph);
  }
  paragraph.select();
}

function ResetInlineFormattingOnEnter() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event || event.shiftKey) return false;

          const selection = $getSelection();
          if ($isRangeSelection(selection) && selection.isCollapsed()) {
            const quote = getQuoteAncestor(selection);
            if (quote) {
              const quoteText = getQuoteTextAroundCaret(selection, quote);
              event.preventDefault();

              if (isCurrentQuoteLineEmpty(quoteText.before, quoteText.after)) {
                exitQuote(quote, quoteText.after);
              } else {
                selection.insertLineBreak(false);
                selection.setFormat(0);
                selection.setStyle("");
              }
              return true;
            }
          }

          // Let Lexical create the next paragraph/list item first, then make
          // newly typed text start without the previous line's inline style.
          queueMicrotask(() => {
            editor.update(() => {
              const selection = $getSelection();
              if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

              selection.setFormat(0);
              selection.setStyle("");
            });
          });

          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );

  return null;
}

export const resetInlineFormattingOnEnterPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, ResetInlineFormattingOnEnter);
  },
});
