import { BRAND_ALIASES, MODEL_REWRITES, TOKEN_SYNONYMS } from './depara';

export interface RankedModel { modelo: string; valor: string; score: number; /** only the family word matched: the variant is a guess */ approximate: boolean }

export function normalize(text: string): string {
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove accents
    .replace(/(\d)[.,](\d)/g, '$1_$2')                 // keep engine sizes ("1.0") as one token
    .replace(/[^a-z0-9_ ]/g, ' ')
    .replace(/_/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

/** FIPE brand code for an auction brand ("VW", "M.BENZ", "I/JAG"), or null. */
export function pickBrand(brands: { nome: string; valor: string }[], brand: string): string | null {
  const norm = normalize(brand);
  const canonical = BRAND_ALIASES[norm] ?? norm;
  if (!canonical || !Array.isArray(brands)) return null;
  const wanted = canonical.split(' ');

  const found = brands.find(b => {
    if (!b?.nome) return false;
    const name = normalize(b.nome);
    if (name === canonical) return true;
    const tokens = name.split(' ');
    return wanted.every(t => tokens.includes(t));
  });
  return found?.valor ?? null;
}

// engine size: "10" → 1.0, "16" → 1.6, "20" → 2.0 (two digits, first 1-6)
const ENGINE = /^([1-6])(\d)$/;
// glued size + valves: "1016" → 1.0 and 16v
const ENGINE_VALVES = /^([1-6])(\d)(\d\d)$/;
const PART = /\d+x\d+|\d+(?:\.\d+)?|[a-z]+/g;

/** The alternative readings of one token: itself, its letter/digit runs, engine sizes, and known abbreviations. */
function readings(token: string): string[] {
  const out = new Set<string>([token]);
  const parts = token.match(PART) ?? [];
  if (parts.length > 1) parts.forEach(p => out.add(p));
  for (const p of parts.length ? parts : [token]) {
    const engine = p.match(ENGINE);
    if (engine) out.add(`${engine[1]}.${engine[2]}`);
    const withValves = p.match(ENGINE_VALVES);
    if (withValves) { out.add(`${withValves[1]}.${withValves[2]}`); out.add(`${withValves[3]}v`); }
  }
  for (const r of [...out]) TOKEN_SYNONYMS[r]?.forEach(s => out.add(s));
  return [...out];
}

/** How much one matched reading is worth: model numbers and words count, bare short numbers and letters barely. */
function weight(reading: string): number {
  if (/^\d\.\d$/.test(reading)) return 1;            // engine size
  if (/^\d{3,}$/.test(reading) || /^\d+x\d+$/.test(reading)) return 1; // 206, 2548, 4x2
  if (/^\d+$/.test(reading)) return 0.3;
  if (reading.length === 1) return 0.2;
  if (reading.length === 2) return 0.5;
  return reading.length >= 6 ? 1.5 : 1;             // long words are distinctive (aircross, lounge)
}

// FIPE lists vans, chassis, EVs and the Blazer next to the car with the same family word; prefer the plain one.
const DIFFERENT_KIND = new Set(['furgao', 'chassi', 'van', 'pickup', 'pick', 'eletrico', 'eletrica', 'hibrido', 'blazer', 'cargo']);

interface Wanted { token: string; alts: string[] }

function wantedOf(model: string, brand: string): Wanted[] {
  let text = normalize(model);
  const b = normalize(brand);
  for (const rule of MODEL_REWRITES) {
    if (rule.brand && !rule.brand.test(b)) continue;
    text = text.replace(rule.pattern, rule.to);
  }
  return text.split(' ').filter(Boolean).map(token => ({ token, alts: readings(token) }));
}

interface Candidate { tokens: string[]; set: Set<string> }

function candidateOf(name: string): Candidate {
  const tokens = normalize(name).split(' ').filter(Boolean);
  const set = new Set<string>();
  for (const t of tokens) { set.add(t); (t.match(PART) ?? []).forEach(p => set.add(p)); }
  return { tokens, set };
}

/** 1 for an exact hit, 0.8 for a truncated word ("evolut" → "evolution"), else 0. */
function hit(reading: string, c: Candidate): number {
  if (c.set.has(reading)) return 1;
  if (reading.length < 4 || !/^[a-z]+$/.test(reading)) return 0;
  // "evolut" is a cut "evolution"; "meganegt" is "megane" glued to "gt".
  return c.tokens.some(t => t.startsWith(reading) || (t.length >= 5 && reading.startsWith(t))) ? 0.8 : 0;
}

function score(wanted: Wanted[], c: Candidate): { total: number; family: boolean } {
  let total = 0;
  wanted.forEach(w => {
    // A glued token may hit through several readings ("c3" → c3, c, 3), but it is still one word: the best reading
    // counts in full, the others only a little.
    const hits = w.alts.map(alt => hit(alt, c) * weight(alt)).sort((x, y) => y - x);
    total += Math.min(hits[0] + 0.3 * hits.slice(1).reduce((x, y) => x + y, 0), 2);
  });
  // One of the first two words has to name the model ("HB20S", "ONIX", "C3 AIRCROSS" → Aircross): it must be among the first
  // words of the FIPE name (three for long words: "Range Rover Velar"). A lone letter or number cut out of a glued token
  // ("400S" → "s") does not count.
  const parts = (t: string) => [t, ...(t.match(PART) ?? [])];
  const lead2 = c.tokens.slice(0, 2).flatMap(parts);
  const lead3 = c.tokens.slice(0, 3).flatMap(parts);
  const family = wanted.slice(0, 2).some((w, index) => w.alts.some(alt => {
    if (alt.length < 2 && !(index === 0 && alt === w.token)) return false;
    if (/^\d\.\d$/.test(alt)) return false; // an engine size never names the model
    const pool = alt.length >= 5 ? lead3 : lead2;
    return pool.some(t => t === alt || (alt.length >= 4 && /^[a-z]+$/.test(alt) && (t.startsWith(alt) || (t.length >= 5 && alt.startsWith(t)))));
  }));
  // Words that make it a different vehicle (a van, a chassis, an EV) when the auction did not say so.
  const asked = new Set(wanted.flatMap(w => w.alts));
  const other = c.tokens.filter(t => DIFFERENT_KIND.has(t) && !asked.has(t)).length;
  return { total: total - 0.6 * other, family };
}

/**
 * FIPE models for an auction model, best first. The name must start with the family word ("HB20S", "ONIX"); the rest
 * ranks variants ("1.0", "EVOLUT" ≈ Evolution). Without any variant evidence the match is flagged approximate.
 */
export function rankModels(models: { modelo: string; valor: string }[], model: string, limit: number, brand = ''): RankedModel[] {
  if (!Array.isArray(models)) return [];
  const wanted = wantedOf(model, brand);
  if (wanted.length === 0) return [];

  return models
    .filter(m => m?.modelo && m?.valor)
    .map(m => {
      const c = candidateOf(m.modelo);
      const { total, family } = score(wanted, c);
      return { m, c, total, family };
    })
    .filter(x => x.family)
    .map(x => ({ modelo: x.m.modelo, valor: x.m.valor, score: x.total - 0.02 * x.c.tokens.length, approximate: x.total < 2 }))
    .sort((p, q) => q.score - p.score)
    .slice(0, limit);
}
