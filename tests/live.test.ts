import { describe, expect, it } from 'vitest';
import { FipeService } from '../src/fipe_service';
import { parseCurrency } from '../src/lib';

// Hits the real BrasilAPI / FIPE v2 APIs. Run with: LIVE=1 pnpm test
describe.skipIf(!process.env.LIVE)('live FIPE lookup', () => {
  it.each([
    ['FIAT', 'UNO MILLE ECONOMY', 2009],
    ['VW', 'GOL 1.0 CITY', 2013],
    ['GM', 'ONIX 1.0', 2016],
    ['HONDA', 'CG 160 FAN', 2020],
  ] as const)('%s %s %d', async (brand, model, year) => {
    const r = await FipeService.getPrice(brand, model, year);
    console.log(brand, model, year, '→', r?.model, r?.modelYear, r?.price);
    expect(r).not.toBeNull();
    expect(parseCurrency(r!.price)).toBeGreaterThan(1000);
  }, 60000);
});
