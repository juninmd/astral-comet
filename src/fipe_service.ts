import { FipeVehicle } from './types';

export class FipeService {
  private static BASE_URL = 'https://brasilapi.com.br/api/fipe';

  private static normalize(text: string): string {
    return text.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-z0-9 ]/g, ' ') // Alphanumeric only
      .replace(/\s+/g, ' ') // Single spaces
      .trim();
  }

  static async getPrice(brand: string, model: string, year: number): Promise<FipeVehicle | null> {
    try {
      const normBrand = this.normalize(brand);
      const normModel = this.normalize(model);

      // 1. Get brands
      const brandsResponse = await fetch(`${this.BASE_URL}/marcas/v1/carros`);
      if (!brandsResponse.ok) return null;
      const brands: any[] = await brandsResponse.json();
      
      const brandObj = brands.find(b => {
        const bName = this.normalize(b.nome);
        return normBrand.includes(bName) || bName.includes(normBrand);
      });

      if (!brandObj) return null;

      // 2. Get vehicles
      const modelsResponse = await fetch(`${this.BASE_URL}/veiculos/v1/carros/${brandObj.valor}`);
      if (!modelsResponse.ok) return null;
      const models: any[] = await modelsResponse.json();

      // Better matching: Find model with highest word overlap
      const modelWords = normModel.split(' ');
      let bestMatch = null;
      let maxOverlap = 0;

      for (const m of models) {
        const mName = this.normalize(m.nome);
        const mWords = mName.split(' ');
        const overlap = modelWords.filter(word => mWords.includes(word)).length;
        
        if (overlap > maxOverlap) {
          maxOverlap = overlap;
          bestMatch = m;
        }
      }

      if (!bestMatch || maxOverlap < 1) return null;

      // 3. Get prices
      const pricesResponse = await fetch(`${this.BASE_URL}/preco/v1/${bestMatch.valor}`);
      if (!pricesResponse.ok) return null;
      const prices: FipeVehicle[] = await pricesResponse.json();

      return prices.find(p => p.anoModelo === year) || null;
    } catch (error) {
      console.error('Error fetching FIPE data:', error);
      return null;
    }
  }
}
