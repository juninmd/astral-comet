import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FipeError, FipeService } from '../src/fipe_service';

const brands = [
  { nome: 'Fiat', valor: '21' },
  { nome: 'GM - Chevrolet', valor: '23' },
  { nome: 'Mercedes-Benz', valor: '39' },
  { nome: 'VW - VolksWagen', valor: '59' },
];
const models: Record<string, { modelo: string; valor: string }[]> = {
  '21': [
    { modelo: 'Uno Mille Economy 1.0 Fire Flex 8V 4p', valor: '100' },
    { modelo: 'Uno Mille 1.0 ', valor: '101' },
    { modelo: 'Palio Fire 1.0', valor: '102' },
  ],
  '59': [{ modelo: 'Gol City 1.0 Flex 8V 4p', valor: '200' }, { modelo: 'Gol 1.6 Mi', valor: '201' }],
};

function mockApi(overrides: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    for (const [part, make] of Object.entries(overrides)) if (url.includes(part)) return make();
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.endsWith('/marcas/v1/carros')) return json(brands);
    if (url.endsWith('/marcas/v1/motos')) return json([{ nome: 'HONDA', valor: '80' }]);
    if (url.endsWith('/marcas/v1/caminhoes')) return json([]);
    let m = url.match(/veiculos\/v1\/carros\/(\d+)$/);
    if (m) return json(models[m[1]] ?? []);
    if (/veiculos\/v1\/motos\/80$/.test(url)) return json([{ modelo: 'CG 160 FAN', valor: '900' }]);
    m = url.match(/models\/(\d+)\/years$/);
    if (m) return json([{ code: '2008-1', name: '2008 Gasolina' }, { code: '2009-1', name: '2009 Gasolina' }, { code: '2010-1', name: '2010 Gasolina' }]);
    m = url.match(/models\/(\d+)\/years\/(\d+)-1$/);
    if (m) return json({ price: `R$ ${m[2]},00`, brand: 'X', model: `M${m[1]}`, modelYear: Number(m[2]), fuel: 'Gasolina', codeFipe: '1', referenceMonth: 'outubro de 2026' });
    return json({}, 404);
  }));
  return calls;
}

beforeEach(() => FipeService.clearCache());
afterEach(() => vi.unstubAllGlobals());

describe('FipeService.normalize', () => {
  it('removes accents, keeps engine sizes', () => {
    expect(FipeService.normalize('Opala Comodoro 4.1 Álcool')).toBe('opala comodoro 4.1 alcool');
    expect(FipeService.normalize('M.BENZ')).toBe('m benz');
  });
});

describe('FipeService.getPrice', () => {
  it('finds exact year using real API field names (modelo/valor, code, price)', async () => {
    mockApi();
    const r = await FipeService.getPrice('FIAT', 'UNO MILLE ECONOMY', 2009);
    expect(r?.modelYear).toBe(2009);
    expect(r?.model).toBe('M100');
  });

  it('resolves auction abbreviations (VW, GM, M.BENZ)', async () => {
    mockApi();
    expect((await FipeService.getPrice('VW', 'GOL 1.0 CITY', 2009))?.model).toBe('M200');
    expect(await FipeService.findBrand({ brasil: 'carros', parallelum: 'cars' }, 'GM')).toBe('23');
    expect(await FipeService.findBrand({ brasil: 'carros', parallelum: 'cars' }, 'M.BENZ')).toBe('39');
  });

  it('prefers the engine size in the model name', async () => {
    mockApi();
    expect((await FipeService.getPrice('VW', 'GOL 1.6', 2009))?.model).toBe('M201');
  });

  it('falls back to an adjacent year', async () => {
    mockApi();
    expect((await FipeService.getPrice('FIAT', 'UNO MILLE', 2011))?.modelYear).toBe(2010);
  });

  it('returns null when the year is far away', async () => {
    mockApi();
    expect(await FipeService.getPrice('FIAT', 'UNO MILLE', 1990)).toBeNull();
  });

  it('returns null for unknown brand or model', async () => {
    mockApi();
    expect(await FipeService.getPrice('XPTO', 'UNO', 2009)).toBeNull();
    expect(await FipeService.getPrice('FIAT', 'NAVE ESPACIAL', 2009)).toBeNull();
  });

  it('falls through to motorcycles', async () => {
    mockApi();
    expect((await FipeService.getPrice('HONDA', 'CG 160 FAN', 2010))?.model).toBe('M900');
  });

  it('throws rate-limit when the price API answers 429 and nothing else matched', async () => {
    mockApi({ '/years': () => new Response('{}', { status: 429 }) });
    await expect(FipeService.getPrice('FIAT', 'UNO MILLE', 2009)).rejects.toMatchObject({ kind: 'rate-limit' });
  });

  it('throws a network error when fetch rejects, and does not cache the failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(FipeService.getPrice('FIAT', 'UNO', 2009)).rejects.toBeInstanceOf(FipeError);
    mockApi();
    expect(await FipeService.getPrice('FIAT', 'UNO MILLE', 2009)).not.toBeNull();
  });

  it('dedupes concurrent requests', async () => {
    const calls = mockApi();
    await Promise.all([FipeService.getPrice('FIAT', 'UNO MILLE', 2009), FipeService.getPrice('FIAT', 'UNO MILLE', 2009)]);
    expect(calls.filter(u => u.endsWith('/marcas/v1/carros')).length).toBe(1);
  });

  it('sends the token only when provided', async () => {
    mockApi();
    await FipeService.getPrice('FIAT', 'UNO MILLE', 2009, 'abc');
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const withHeader = fetchMock.mock.calls.filter(c => c[1]?.headers);
    expect(withHeader.length).toBeGreaterThan(0);
    expect(withHeader.every(c => c[0].includes('parallelum'))).toBe(true);
  });
});
