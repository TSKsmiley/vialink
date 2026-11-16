// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inline, renderMarkdown, slug, titleOf } from "./markdown.ts";

describe("docs Markdown renderer", () => {
  it("gives headings GitHub's ids", () => {
    expect(slug("The context (ctx)")).toBe("the-context-ctx");
    expect(slug("Public API (*.api.ts)")).toBe("public-api-apits");
    expect(slug("Manifest: dependencies, services, conflicts")).toBe(
      "manifest-dependencies-services-conflicts",
    );
    expect(renderMarkdown("### The context (`ctx`)")).toBe(
      '<h3 id="the-context-ctx">The context (<code>ctx</code>)</h3>',
    );
  });

  it("renders inline code, bold and links, and escapes HTML", () => {
    expect(inline("**Core** in `a<b>.ts`, see [x](#y) <script>")).toBe(
      '<strong>Core</strong> in <code>a&lt;b&gt;.ts</code>, see <a href="#y">x</a> &lt;script&gt;',
    );
    expect(inline("`**not bold**`")).toBe("<code>**not bold**</code>");
    expect(inline("[site](https://example.com)")).toBe(
      '<a href="https://example.com" rel="noreferrer">site</a>',
    );
  });

  it("joins paragraph lines and keeps code blocks as written", () => {
    expect(renderMarkdown("one\ntwo\n\n```ts\nconst a = 1 < 2;\n  x\n```")).toBe(
      '<p>one two</p>\n<pre><code class="language-ts">const a = 1 &lt; 2;\n  x</code></pre>',
    );
  });

  it("renders nested lists, continuation lines and task items", () => {
    const md = ["- a", "  more", "  - b", "- [ ] c", "      d", "", "1. one", "2. two"].join("\n");
    expect(renderMarkdown(md)).toBe(
      '<ul><li>a more<ul><li>b</li></ul></li><li><input type="checkbox" disabled> c d</li></ul>\n' +
        "<ol><li>one</li><li>two</li></ol>",
    );
  });

  it("renders tables", () => {
    expect(renderMarkdown("| A | `B` |\n| --- | --- |\n| 1 | 2 |")).toBe(
      '<div class="table"><table><thead><tr><th>A</th><th><code>B</code></th></tr></thead>' +
        "<tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>",
    );
  });

  it("renders the extension guide with every in-page link pointing at a heading", () => {
    const md = readFileSync(resolve(process.cwd(), "docs/extensions.md"), "utf8");
    const html = renderMarkdown(md);
    expect(titleOf(md)).toBe("Writing a ViaLink extension");
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    const links = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(10);
    for (const link of links) expect(ids, link).toContain(link);
    expect(html.replace(/<pre>[\s\S]*?<\/pre>/g, "")).not.toMatch(/```|\*\*/);
  });
});
