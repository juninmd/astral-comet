// "De-para" tables: how the auction house spells vehicles vs how FIPE spells them. The auction prints the Detran
// registration names (cut at ~20 characters, vowels and spaces dropped: "HB20S 10M EVOLUTI", "KGOO EXPRESS16").
// Every entry below comes from a real lot description; add new ones with a test in tests/model_match.test.ts.
// Keys are normalized text (lowercase, no accents, punctuation as spaces).

/** Auction brand → FIPE brand words (the FIPE name just has to contain all of them). */
export const BRAND_ALIASES: Record<string, string> = {
  vw: 'volkswagen',
  gm: 'chevrolet',
  chev: 'chevrolet',
  'm benz': 'mercedes benz',
  mbenz: 'mercedes benz',
  mmc: 'mitsubishi',
  lr: 'land rover',
  'l rover': 'land rover',
  jag: 'jaguar',
  'h d': 'harley davidson',
  caoachery: 'caoa chery',
  'ssang yong': 'ssangyong',
  'i m trading': 'im trading',
};

/**
 * First segment of the description that is not a vehicle FIPE prices: semi-trailers and trailers
 * ("SR/FACCHINI SRF 4CB"). Looking them up would only burn the daily request quota.
 */
export const NOT_IN_FIPE_MAKERS = new Set(['sr', 'r', 'sre', 'rb', 'reb']);

/** Auction abbreviation → the spellings FIPE uses for the same word. */
export const TOKEN_SYNONYMS: Record<string, string[]> = {
  // transmission
  mt: ['mec'], m: ['mec'], mec: ['mec', 'manual'], manual: ['mec'],
  at: ['aut'], aut: ['aut', 'automatico'], auto: ['aut'], cvt: ['aut', 'cvt'], tip: ['aut', 'tip'],
  // VW trim codes
  hl: ['highline'], cl: ['comfortline', 'comfort'], tl: ['trendline'], mbvs: ['mi'],
  // body
  sd: ['sedan'], sw: ['sw', 'wagon', 'perua'], hb: ['hatch'], cs: ['cs', 'cabine simples'], ce: ['ce', 'cabine estendida'], cd: ['cd', 'cabine dupla'],
  // fuel / engine
  flex: ['flex', 'total flex'], tb: ['tb', 'turbo'], tf: ['tb', 'turbo', 'flex'], ta: ['tb', 'aut'], tsi: ['tsi'],
  d: ['diesel'], dies: ['diesel'],
};

/**
 * Whole-model rewrites applied to the folded auction model before tokenizing, optionally per brand. For names where
 * the auction cut or glued the family word so that no generic rule can recover it.
 */
export const MODEL_REWRITES: { brand?: RegExp; pattern: RegExp; to: string }[] = [
  { pattern: /\bkgoo\b/, to: 'kangoo' },
  { brand: /mercedes|m benz|mbenz/, pattern: /^([abceglsx])\s?(\d{2,3})\b/, to: '$1 $2' },
  { brand: /volkswagen|vw/, pattern: /^nova saveiro\b/, to: 'saveiro' },
  { brand: /volkswagen|vw/, pattern: /^novo gol\b/, to: 'gol' },
  { brand: /volkswagen|vw/, pattern: /^novo fusca\b/, to: 'fusca' },
  { brand: /jaguar|jag/, pattern: /^([ef])(pace)\b/, to: '$1 $2' },
  { brand: /citroen/, pattern: /^c4l\b/, to: 'c4 lounge' },
  { brand: /hyundai/, pattern: /^hr hdb\b/, to: 'hr' },
];
