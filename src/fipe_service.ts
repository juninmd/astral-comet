import { FipeVehicle } from './types';

export class FipeService {
  private static BASE_URL = 'https://brasilapi.com.br/api/fipe/v1';

  static async getPrice(brand: string, model: string, year: number): Promise<FipeVehicle | null> {
    try {
      // 1. Get brands to find the brand ID
      const brandsResponse = await fetch(`${this.BASE_URL}/marcas/v1/carros`);
      if (!brandsResponse.ok) return null;
      const brands: any[] = await brandsResponse.json();
      
      const brandObj = brands.find(b => 
        brand.toLowerCase().includes(b.nome.toLowerCase()) || 
        b.nome.toLowerCase().includes(brand.toLowerCase())
      );

      if (!brandObj) return null;

      // 2. Get models for that brand
      const modelsResponse = await fetch(`${this.BASE_URL}/modelos/v1/carros/${brandObj.valor}`);
      if (!modelsResponse.ok) return null;
      const modelsData: any = await modelsResponse.json();
      const models: any[] = modelsData.modelos || [];

      // Simple fuzzy match for the model
      const modelObj = models.find(m => 
        model.toLowerCase().includes(m.nome.toLowerCase()) || 
        m.nome.toLowerCase().includes(model.toLowerCase())
      );

      if (!modelObj) return null;

      // 3. Get prices for the specific model and year
      const pricesResponse = await fetch(`${this.BASE_URL}/preco/v1/carros/${modelObj.valor}`);
      if (!pricesResponse.ok) return null;
      const prices: FipeVehicle[] = await pricesResponse.json();

      // Find the specific year
      const priceObj = prices.find(p => p.anoModelo === year);
      
      return priceObj || null;
    } catch (error) {
      console.error('Error fetching FIPE data:', error);
      return null;
    }
  }
}
