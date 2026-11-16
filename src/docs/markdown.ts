// SPDX-License-Identifier: GPL-2.0-or-later
// A small Markdown to HTML renderer for the docs pages on the website (vite.config.ts renders
// docs/*.md into their HTML pages at build time). It covers what ViaLink's docs use: headings
// with GitHub-style ids, paragraphs, nested bullet and numbered lists, task list items, tables,
// fenced code blocks, inline code, bold and links. Raw HTML in the Markdown is escaped, not
// passed through. Pure: no DOM, runs under Node.

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The id GitHub gives a heading, so "#the-context-ctx" links work on both. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Inline Markdown: code spans, links and bold. */
export function inline(text: string): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(`<code>${escape(code)}</code>`);
    return `\uE000${codes.length - 1}\uE000`;
  });
  s = escape(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
    const external = /^https?:/.test(href);
    return `<a href="${href}"${external ? ' rel="noreferrer"' : ""}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Code spans last, so their contents stay as written.
  return s.replace(/\uE000(\d+)\uE000/g, (_, i: string) => codes[Number(i)]);
}

/** Text for a heading's id: Markdown syntax removed. */
const plain = (text: string) => text.replace(/`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

const indentOf = (line: string) => line.length - line.trimStart().length;
const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const isFence = (line: string) => line.trimStart().startsWith("```");
const isTableRow = (line: string) => line.trimStart().startsWith("|");
const isHeading = (line: string) => /^#{1,6}\s/.test(line);

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function listItem(text: string): string {
  const task = /^\[( |x)\]\s+(.*)$/i.exec(text);
  if (!task) return inline(text);
  const checked = task[1] !== " " ? " checked" : "";
  return `<input type="checkbox" disabled${checked}> ${inline(task[2])}`;
}

/** Parses the list starting at `lines[start]`; returns its HTML and the index after it. */
function list(lines: readonly string[], start: number): { html: string; next: number } {
  const first = LIST_ITEM.exec(lines[start])!;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i]);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    let text = m[3];
    let nested = "";
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        // A blank line ends the list unless an item of this list or a deeper line follows.
        const after = lines[i + 1] ?? "";
        const next = LIST_ITEM.exec(after);
        const sameList = !!next && next[1].length === indent && /\d/.test(next[2]) === ordered;
        if (after.trim() !== "" && (sameList || indentOf(after) > indent)) {
          i++;
          continue;
        }
        break;
      }
      if (indentOf(line) <= indent) break;
      if (LIST_ITEM.test(line)) {
        const sub = list(lines, i);
        nested += sub.html;
        i = sub.next;
      } else {
        text += " " + line.trim();
        i++;
      }
    }
    items.push(`<li>${listItem(text)}${nested}</li>`);
  }
  const tag = ordered ? "ol" : "ul";
  return { html: `<${tag}>${items.join("")}</${tag}>`, next: i };
}

/** Renders a Markdown document to HTML. */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
    } else if (isFence(line)) {
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) body.push(lines[i++]);
      i++; // the closing fence
      const cls = lang ? ` class="language-${escape(lang)}"` : "";
      out.push(`<pre><code${cls}>${escape(body.join("\n"))}</code></pre>`);
    } else if (isHeading(line)) {
      const m = /^(#{1,6})\s+(.*)$/.exec(line)!;
      const level = m[1].length;
      out.push(`<h${level} id="${slug(plain(m[2]))}">${inline(m[2])}</h${level}>`);
      i++;
    } else if (isTableRow(line) && i + 1 < lines.length && /^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        `<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
      );
    } else if (LIST_ITEM.test(line)) {
      const { html, next } = list(lines, i);
      out.push(html);
      i = next;
    } else {
      const text: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !isFence(lines[i]) &&
        !isHeading(lines[i]) &&
        !isTableRow(lines[i]) &&
        !LIST_ITEM.test(lines[i])
      ) {
        text.push(lines[i++].trim());
      }
      out.push(`<p>${inline(text.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}

/** The first level-1 heading's text, for the page title. */
export function titleOf(source: string): string | null {
  const m = /^#\s+(.*)$/m.exec(source);
  return m ? plain(m[1]) : null;
}
