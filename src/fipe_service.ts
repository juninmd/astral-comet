import { FipeErrorKind, FipeVehicle } from './types';

// Vehicle category as named by each API.
export interface Category {
  brasil: 'carros' | 'motos' | 'caminhoes';
  parallelum: 'cars' | 'motorcycles' | 'trucks';
  label: string;
}

export interface NamedCode { name: string; code: string }

export interface LocatedVehicle { category: Category; brandCode: string; modelCode: string; yearCode: string }

export interface ResolvedVehicle { category: Category; brandCode: string; modelCode: string | null; yearCode?: string }

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
  static readonly CATEGORIES: readonly Category[] = [
    { brasil: 'carros', parallelum: 'cars', label: 'Carros' },
    { brasil: 'motos', parallelum: 'motorcycles', label: 'Motos' },
    { brasil: 'caminhoes', parallelum: 'trucks', label: 'Caminhões' },
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

  private static clean(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /** All FIPE brands of a category, in API order. */
  static async listBrands(category: Category): Promise<NamedCode[]> {
    const brands = await this.getJson<{ nome: string; valor: string }[]>(`${this.BRASIL_URL}/marcas/v1/${category.brasil}`);
    if (!Array.isArray(brands)) return [];
    return brands.filter(b => b?.nome && b?.valor).map(b => ({ name: this.clean(b.nome), code: String(b.valor) })).filter(b => b.name);
  }

  /** All FIPE models of a brand (several hundred for big brands — filter client-side). */
  static async listModels(category: Category, brandCode: string): Promise<NamedCode[]> {
    const models = await this.getJson<{ modelo: string; valor: string }[]>(`${this.BRASIL_URL}/veiculos/v1/${category.brasil}/${brandCode}`);
    if (!Array.isArray(models)) return [];
    return models.filter(m => m?.modelo && m?.valor).map(m => ({ name: this.clean(m.modelo), code: String(m.valor) })).filter(m => m.name);
  }

  /** Model years (one entry per fuel) of a model, newest first. */
  static async listYears(category: Category, brandCode: string, modelCode: string, token?: string): Promise<NamedCode[]> {
    const years = await this.getJson<NamedCode[]>(`${this.FIPE_URL}/${category.parallelum}/brands/${brandCode}/models/${modelCode}/years`, token);
    if (!Array.isArray(years)) return [];
    return years
      .filter(y => y?.code && y?.name)
      .sort((a, b) => this.yearOf(b.code) - this.yearOf(a.code) || a.code.localeCompare(b.code));
  }

  /** Exact lookup from picker codes; no name matching involved. */
  static getPriceByCode(category: Category, brandCode: string, modelCode: string, yearCode: string, token?: string): Promise<FipeVehicle> {
    return this.getJson<FipeVehicle>(
      `${this.FIPE_URL}/${category.parallelum}/brands/${brandCode}/models/${modelCode}/years/${yearCode}`, token);
  }

  /**
   * Finds the FIPE codes for an auction vehicle: the first ranked variant that has the model year
   * (closest adjacent year as a fallback). Null when nothing matches; throws FipeError when the API
   * failed and nothing was found.
   */
  static async locate(brand: string, model: string, year: number, token?: string): Promise<LocatedVehicle | null> {
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
        let adjacent: { modelCode: string; code: string } | null = null;
        for (const candidate of candidates) {
          const years = await this.getJson<NamedCode[]>(
            `${this.FIPE_URL}/${category.parallelum}/brands/${brandCode}/models/${candidate.valor}/years`, token);
          if (!Array.isArray(years)) continue;

          const exact = years.find(y => this.yearOf(y.code) === year);
          if (exact) return { category, brandCode, modelCode: candidate.valor, yearCode: exact.code };

          for (const delta of [-1, 1]) {
            const near = years.find(y => this.yearOf(y.code) === year + delta);
            if (near && !adjacent) adjacent = { modelCode: candidate.valor, code: near.code };
          }
        }

        if (adjacent) return { category, brandCode, modelCode: adjacent.modelCode, yearCode: adjacent.code };
      } catch (e) {
        if (e instanceof FipeError) lastError = e;
        else throw e;
      }
    }

    if (lastError) throw lastError;
    return null;
  }

  /**
   * Maps an auction brand/model (and model year) to FIPE codes for the picker. With a year it agrees with
   * getPrice; without a match it still returns the brand and best-named model so the user can finish the choice.
   */
  static async resolveVehicle(brand: string, model: string, year?: number, token?: string): Promise<ResolvedVehicle | null> {
    if (year !== undefined) {
      try {
        const hit = await this.locate(brand, model, year, token);
        if (hit) return hit;
      } catch (e) {
        // A failing years endpoint (e.g. 429) must not hide brand and model, which BrasilAPI still serves.
        if (!(e instanceof FipeError)) throw e;
      }
    }

    let brandOnly: ResolvedVehicle | null = null;
    for (const category of this.CATEGORIES) {
      const brandCode = await this.findBrand(category, brand);
      if (!brandCode) continue;
      const models = await this.getJson<{ modelo: string; valor: string }[]>(`${this.BRASIL_URL}/veiculos/v1/${category.brasil}/${brandCode}`);
      const best = this.rankModels(models, model, 1)[0];
      if (best) return { category, brandCode, modelCode: best.valor };
      brandOnly ??= { category, brandCode, modelCode: null };
    }
    return brandOnly;
  }

  /** Looks up the FIPE price. Returns null when nothing matches; throws FipeError when the API is unreachable or rate-limited. */
  static async getPrice(brand: string, model: string, year: number, token?: string): Promise<FipeVehicle | null> {
    const hit = await this.locate(brand, model, year, token);
    return hit ? this.getPriceByCode(hit.category, hit.brandCode, hit.modelCode, hit.yearCode, token) : null;
  }
}
