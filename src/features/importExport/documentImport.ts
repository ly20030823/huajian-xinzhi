import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import mammoth from "mammoth";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import type { Note } from "../notes/types";

interface ImportedDocumentImage {
  dataBase64: string;
  extension: string;
  placeholder: string;
}

const documentFilters = [
  { name: "支持的文档", extensions: ["md", "markdown", "docx", "pdf"] },
  { name: "Word 文档", extensions: ["docx"] },
  { name: "PDF 文档", extensions: ["pdf"] },
  { name: "Markdown", extensions: ["md", "markdown"] },
];

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function extensionFromContentType(contentType: string) {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("jpeg")) return "jpg";
  if (normalized.includes("svg")) return "svg";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("bmp")) return "bmp";
  return "png";
}

function fileStem(path: string) {
  const name = path.split(/[\\/]/).pop() ?? "Word 文档";
  return name.replace(/\.docx$/i, "") || "Word 文档";
}

async function importDocx(path: string, category: string): Promise<Note> {
  const encoded = await invoke<string>("documents_read_file_base64", { path });
  const images: ImportedDocumentImage[] = [];
  const result = await mammoth.convertToHtml(
    { arrayBuffer: decodeBase64(encoded) },
    {
      styleMap: [
        "p[style-name='Code'] => pre:separator('\\n')",
        "p[style-name='Code Block'] => pre:separator('\\n')",
        "p[style-name='代码'] => pre:separator('\\n')",
      ],
      convertImage: mammoth.images.imgElement(async (image) => {
        const placeholder = `floral-docx-image://${images.length}`;
        images.push({
          dataBase64: await image.read("base64"),
          extension: extensionFromContentType(image.contentType),
          placeholder,
        });
        return { src: placeholder };
      }),
    },
  );

  const parsed = new DOMParser().parseFromString(result.value, "text/html");
  const title = parsed.querySelector("h1")?.textContent?.trim() || fileStem(path);
  const turndown = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  });
  turndown.use(gfm);
  turndown.addRule("wordMath", {
    filter: (node) => node.nodeName.toLowerCase() === "math",
    replacement: (_content, node) => {
      const text = node.textContent?.trim();
      return text ? `\n\n$$\n${text}\n$$\n\n` : "";
    },
  });
  let content = turndown.turndown(result.value).trim();
  const importantMessages = result.messages
    .map((message) => message.message.trim())
    .filter(Boolean);
  if (importantMessages.length > 0) {
    content += `\n\n> [!WARNING]\n> Word 导入时有 ${importantMessages.length} 项复杂内容未能完全还原，请对照原件检查。`;
  }

  return invoke("notes_import_docx", { path, category, title, content, images });
}

export async function importSupportedDocument(category = ""): Promise<Note | null> {
  const path = await open({ multiple: false, directory: false, filters: documentFilters });
  if (typeof path !== "string") return null;
  if (/\.pdf$/i.test(path)) return invoke("notes_import_pdf", { path, category });
  if (/\.docx$/i.test(path)) return importDocx(path, category);
  return invoke("notes_import_markdown", { path, category });
}

export function getOriginalWordPath(id: string): Promise<string> {
  return invoke("notes_original_word_path", { id });
}

export async function getPdfBytes(id: string): Promise<Uint8Array> {
  const encoded = await invoke<string>("notes_pdf_base64", { id });
  return new Uint8Array(decodeBase64(encoded));
}
