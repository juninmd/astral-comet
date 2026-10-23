import { Backend, chromeBackend } from './persistent_cache';

// Per-lot buyer notes (favorite, target bid, due-diligence checklist), kept only in this browser (storage.local).
export const LOT_PREFIX = 'lot:';
export const MAX_NOTE = 2000;

export const CHECKLIST = [
  { id: 'edital', label: 'Li o edital (taxas, prazos, "conservado" ou "sucata")' },
  { id: 'debts', label: 'Consultei débitos e restrições (Detran, Fazenda, Renajud)' },
  { id: 'yard', label: 'Vistoriei o veículo no pátio' },
  { id: 'auctioneer', label: 'Leiloeira credenciada no Detran e leiloeiro na Junta Comercial' },
  { id: 'docs', label: 'Conferi documentação e prazo de transferência' },
  { id: 'cash', label: 'Tenho o valor à vista reservado' },
] as const;

export interface LotRecord {
  url: string;
  title: string;
  fav: boolean;
  /** Bid the buyer plans to stop at; compared with the computed maximum. */
  target: number;
  checks: string[];
  note: string;
  savedAt: number;
}

/** Stable id of a lot from its page URL, so every visit finds the same record. */
export function lotKey(href: string): string {
  try {
    const url = new URL(href);
    const auction = url.searchParams.get('leilaoId');
    const lot = url.searchParams.get('loteNumero');
    if (auction && lot) return `${LOT_PREFIX}${auction}-${lot}`;
    const id = url.searchParams.get('id');
    if (id) return `${LOT_PREFIX}id-${id}`;
    return `${LOT_PREFIX}${url.pathname.toLowerCase()}${url.search}`;
  } catch {
    return `${LOT_PREFIX}${href}`;
  }
}

/** Links shown outside the page (popup) must point at the auction site, whatever is in storage. */
export function safeLotUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname;
    return u.protocol === 'https:' && (host === 'freitasleiloeiro.com.br' || host.endsWith('.freitasleiloeiro.com.br')) ? u.href : null;
  } catch {
    return null;
  }
}

export function emptyRecord(url: string, title: string): LotRecord {
  return { url, title, fav: false, target: 0, checks: [], note: '', savedAt: 0 };
}

/** Storage is untrusted input: coerce every field. */
export function sanitize(raw: unknown, fallback: LotRecord): LotRecord {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const known = new Set<string>(CHECKLIST.map(c => c.id));
  const target = typeof r.target === 'number' && Number.isFinite(r.target) && r.target > 0 ? r.target : 0;
  return {
    url: typeof r.url === 'string' ? r.url : fallback.url,
    title: typeof r.title === 'string' ? r.title.slice(0, 200) : fallback.title,
    fav: r.fav === true,
    target,
    checks: Array.isArray(r.checks) ? [...new Set(r.checks.filter((c): c is string => typeof c === 'string' && known.has(c)))] : [],
    note: typeof r.note === 'string' ? r.note.slice(0, MAX_NOTE) : '',
    savedAt: typeof r.savedAt === 'number' ? r.savedAt : 0,
  };
}

const isBlank = (r: LotRecord) => !r.fav && r.target === 0 && r.checks.length === 0 && r.note.trim() === '';

export class LotStore {
  constructor(private backend: Backend, private now: () => number = Date.now) {}

  static fromChrome(): LotStore | null {
    const backend = chromeBackend();
    return backend ? new LotStore(backend) : null;
  }

  async get(key: string, url: string, title: string): Promise<LotRecord> {
    const fallback = emptyRecord(url, title);
    try {
      return sanitize((await this.backend.get([key]))[key], fallback);
    } catch {
      return fallback;
    }
  }

  /** Saves the record. The stamp lets the writer recognise its own change event and ignore it. */
  async save(key: string, record: LotRecord, savedAt = this.now()): Promise<void> {
    try {
      await this.backend.set({ [key]: { ...record, savedAt } });
    } catch { /* notes are a convenience; the page keeps working */ }
  }

  async favorites(): Promise<(LotRecord & { key: string })[]> {
    try {
      const all = await this.backend.get(null);
      return Object.entries(all)
        .filter(([key]) => key.startsWith(LOT_PREFIX))
        .map(([key, raw]) => ({ key, ...sanitize(raw, emptyRecord('', key)) }))
        .filter(r => r.fav)
        .sort((a, b) => b.savedAt - a.savedAt);
    } catch {
      return [];
    }
  }

  /** Drops the favorite flag; a record with nothing else in it is removed instead of left empty. */
  async unfavorite(key: string): Promise<void> {
    const current = { ...(await this.get(key, '', '')), fav: false };
    try {
      if (isBlank(current)) await this.backend.remove([key]);
      else await this.backend.set({ [key]: { ...current, savedAt: this.now() } });
    } catch { /* see save() */ }
  }
}
