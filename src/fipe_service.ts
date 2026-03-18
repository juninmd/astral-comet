import { FipeVehicle } from './types';

// FIPE vehicle type category used in API paths
type FipeCategory = 'carros' | 'motos' | 'caminhoes';

export class FipeService {
  private static BASE_URL = 'https://brasilapi.com.br/api/fipe';

  // Categories to try in order (cars first — most common at auctions)
  private static CATEGORIES: FipeCategory[] = ['carros', 'motos', 'caminhoes'];

  private static normalize(text: string): string {
    return text.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
      .replace(/[^a-z0-9 ]/g, ' ')                      // alphanumeric only
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Find brand code within a category's brand list. */
  private static async findBrand(category: FipeCategory, normBrand: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.BASE_URL}/marcas/v1/${category}`);
      if (!res.ok) return null;
      const brands: { nome: string; valor: string }[] = await res.json();

      if (!Array.isArray(brands)) return null;

      const found = brands.find(b => {
        if (!b?.nome) return false;
        const bName = this.normalize(b.nome);
        return normBrand === bName || normBrand.includes(bName) || bName.includes(normBrand);
      });
      return found?.valor ?? null;
    } catch (e) {
      return null;
    }
  }

  /** Within a brand's vehicle list, find the best model match by word overlap. */
  private static findBestModel(
    models: { nome: string; valor: string }[],
    normModel: string
  ): { nome: string; valor: string } | null {
    if (!Array.isArray(models)) return null;
    const modelWords = normModel.split(' ').filter(w => w.length > 1);
    let bestMatch: { nome: string; valor: string } | null = null;
    let maxOverlap = 0;

    for (const m of models) {
      if (!m?.nome) continue;
      const mName = this.normalize(m.nome);
      const mWords = mName.split(' ');
      const overlap = modelWords.filter(w => mWords.includes(w)).length;
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestMatch = m;
      }
    }

    // Require at least 1 meaningful word to match
    return maxOverlap >= 1 ? bestMatch : null;
  }

  static async getPrice(brand: string, model: string, year: number): Promise<FipeVehicle | null> {
    const normBrand = this.normalize(brand);
    const normModel = this.normalize(model);

    console.debug(`[FIPE] Searching: brand="${normBrand}" model="${normModel}" year=${year}`);

    for (const category of this.CATEGORIES) {
      try {
        const brandCode = await this.findBrand(category, normBrand);
        if (!brandCode) continue;

        const modelsRes = await fetch(`${this.BASE_URL}/veiculos/v1/${category}/${brandCode}`);
        if (!modelsRes.ok) continue;
        const models: { nome: string; valor: string }[] = await modelsRes.json();

        const bestModel = this.findBestModel(models, normModel);
        if (!bestModel) continue;

        console.debug(`[FIPE] Matched model: "${bestModel.nome}" (code ${bestModel.valor})`);

        const pricesRes = await fetch(`${this.BASE_URL}/preco/v1/${bestModel.valor}`);
        if (!pricesRes.ok) continue;
        const prices: FipeVehicle[] = await pricesRes.json();

        // Try exact year match first, then adjacent years (model year may differ by 1)
        const exactMatch = prices.find(p => p.anoModelo === year);
        if (exactMatch) return exactMatch;

        const nearMatch = prices.find(p => p.anoModelo === year - 1 || p.anoModelo === year + 1);
        if (nearMatch) {
          console.debug(`[FIPE] Using adjacent year ${nearMatch.anoModelo} for requested ${year}`);
          return nearMatch;
        }
      } catch (error) {
        console.error(`[FIPE] Error in category ${category}:`, error);
      }
    }

    return null;
  }
}
