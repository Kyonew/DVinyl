/**
 * The small Markdown subset the collection info page is written in, rendered to HTML
 * on the server (core/routes/collectionInfoRoute.ts, routes/adminRoutes.ts preview).
 *
 * Hand-written rather than pulled from a library because of what it must guarantee:
 * the text comes from a collection admin and is read by anyone holding a share link,
 * so nothing the author types may ever reach the page as markup. Every character is
 * HTML-escaped first and the tags below are the only ones this file ever emits, which
 * makes the output safe by construction instead of by a sanitizer pass afterwards.
 *
 * Supported: headings, paragraphs, bold, italic, strikethrough, inline code, fenced
 * code blocks, links, unordered and ordered lists, blockquotes and horizontal rules.
 * Anything else is shown as the literal text that was typed.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/** Text made safe to print as HTML. Any value: null and undefined print nothing, as `<%=` does. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, char => HTML_ESCAPES[char] as string);
}

/**
 * The address of a link, or null when it is not one of the three shapes worth linking:
 * an absolute http(s) address, a mail address, or a path inside this instance. Anything
 * else (javascript:, data:, protocol-relative //host) loses its link and keeps its text.
 * That includes /\host: browsers read a backslash as a slash in a web address, so it
 * would leave the instance exactly like //host does.
 *
 * The value arrives already HTML-escaped, so a quote inside it cannot close the
 * attribute this ends up in.
 */
function safeHref(url: string): string | null {
  const href = url.trim();
  if (!href) return null;
  if (/^https?:\/\/[^/\s]/i.test(href)) return href;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(href)) return href;
  if (/^\/(?![/\\])/.test(href)) return href;
  return null;
}

/** A link to `url` reading `label` (the address itself when empty), or null when the address is not safe. */
function linkHtml(label: string, url: string, className = ''): string | null {
  const href = safeHref(url);
  if (!href) return null;
  const text = label.trim() || href;
  const external = /^https?:/i.test(href);
  const attributes = (className ? ` class="${className}"` : '') + (external ? ' target="_blank" rel="noopener noreferrer"' : '');
  return `<a href="${href}"${attributes}>${text}</a>`;
}

// Marks where a code span was lifted out of a line: a control character, so no text
// the author can type ever collides with it.
const PLACEHOLDER = '\u0000';

/** Bold, italic, code, links: applied to one already-escaped line of text. */
function renderInline(text: string): string {
  // Code spans are pulled out first so the emphasis rules below never run inside one.
  const codeSpans: string[] = [];
  let html = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `${PLACEHOLDER}${codeSpans.length - 1}${PLACEHOLDER}`;
  });

  // An image written in Markdown becomes a plain link: the page has its own gallery for
  // pictures (the images stored alongside the text), and nothing here loads a remote
  // document on the reader's behalf.
  html = html.replace(/!?\[([^\]\n]*)\]\(([^)\s]+)\)/g, (match, label: string, url: string) => linkHtml(label, url) ?? match);

  html = html
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  return html.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'),
    (_match, index: string) => codeSpans[Number(index)] as string);
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;
const FENCE = /^```/;
const BULLET = /^[-*+]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;
// The text is escaped before it is parsed, so a blockquote marker has already become
// an entity by the time a line reaches this pattern.
const QUOTE = /^&gt;\s?(.*)$/;

/** Turns the stored Markdown into the HTML the info page and its preview display. */
export function renderMarkdown(source: unknown): string {
  if (typeof source !== 'string' || !source.trim()) return '';

  const lines = escapeHtml(source.replace(/\r\n?/g, '\n')).split('\n');
  const html: string[] = [];
  let index = 0;

  // Collects the run of lines the current block is made of, so a list or a paragraph
  // reads as far as it goes and the loop resumes on the line that ended it.
  const takeWhile = (matches: (line: string) => boolean): string[] => {
    const block: string[] = [];
    while (index < lines.length && matches(lines[index] as string)) {
      block.push(lines[index] as string);
      index += 1;
    }
    return block;
  };

  while (index < lines.length) {
    const line = lines[index] as string;
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (FENCE.test(trimmed)) {
      index += 1;
      const code = takeWhile(candidate => !FENCE.test(candidate.trim()));
      // A fence left unclosed still ends here, at the end of the text.
      if (index < lines.length) index += 1;
      html.push(`<pre><code>${code.join('\n')}</code></pre>`);
      continue;
    }

    if (RULE.test(trimmed)) {
      html.push('<hr>');
      index += 1;
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      const level = (heading[1] as string).length;
      html.push(`<h${level}>${renderInline((heading[2] as string).trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (QUOTE.test(trimmed)) {
      const quoted = takeWhile(candidate => QUOTE.test(candidate.trim()))
        .map(candidate => (QUOTE.exec(candidate.trim()) as RegExpExecArray)[1] as string);
      html.push(`<blockquote><p>${renderInline(quoted.join('\n')).replace(/\n/g, '<br>')}</p></blockquote>`);
      continue;
    }

    for (const [pattern, tag] of [[BULLET, 'ul'], [NUMBERED, 'ol']] as const) {
      if (!pattern.test(trimmed)) continue;
      const items = takeWhile(candidate => pattern.test(candidate.trim()))
        .map(candidate => (pattern.exec(candidate.trim()) as RegExpExecArray)[1] as string);
      html.push(`<${tag}>${items.map(item => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`);
      break;
    }
    // The list above consumed its lines; anything left on this turn is a paragraph.
    if (BULLET.test(trimmed) || NUMBERED.test(trimmed)) continue;

    const paragraph = takeWhile(candidate => {
      const value = candidate.trim();
      return Boolean(value)
        && !RULE.test(value) && !FENCE.test(value) && !HEADING.test(value)
        && !QUOTE.test(value) && !BULLET.test(value) && !NUMBERED.test(value);
    });
    // A single newline inside a paragraph is a line break, which is what somebody
    // writing an address or a few short lines in a text box expects it to be.
    html.push(`<p>${renderInline(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }

  return html.join('\n');
}

// A bare web address in already-escaped text: it stops at a space and at an escaped
// quote or angle bracket, which never belong to the address it follows.
const BARE_URL = /https?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)\S)+/gi;
// Visible in either theme, and broken anywhere so a long address never widens a card.
const LINK_CLASS = 'text-primary-theme underline underline-offset-2 break-all';
const MARKDOWN_LINK = /\[([^\]\n]*)\]\(([^)\s]+)\)/g;

/**
 * A field's plain text with its links made clickable, and nothing else: the item page
 * shows a text field or a note as typed, so no other Markdown applies. A web address on
 * its own and a [label](address) both become a link; the text is escaped first, so the
 * links built here are the only markup it can ever carry.
 */
export function renderLinks(source: unknown): string {
  if (source === null || source === undefined) return '';
  const text = escapeHtml(String(source));
  const pattern = new RegExp(`${MARKDOWN_LINK.source}|${BARE_URL.source}`, 'gi');
  return text.replace(pattern, (match: string, label?: string, url?: string) => {
    if (url !== undefined) return linkHtml(label ?? '', url, LINK_CLASS) ?? match;
    // The sentence the address ends goes on after it, outside the link. A closing
    // bracket stays when the address opened one (a Wikipedia page "Foo_(bar)"), and an
    // escaped ampersand keeps its semicolon.
    let address = match;
    for (;;) {
      const last = address.slice(-1);
      if (/[.,:!?\]]/.test(last) || (last === ';' && !/&(amp|quot|#39|lt|gt);$/.test(address))) address = address.slice(0, -1);
      else if (last === ')' && (address.match(/\(/g) || []).length < (address.match(/\)/g) || []).length) address = address.slice(0, -1);
      else break;
    }
    const link = linkHtml('', address, LINK_CLASS);
    return link ? link + match.slice(address.length) : match;
  });
}
