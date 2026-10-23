import { FipeErrorKind, FipeVehicle } from './types';

// Vehicle category as named by each API.
interface Category {
  brasil: 'carros' | 'motos' | 'caminhoes';
  parallelum: 'cars' | 'motorcycles' | 'trucks';
}

interface NamedCode { name: string; code: string }

export class FipeError extends Error {
  constructor(public kind: FipeErrorKind, message: string) {
    super(message);
    this.name = 'FipeError';
  }
}

// Auction abbreviations → FIPE brand names.
const BRAND_ALIASES: Record<string, string> = {
  vw: 'volkswagen',
  gm: 'chevrolet',
  chev: 'chevrolet',
  'm benz': 'mercedes benz',
  mbenz: 'mercedes benz',
  mmc: 'mitsubishi',
  lr: 'land rover',
  'l rover': 'land rover',
  'i m trading': 'im trading',
};

const REQUEST_TIMEOUT_MS = 15000;
// FIPE lists many variants per model; only the best-ranked few are probed for the year (one request each).
const MAX_CANDIDATES = 15;

export class FipeService {
  // Brands and models come from BrasilAPI (no rate limit); years and prices from the FIPE API v2 (ids are shared).
  static BRASIL_URL = 'https://brasilapi.com.br/api/fipe';
  static FIPE_URL = 'https://fipe.parallelum.com.br/api/v2';

  // Cars first — most common at auctions.
  private static CATEGORIES: Category[] = [
    { brasil: 'carros', parallelum: 'cars' },
    { brasil: 'motos', parallelum: 'motorcycles' },
    { brasil: 'caminhoes', parallelum: 'trucks' },
  ];

  private static cache = new Map<string, Promise<unknown>>();

  static clearCache() {
    this.cache.clear();
  }

  static normalize(text: string): string {
    return text.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove accents
      .replace(/(\d)[.,](\d)/g, '$1_$2')                 // keep engine sizes ("1.0") as one token
      .replace(/[^a-z0-9_ ]/g, ' ')
      .replace(/_/g, '.')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static tokens(text: string): string[] {
    return this.normalize(text).split(' ').filter(w => w.length > 1 || /^\d$/.test(w));
  }

  private static getJson<T>(url: string, token?: string): Promise<T> {
    const key = url;
    const cached = this.cache.get(key);
    if (cached) return cached as Promise<T>;

    const request = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: token ? { 'X-Subscription-Token': token } : undefined,
        });
        if (res.status === 429) throw new FipeError('rate-limit', 'Limite de consultas da API FIPE excedido');
        if (!res.ok) throw new FipeError('network', `API FIPE respondeu ${res.status}`);
        return await res.json() as T;
      } catch (e) {
        if (e instanceof FipeError) throw e;
        throw new FipeError('network', 'Falha ao acessar a API FIPE');
      } finally {
        clearTimeout(timer);
      }
    })();

    this.cache.set(key, request);
    request.catch(() => this.cache.delete(key)); // never cache failures
    return request;
  }

  /** Finds the FIPE brand code matching an auction brand abbreviation. */
  static async findBrand(category: Category, brand: string): Promise<string | null> {
    const norm = this.normalize(brand);
    const canonical = BRAND_ALIASES[norm] ?? norm;
    if (!canonical) return null;
    const canonTokens = canonical.split(' ');

    const brands = await this.getJson<{ nome: string; valor: string }[]>(`${this.BRASIL_URL}/marcas/v1/${category.brasil}`);
    if (!Array.isArray(brands)) return null;

    const found = brands.find(b => {
      if (!b?.nome) return false;
      const bName = this.normalize(b.nome);
      if (bName === canonical) return true;
      const bTokens = bName.split(' ');
      return canonTokens.every(t => bTokens.includes(t));
    });
    return found?.valor ?? null;
  }

  /** Ranks FIPE models by token overlap with the auction model; best first. */
  static rankModels(models: { modelo: string; valor: string }[], model: string, limit = MAX_CANDIDATES): { modelo: string; valor: string }[] {
    if (!Array.isArray(models)) return [];
    const wanted = this.tokens(model);
    if (wanted.length === 0) return [];
    const required = Math.min(2, wanted.length);

    return models
      .filter(m => m?.modelo && m?.valor)
      .map(m => {
        const mTokens = this.normalize(m.modelo).split(' ');
        const overlap = wanted.filter(w => mTokens.includes(w)).length;
        return { m, overlap, extra: mTokens.length };
      })
      .filter(x => x.overlap >= required)
      .sort((a, b) => b.overlap - a.overlap || a.extra - b.extra)
      .slice(0, limit)
      .map(x => x.m);
  }

  private static yearOf(code: string): number {
    return parseInt(code.split('-')[0], 10);
  }

  /**
   * Looks up the FIPE price. Returns null when nothing matches.
   * Throws FipeError when the API is unreachable or rate-limited and nothing was found.
   */
  static async getPrice(brand: string, model: string, year: number, token?: string): Promise<FipeVehicle | null> {
    let lastError: FipeError | null = null;

    for (const category of this.CATEGORIES) {
      try {
        const brandCode = await this.findBrand(category, brand);
        if (!brandCode) continue;

        const models = await this.getJson<{ modelo: string; valor: string }[]>(
          `${this.BRASIL_URL}/veiculos/v1/${category.brasil}/${brandCode}`
        );
        const candidates = this.rankModels(models, model, MAX_CANDIDATES);
        if (candidates.length === 0) continue;

        // Walk the ranked variants until one has the exact model year; remember the closest adjacent year meanwhile.
        let adjacent: { base: string; code: string; delta: number } | null = null;
        for (const candidate of candidates) {
          const base = `${this.FIPE_URL}/${category.parallelum}/brands/${brandCode}/models/${candidate.valor}`;
          const years = await this.getJson<NamedCode[]>(`${base}/years`, token);
          if (!Array.isArray(years)) continue;

          const exact = years.find(y => this.yearOf(y.code) === year);
          if (exact) return await this.getJson<FipeVehicle>(`${base}/years/${exact.code}`, token);

          for (const delta of [-1, 1]) {
            const near = years.find(y => this.yearOf(y.code) === year + delta);
            if (near && !adjacent) adjacent = { base, code: near.code, delta };
          }
        }

        if (adjacent) return await this.getJson<FipeVehicle>(`${adjacent.base}/years/${adjacent.code}`, token);
      } catch (e) {
        if (e instanceof FipeError) lastError = e;
        else throw e;
      }
    }

    if (lastError) throw lastError;
    return null;
  }
}
