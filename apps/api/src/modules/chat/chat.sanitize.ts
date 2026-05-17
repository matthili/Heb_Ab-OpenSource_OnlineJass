/**
 * Markdown → sicheres HTML.
 *
 * **Whitelist** (bewusst klein gehalten):
 *   - Inline: bold (**…**), italic (*…*), inline-code (`…`)
 *   - Links (`[text](url)`) — nur http/https-Schemata, `target="_blank"` +
 *     `rel="noopener noreferrer"` werden vom DOMPurify-Hook ergänzt.
 *   - Hard-Breaks: einfache Zeilenumbrüche
 * **Nicht erlaubt**: Headings, Listen, Blockquotes, Bilder, HTML-Tags
 * direkt, Tables, `javascript:`-URLs, alle Event-Handler-Attribute.
 *
 * `body` aus dem Client kommt als Roh-Markdown; was diese Funktion
 * zurückliefert, wird **so** in die DB geschrieben und an Clients
 * verteilt. Client zeigt es 1:1 (mit zweitem DOMPurify-Pass — siehe
 * Plan-Doc: „double-sanitize" als Defense-in-Depth).
 */
import DOMPurify from "isomorphic-dompurify";
import MarkdownIt from "markdown-it";

// Markdown-it ohne Bilder, HTML-Inline, Tables. Linkify aus (zu
// aggressiv für unsere kurzen Chats — Auto-Linking aus Plain-Text-URLs
// schalten wir manuell an, wenn User das wollen).
const md = new MarkdownIt({
  html: false, // kein HTML im Source
  linkify: false,
  typographer: true,
  breaks: true, // \n → <br>
})
  // Wir entfernen alle Block-Tokens außer paragraph/inline; damit
  // verschwinden Headings, Listen, Blockquotes, Code-Blocks (` ``` `).
  .disable([
    "heading",
    "lheading",
    "list",
    "blockquote",
    "fence",
    "table",
    "code", // 4-Leerzeichen-Indent-Code-Blocks
    "hr",
    "reference",
    "html_block",
    "image",
  ])
  // Inline gleichermaßen: nur emphasis (italic+bold), backticks
  // (inline-code), links. Alles andere weg.
  // Wir lassen die default-inline-Tokens und filtern bei der
  // Sanitization unten alle nicht-erlaubten HTML-Tags raus.
  .disable(["html_inline"]);

// DOMPurify-Whitelist — sehr eng. Tags müssen mit dem Markdown-it-
// Output zusammenpassen.
const ALLOWED_TAGS = ["p", "strong", "em", "code", "a", "br"];
const ALLOWED_ATTR = ["href", "title", "target", "rel"];

// Hook: für jeden <a>-Tag http/https erzwingen + target/rel anhängen.
// Der API-Workspace nutzt `tsconfig/node.json` ohne DOM-Lib — wir
// definieren ein schmales Strukturtyp-Interface statt globalem
// `HTMLAnchorElement`.
interface ElementLike {
  tagName: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

DOMPurify.addHook("afterSanitizeAttributes", (rawNode) => {
  const node = rawNode as unknown as ElementLike;
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) {
      node.removeAttribute("href");
    } else {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  }
});

/**
 * Konvertiert Markdown zu sicheren HTML. Bewusst nicht throwing — bei
 * leerem Input gibt's einen leeren String zurück.
 */
export function sanitizeChatMarkdown(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const rendered = md.render(trimmed);
  const cleaned = DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    KEEP_CONTENT: true, // <script>foo</script> → "foo" statt komplett weg
  });
  return cleaned.trim();
}
