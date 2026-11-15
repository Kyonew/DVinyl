/**
 * Writing a large JSON document a piece at a time.
 *
 * A backup used to be built as one string, then copied into one buffer, both as large as
 * the file: on a big collection that is hundreds of megabytes held at once, enough to
 * stop the process on a small host. Here the long lists of a document are read from
 * iterators and written one record after another, so only one record's text is held at
 * a time. The text is the very one JSON.stringify(document, null, 2) gives, byte for byte,
 * so a backup reads the same however it was written.
 */

import { Readable } from 'stream';

/** A list given as the records themselves, or as a way to go through them. */
export type Records = any[] | (() => AsyncIterable<any>);

/** A document whose top-level values may be lists given as Records functions. */
export type StreamedDocument = Record<string, unknown>;

export async function* eachRecord(records: Records): AsyncGenerator<any> {
  if (Array.isArray(records)) yield* records;
  else yield* records();
}

// JSON.stringify(value, null, 2) for a value sitting `depth` levels deep, as the whole
// document would print it there: every line after the first carries that level's indent.
function nested(value: unknown, depth: number): string | undefined {
  const text = JSON.stringify(value, null, 2);
  if (text === undefined) return undefined;
  return depth === 0 ? text : text.replace(/\n/g, `\n${'  '.repeat(depth)}`);
}

// What JSON.stringify skips in an object: an undefined value, a function, a symbol.
const skipped = (value: unknown) => value === undefined || typeof value === 'function' || typeof value === 'symbol';

/**
 * The document's text, in pieces. A top-level value that is a function is read as a list
 * whose records it gives (see Records); every other value is written as JSON.stringify
 * would write it.
 */
export async function* jsonPieces(document: StreamedDocument): AsyncGenerator<string> {
  const entries = Object.entries(document).filter(([, value]) => typeof value === 'function' || !skipped(value));
  if (entries.length === 0) {
    yield '{}';
    return;
  }
  yield '{';
  for (const [index, [key, value]] of entries.entries()) {
    yield `${index === 0 ? '' : ','}\n  ${JSON.stringify(key)}: `;
    if (typeof value !== 'function') {
      yield nested(value, 1)!;
      continue;
    }
    let first = true;
    for await (const record of eachRecord(value as () => AsyncIterable<any>)) {
      // Inside a list, what JSON.stringify cannot write is written as null.
      yield `${first ? '[' : ','}\n    ${nested(record, 2) ?? 'null'}`;
      first = false;
    }
    yield first ? '[]' : '\n  ]';
  }
  yield '\n}';
}

/**
 * jsonPieces() as a byte stream (UTF-8), in chunks of about `size` characters. Bytes, not
 * text: a ZIP entry counts its size off the chunks, and an accented letter is one
 * character but two bytes.
 */
export function jsonStream(document: StreamedDocument, size = 64 * 1024): Readable {
  return Readable.from((async function* () {
    let pending = '';
    for await (const piece of jsonPieces(document)) {
      pending += piece;
      if (pending.length >= size) {
        yield Buffer.from(pending, 'utf8');
        pending = '';
      }
    }
    if (pending) yield Buffer.from(pending, 'utf8');
  })(), { objectMode: false });
}
