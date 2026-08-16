import mongoose from 'mongoose';
import { PluginDefinition, SearchResult } from './types';
import { escapeRegExp, parseCsvRecords, syncStamp } from './helpers';

/**
 * Generic engine behind the CSV importers declared by plugins (Libib & co.).
 *
 * The core stays agnostic: it owns the plumbing every CSV import repeats (parse,
 * row filtering, duplicate check, socket progress, optional enrichment through the
 * plugin's own search provider), while the plugin only says how one row becomes one
 * item of its own kind.
 */

export type CsvRow = Record<string, string>;

export interface CsvImportContext {
  userId: any;
  collectionId: any;
  isWishlist: boolean;
  /** Raw POST body, so a mapper can read its own extra fields (default format...). */
  body: any;
  req: any;
}

export interface CsvImportSpec {
  plugin: PluginDefinition;

  /** Keeps only the rows this importer targets (e.g. Libib's item_type === 'book'). */
  accepts?(row: CsvRow, ctx: CsvImportContext): boolean;

  /** Turns an accepted row into a save payload. Return null to skip the row. */
  mapRow(row: CsvRow, ctx: CsvImportContext): Promise<Record<string, any> | null> | Record<string, any> | null;

  /** Columns the file must expose, else the whole import is rejected upfront. */
  requiredColumns?: string[];

  /** Separator of the file. Plugin importers know theirs; the generic one is told. */
  delimiter?: string;

  /**
   * Query sent to the plugin's search provider when enrichment is on. Returning an
   * empty string skips enrichment for that item. Defaults to the item title.
   */
  searchQuery?(row: CsvRow, data: Record<string, any>): string;

  /**
   * Extra options passed to the search provider (e.g. music needs `type` to search
   * the right support on Discogs, else every lookup is filtered to vinyl).
   */
  searchOptions?(row: CsvRow, data: Record<string, any>): Record<string, any>;

  /** Anti rate-limit delay between two enriched items (ms). */
  enrichDelayMs?: number;
}

/** Base Item paths an enrichment result may fill, on top of the plugin's own schema. */
const ENRICHABLE_BASE_FIELDS = ['cover_image', 'year', 'barcode', 'genre', 'genres', 'styles'];

/** Giving up on one provider lookup rather than stalling the whole import on it. */
const ENRICH_TIMEOUT_MS = 20000;

const isEmptyValue = (value: any): boolean =>
  value === undefined || value === null || value === '' || value === 0 ||
  (Array.isArray(value) && value.length === 0);

/**
 * Paths an enrichment result is allowed to write on this plugin's items.
 *
 * The fields the plugin uses to tell two copies apart (variant, zone, region, format...)
 * are excluded: the CSV and the import form are what decide those. Letting a provider
 * fill one, for instance the variant of the first Discogs hit, would make the next run
 * of the same file see a different item and import everything a second time.
 */
function enrichableFields(plugin: PluginDefinition): Set<string> {
  const fields = new Set([...Object.keys(plugin.schemaDefinition || {}), ...ENRICHABLE_BASE_FIELDS]);
  for (const field of plugin.duplicateCheckFields || []) fields.delete(field);
  return fields;
}

/**
 * Value each path of the plugin falls back to when the import fed it nothing. Computed
 * defaults (Date.now and friends) are left out: they are stamps, never a stale choice.
 */
function schemaDefaults(plugin: PluginDefinition): Map<string, any> {
  const defaults = new Map<string, any>();
  const schema = mongoose.model(plugin.kind).schema;
  for (const name of Object.keys(plugin.schemaDefinition || {})) {
    const value = (schema.path(name) as any)?.options?.default;
    if (value !== undefined && typeof value !== 'function' && !isEmptyValue(value)) defaults.set(name, value);
  }
  return defaults;
}

/**
 * Fills the gaps of an item with data fetched from the plugin's provider, and returns
 * what was actually filled. The CSV always wins: an export carries the user's own
 * truth (their rating, their notes, the edition they own), the API only completes what
 * the export never carried (cover, description, external id, genres...).
 *
 * `staleDefaults` widens "gap" to the paths still holding the schema default. It is only
 * passed when this pass is the first to identify the item, where a default is what the
 * schema chose for lack of a match, not what the user meant.
 */
function fillEmptyFields(
  target: Record<string, any>,
  enriched: Record<string, any>,
  allowed: Set<string>,
  staleDefaults?: Map<string, any>
): Record<string, any> {
  const filled: Record<string, any> = {};
  for (const [key, value] of Object.entries(enriched)) {
    if (!allowed.has(key)) continue;
    if (isEmptyValue(value)) continue;
    if (!isEmptyValue(target[key]) && target[key] !== staleDefaults?.get(key)) continue;
    target[key] = value;
    filled[key] = value;
  }
  return filled;
}

/**
 * Duplicate check for an import targeting the wishlist.
 *
 * The plugins' own findDuplicate answers "do I already own this?": it looks at owned
 * items only. Reusing it here would let a copy sitting in the collection cancel its
 * wishlist entry, when the two are deliberately separate lists. The generic rule below
 * mirrors what the plugin declares: same title, same creator, same distinguishing
 * fields, among wishlist items.
 */
async function findWishlistDuplicate(plugin: PluginDefinition, collectionId: any, data: Record<string, any>): Promise<any | null> {
  const exact = (value: string) => ({ $regex: new RegExp(`^${escapeRegExp(value)}$`, 'i') });

  const query: Record<string, any> = {
    collection: collectionId,
    in_wishlist: true,
    title: exact(String(data.title || '').trim())
  };

  const creator = String(data[plugin.creatorField] || '').trim();
  if (creator) query[plugin.creatorField] = exact(creator);

  for (const field of plugin.duplicateCheckFields || []) {
    const value = data[field];
    if (typeof value === 'string' && value.trim()) query[field] = exact(value.trim());
  }

  return mongoose.model(plugin.kind).findOne(query);
}

/** Rejects instead of hanging forever: providers have no timeout of their own. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`provider timed out after ${ms}ms`)), ms))
  ]);
}

/** What the row itself says about the item, used to recognize it among the hits. */
interface MatchTarget {
  title: string;
  year: string;
  creator: string;
}

/** Comparable form of a title or a name: case, accents and punctuation dropped. */
function normalizeForMatch(value: any): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** First four-digit year found in a value, 0 when there is none. */
function yearOf(value: any): number {
  const match = String(value ?? '').match(/\d{4}/);
  return match ? Number(match[0]) : 0;
}

const sameName = (a: string, b: string): boolean => a.includes(b) || b.includes(a);

/** How well one hit matches what the row already knows. Unknowns simply score nothing. */
function scoreCandidate(candidate: SearchResult, target: MatchTarget): number {
  let score = 0;

  const title = normalizeForMatch(candidate.title);
  const wantedTitle = normalizeForMatch(target.title);
  if (title && wantedTitle) {
    if (title === wantedTitle) score += 5;
    else if (sameName(title, wantedTitle)) score += 1;
  }

  // A gap of one year is normal: providers date a release, the file often dates the
  // edition owned. Beyond that it is another work, and the penalty must outweigh a
  // mere partial title match.
  const year = yearOf(candidate.year);
  const wantedYear = yearOf(target.year);
  if (year && wantedYear) {
    const gap = Math.abs(year - wantedYear);
    score += gap === 0 ? 4 : gap === 1 ? 2 : -3;
  }

  const creator = normalizeForMatch(candidate.creator);
  const wantedCreator = normalizeForMatch(target.creator);
  if (creator && wantedCreator) {
    score += sameName(creator, wantedCreator) ? 4 : -1;
  }

  return score;
}

/**
 * Picks the hit that matches the row rather than whatever the provider ranked first:
 * searching "Alien" on TMDB returns the 2021 series before the 1979 film.
 *
 * The match is reported as sure when the title is exact and nothing the row knows
 * contradicts it. Anything less deserves a second, narrower lookup.
 */
function pickBestMatch(results: SearchResult[], target: MatchTarget): { match: SearchResult | null; sure: boolean } {
  let match: SearchResult | null = null;
  let best = -Infinity;

  // Strictly greater keeps the provider's own ranking as the tie-breaker.
  for (const candidate of results || []) {
    const score = scoreCandidate(candidate, target);
    if (score > best) {
      best = score;
      match = candidate;
    }
  }
  if (!match) return { match: null, sure: false };

  const year = yearOf(match.year);
  const wantedYear = yearOf(target.year);
  const creator = normalizeForMatch(match.creator);
  const wantedCreator = normalizeForMatch(target.creator);

  const sure =
    normalizeForMatch(match.title) === normalizeForMatch(target.title) &&
    (!year || !wantedYear || Math.abs(year - wantedYear) <= 1) &&
    (!creator || !wantedCreator || sameName(creator, wantedCreator));

  return { match, sure };
}

/**
 * Looks one item up on the plugin's own search provider and returns its details, or
 * null when nothing matches (a lookup failure never fails the import).
 */
async function fetchEnrichment(
  plugin: PluginDefinition,
  query: string,
  options: Record<string, any>,
  target: MatchTarget
): Promise<Record<string, any> | null> {
  try {
    const search = (q: string) => withTimeout(plugin.searchProvider!.search(q, options), ENRICH_TIMEOUT_MS);

    let { match, sure } = pickBestMatch(await search(query), target);

    // The bare title is what most providers match on: TMDB returns nothing at all for
    // "Inception Christopher Nolan". It is ambiguous on a generic title though, so when
    // the first pass leaves a doubt the creator carried by the row is worth a second,
    // narrower search. Providers that do not index it return nothing and the first pass
    // simply stands.
    if (!sure && target.creator && !normalizeForMatch(query).includes(normalizeForMatch(target.creator))) {
      const narrowed = pickBestMatch(await search(`${query} ${target.creator}`), target);
      if (narrowed.match && (narrowed.sure || !match)) match = narrowed.match;
    }
    if (!match) return null;

    const details = await withTimeout(plugin.searchProvider!.getDetails(String(match.id), options), ENRICH_TIMEOUT_MS);
    return { ...match, ...details };
  } catch (err: any) {
    console.error(`[${plugin.id}] Enrichment failed for "${query}":`, err.message);
    return null;
  }
}

/**
 * Runs a CSV import end to end. Answers the HTTP request immediately (202) and then
 * streams progress over socket.io, like the other bulk importers.
 */
export async function runCsvImport(req: any, res: any, spec: CsvImportSpec): Promise<void> {
  const { plugin } = spec;
  const csv = req.body?.csv;

  if (!csv) {
    return res.status(400).json({ error: 'Missing CSV data' });
  }

  const ctx: CsvImportContext = {
    userId: req.user._id,
    collectionId: res.locals.activeCollectionId,
    isWishlist: req.body?.type === 'wishlist',
    body: req.body || {},
    req
  };
  const enrich = req.body?.enrich === true || req.body?.enrich === 'true';

  res.status(202).json({ success: true, message: 'Import started' });

  try {
    const records = parseCsvRecords(csv, spec.delimiter || ',');
    if (records.length === 0) {
      req.io.emit('import_error', { message: 'CSV file is empty or invalid' });
      return;
    }

    const columns = Object.keys(records[0]!);
    const missing = (spec.requiredColumns || []).filter(c => !columns.includes(c));
    if (missing.length > 0) {
      req.io.emit('import_error', { message: `Invalid CSV format: missing column(s) ${missing.join(', ')}` });
      return;
    }

    const rows = spec.accepts ? records.filter(row => spec.accepts!(row, ctx)) : records;
    if (rows.length === 0) {
      req.io.emit('import_finished', { count: 0, updated: 0, failed: 0 });
      return;
    }

    const Model = mongoose.model(plugin.kind);
    const canEnrich = enrich && !!plugin.searchProvider;
    const enrichDelayMs = spec.enrichDelayMs ?? 500;
    const allowed = enrichableFields(plugin);
    const defaults = schemaDefaults(plugin);

    let totalImported = 0;
    let totalUpdated = 0;
    let totalFailed = 0;
    let totalProcessed = 0;

    /** Imports one row; returns what it did so the caller can keep the tallies. */
    const importRow = async (row: CsvRow): Promise<'created' | 'updated' | 'skipped'> => {
      const data = await spec.mapRow(row, ctx);
      if (!data || !data.title) return 'skipped';

      const query = spec.searchQuery ? spec.searchQuery(row, data) : data.title;
      const searchOptions = { language: req.language, ...(spec.searchOptions ? spec.searchOptions(row, data) : {}) };

      // What the row claims about the item, so the right hit can be told apart from the
      // rest. Read off the mapped payload rather than the raw row: the mapping is what
      // knows which column was the title, the year or the creator.
      const target: MatchTarget = {
        title: String(data.title || ''),
        year: String(data.year ?? ''),
        creator: String((plugin.creatorField && data[plugin.creatorField]) || '')
      };

      // Duplicate detection is the plugin's own (format/region/zone aware), scoped to
      // the active collection, unless the target is the wishlist: that list has its own
      // contents and is never blocked by an item already owned.
      const existing = ctx.isWishlist
        ? await findWishlistDuplicate(plugin, ctx.collectionId, data)
        : await plugin.findDuplicate(ctx.collectionId, data);

      if (existing) {
        // Re-running the same file with enrichment on is how one completes a library
        // imported in fast mode, so an item already there still gets its missing cover
        // and metadata rather than being skipped outright.
        if (!canEnrich || !query) return 'skipped';

        const enriched = await fetchEnrichment(plugin, query, searchOptions, target);
        await new Promise(resolve => setTimeout(resolve, enrichDelayMs));
        if (!enriched) return 'skipped';

        const current = existing.toObject ? existing.toObject() : existing;

        // An item that never matched anything holds schema defaults, not decisions: a
        // row the provider could not identify is stored as a movie because that is what
        // the DVD schema says. When this pass is the first to actually recognize the
        // item, those defaults have to give way, else a series would keep a movie type
        // alongside a series id, and TMDB answers that pair with a different work.
        const idField = plugin.externalIdField;
        const firstMatch = !!idField && isEmptyValue(current[idField]) && !isEmptyValue(enriched[idField]);

        const patch = fillEmptyFields(current, enriched, allowed, firstMatch ? defaults : undefined);
        if (Object.keys(patch).length === 0) return 'skipped';

        // A sync, not an edit: this branch only ever writes what the provider returned,
        // never what the row said. The importer's own rows land through create() below.
        await Model.updateOne({ _id: existing._id }, { $set: { ...patch, ...syncStamp() } });
        return 'updated';
      }

      if (canEnrich && query) {
        const enriched = await fetchEnrichment(plugin, query, searchOptions, target);
        if (enriched) fillEmptyFields(data, enriched, allowed);
        await new Promise(resolve => setTimeout(resolve, enrichDelayMs));
      }

      // Same normalization hook the manual and edit forms go through, so an imported
      // item is stored exactly like a hand-added one (books keep isbn/barcode in sync,
      // LEGO mirrors its theme into genre...).
      plugin.normalizeForSave?.(data);

      await Model.create({
        ...data,
        kind: plugin.kind,
        owner: ctx.userId,
        collection: ctx.collectionId,
        in_wishlist: ctx.isWishlist
      });
      return 'created';
    };

    // Announce the size of the job before the first item: an enriched import spends
    // seconds per item, and the admin would otherwise stare at a frozen button.
    req.io.emit('import_progress', { current: 0, total: rows.length });

    for (const row of rows) {
      totalProcessed++;
      try {
        const outcome = await importRow(row);
        if (outcome === 'created') totalImported++;
        else if (outcome === 'updated') totalUpdated++;
      } catch (rowErr: any) {
        // One bad line (a value the schema rejects, a mapper that threw) must not cost
        // the user the whole file: it is logged and the import moves on.
        totalFailed++;
        console.error(`[${plugin.id}] CSV row skipped ("${(row['title'] || '').slice(0, 60)}"):`, rowErr.message);
      }
      req.io.emit('import_progress', { current: totalProcessed, total: rows.length });
    }

    if (totalFailed > 0) console.error(`[${plugin.id}] CSV import: ${totalFailed} row(s) skipped on error.`);
    req.io.emit('import_finished', { count: totalImported, updated: totalUpdated, failed: totalFailed });
  } catch (err: any) {
    console.error(`[${plugin.id}] CSV import error:`, err);
    req.io.emit('import_error', { message: err.message });
  }
}
