/**
 * Where and how a record was made, as Discogs lists it: the inscriptions in the runout
 * groove, the companies that pressed, mastered and cut it, the engineers who did, and the
 * rights society. Kept as fields of their own so a collector can browse and filter on
 * them ("everything pressed at Record Service Alsdorf") instead of reading notes.
 */

// The roles Discogs gives a company, gathered under the fields they feed.
const PRESSING_ROLES = ['pressed by', 'made by', 'manufactured by'];
const MASTERING_ROLES = ['mastered at', 'lacquer cut at', 'dmm cut at', 'remastered at', 'engineered at'];
// Credits on people, matched on a word of the role ("Mastered By", "Lacquer Cut By").
const ENGINEER_ROLES = /\b(mastered by|lacquer cut by|dmm cut by|remastered by)\b/i;

export interface PressingDetails {
  pressing_plant: string[];
  mastering_studio: string[];
  mastering_engineer: string[];
  rights_society: string[];
  cutting_method: string[];
  runouts: { side: string; inscription: string; notes: string }[];
}

// Direct Metal Mastering is named outright or etched as "DMM" in the dead wax; a lacquer
// cut only shows in a role ("Lacquer Cut At", "Lacquer Cut By").
const DMM = /\bDMM\b|direct metal master/i;
const LACQUER = /\blacquer cut\b/i;

/**
 * How the master was cut, from whatever on the release says it: the roles of companies
 * and people, the format words, the notes and the runout inscriptions themselves.
 */
function cuttingMethodOf(release: any, companies: any[], credits: any[], identifiers: any[]): string[] {
  const roles = [...companies, ...credits].map(c => String(c?.entity_type_name || c?.role || ''));
  const formats: any[] = Array.isArray(release?.formats) ? release.formats : [];
  const texts = [
    ...roles,
    ...formats.flatMap(f => [...(f?.descriptions || []), String(f?.text || '')]),
    String(release?.notes || ''),
    ...identifiers.map(i => `${i?.value || ''} ${i?.description || ''}`)
  ];
  const out: string[] = [];
  if (texts.some(text => DMM.test(text))) out.push('DMM');
  if (roles.some(role => LACQUER.test(role))) out.push('Lacquer');
  return out;
}

const unique = (values: string[]) => [...new Set(values.map(v => v.trim()).filter(Boolean))];
// Discogs numbers homonyms: "Sterling Sound (2)" is still Sterling Sound to a reader.
export const cleanName = (name: unknown) => String(name ?? '').replace(/\s*\(\d+\)$/, '').trim();

/**
 * Reads a Discogs release (the full one, from /releases/:id). The side a runout belongs
 * to is in the identifier's description ("Side A", "Runout side B, variant 1"); what is
 * left of that description is kept as a note rather than lost.
 */
export function pressingFromDiscogs(release: any): PressingDetails {
  const companies: any[] = Array.isArray(release?.companies) ? release.companies : [];
  const identifiers: any[] = Array.isArray(release?.identifiers) ? release.identifiers : [];
  const credits: any[] = Array.isArray(release?.extraartists) ? release.extraartists : [];

  const byRole = (roles: string[]) => unique(companies
    .filter(c => roles.includes(String(c?.entity_type_name || '').toLowerCase()))
    .map(c => cleanName(c.name)));

  const runouts = identifiers
    .filter(i => /matrix|runout/i.test(String(i?.type || '')) && String(i?.value || '').trim())
    .map(i => {
      const description = String(i.description || '').trim();
      const side = /\bside\s+([A-Z0-9]{1,3})\b/i.exec(description)?.[1]?.toUpperCase() || '';
      const notes = side ? description.replace(/\b(runout\s+)?side\s+[A-Z0-9]{1,3}\b[,;:\s]*/i, '').trim() : description;
      return { side, inscription: String(i.value).trim(), notes };
    });

  return {
    pressing_plant: byRole(PRESSING_ROLES),
    mastering_studio: byRole(MASTERING_ROLES),
    mastering_engineer: unique(credits.filter(a => ENGINEER_ROLES.test(String(a?.role || ''))).map(a => cleanName(a.name))),
    rights_society: unique(identifiers
      .filter(i => /rights society/i.test(String(i?.type || '')))
      .map(i => String(i.value || ''))),
    cutting_method: cuttingMethodOf(release, companies, credits, identifiers),
    runouts
  };
}
