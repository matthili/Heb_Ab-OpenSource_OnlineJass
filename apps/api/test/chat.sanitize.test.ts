/**
 * XSS-Test-Suite für die Chat-Sanitization (Plan-Doc M8 „Done when:
 * XSS-Test-Suite grün").
 *
 * Wir testen typische Angriffsvektoren + den erwarteten Whitelist-
 * Verhalten der Markdown→HTML-Pipeline.
 */
import { describe, expect, it } from "vitest";

import { sanitizeChatMarkdown } from "../src/modules/chat/chat.sanitize.js";

describe("sanitizeChatMarkdown — Markdown-Pfad", () => {
  it("akzeptiert bold + italic + inline-code", () => {
    const out = sanitizeChatMarkdown("Hallo **fett** und *kursiv* und `code`!");
    expect(out).toContain("<strong>fett</strong>");
    expect(out).toContain("<em>kursiv</em>");
    expect(out).toContain("<code>code</code>");
  });

  it("erzeugt http/https-Links mit target+rel", () => {
    const out = sanitizeChatMarkdown("Schau [hier](https://example.com)!");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("ignoriert Headings, Listen und Code-Blöcke (Whitelist)", () => {
    const out = sanitizeChatMarkdown("# Big\n\n- item\n\n```\ncode\n```");
    expect(out).not.toContain("<h1");
    expect(out).not.toContain("<ul");
    expect(out).not.toContain("<pre");
  });

  it("hard-break: einfacher Zeilenumbruch wird <br>", () => {
    const out = sanitizeChatMarkdown("Zeile 1\nZeile 2");
    expect(out).toContain("<br>");
  });

  it("leerer/whitespace-Input ergibt leeren String", () => {
    expect(sanitizeChatMarkdown("")).toBe("");
    expect(sanitizeChatMarkdown("   \n\t  ")).toBe("");
  });
});

/**
 * **Was wir hier präzise testen**: kein **ausführbares** HTML-Element
 * entsteht. Ein roher Text wie `<script>alert(1)</script>` darf gerne
 * als entitied Text (`&lt;script&gt;…`) im Output landen — der ist
 * inert, wird vom Browser als Text gerendert, nicht ausgeführt. Wir
 * prüfen daher Tag-Patterns (`<script>` als Element), keine
 * Substring-Vorkommen.
 */
describe("sanitizeChatMarkdown — XSS-Schutz", () => {
  it("kein ausführbarer <script>-Tag aus Markdown-Input", () => {
    const out = sanitizeChatMarkdown("Hi <script>alert(1)</script> there");
    expect(out).not.toMatch(/<script[\s>]/i);
    expect(out).not.toMatch(/<\/script>/i);
    // Text drum herum bleibt sichtbar.
    expect(out).toContain("Hi");
    expect(out).toContain("there");
  });

  it("javascript:-URL im Markdown-Link → kein href=javascript:", () => {
    const out = sanitizeChatMarkdown("Klick [hier](javascript:alert(1))");
    expect(out).not.toMatch(/href\s*=\s*["']?\s*javascript:/i);
  });

  it("data:-URL im Markdown-Link → kein href=data:", () => {
    const out = sanitizeChatMarkdown(
      "Klick [hier](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"
    );
    expect(out).not.toMatch(/href\s*=\s*["']?\s*data:/i);
  });

  it("vbscript:-URL → kein href=vbscript:", () => {
    const out = sanitizeChatMarkdown("[x](vbscript:msgbox(1))");
    expect(out).not.toMatch(/href\s*=\s*["']?\s*vbscript:/i);
  });

  it("Inline-HTML mit Event-Handler → kein <img-Tag mehr", () => {
    // Markdown-it mit html:false rendert das als entitied Text — kein
    // ausführbares <img> entsteht. Der Wort-Substring "onerror" bleibt
    // ggf. im Output (als Text), das ist inert.
    const out = sanitizeChatMarkdown("Bla <img src=x onerror=alert(1)> bla");
    expect(out).not.toMatch(/<img[\s>]/i);
  });

  it("Inline-<iframe> → kein iframe-Element", () => {
    const out = sanitizeChatMarkdown("Bla <iframe src='evil'></iframe>");
    expect(out).not.toMatch(/<iframe[\s>]/i);
  });

  it("encoded Entitäten expandieren NICHT zu Tags", () => {
    const out = sanitizeChatMarkdown("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).not.toMatch(/<script[\s>]/i);
  });
});
