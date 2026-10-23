import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/fipe_http';
import { FipeService } from '../src/fipe_service';
import { Backend, COOLDOWN_MS, FRESH_MS, MAX_ENTRIES, PersistentCache, readUsage, STALE_MAX_MS } from '../src/persistent_cache';

const DAY = 24 * 3600 * 1000;
const cars = FipeService.CATEGORIES[0];
const YEARS_URL = 'https://fipe.parallelum.com.br/api/v2/cars/brands/21/models/100/years';
const PRICE_URL = `${YEARS_URL}/2009-1`;

function memoryBackend(data: Record<string, unknown> = {}): Backend & { data: Record<string, unknown> } {
  return {
    data,
    get: async keys => (keys ? Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]])) : { ...data }),
    set: async items => { Object.assign(data, items); },
    remove: async keys => { for (const k of keys) delete data[k]; },
  };
}

let clock = 1_800_000_000_000;
let backend: ReturnType<typeof memoryBackend>;
let status = 200;
let reference = '338';
let calls: string[];
/** Requests for years/prices, i.e. not the "which table is current" check. */
const dataCalls = () => calls.filter(u => !u.endsWith('/references'));

/** What a fresh page load does: empty in-memory cache, same persisted storage. */
const newPage = () => { FipeService.clearCache(); useStore(new PersistentCache(backend, () => clock)); };

beforeEach(() => {
  clock = 1_800_000_000_000;
  backend = memoryBackend();
  status = 200;
  reference = '338';
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (status === 0) throw new TypeError('offline');
    if (status !== 200) return new Response('{}', { status });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith('/references')) return json([{ code: '337' }, { code: reference }]);
    if (url.endsWith('/years')) return json([{ code: '2009-1', name: '2009 Gasolina' }]);
    if (url.includes('brasilapi')) return json([{ nome: 'Fiat', valor: '21' }]);
    return json({ price: 'R$ 20.000,00', referenceMonth: 'outubro de 2026' });
  }));
  newPage();
});
afterEach(() => { vi.unstubAllGlobals(); useStore(null); });

describe('persistent FIPE cache', () => {
  it('serves a later page load from storage without touching the API', async () => {
    await FipeService.listYears(cars, '21', '100');
    await FipeService.getPriceByCode(cars, '21', '100', '2009-1');
    expect(dataCalls()).toHaveLength(2);

    newPage();
    expect((await FipeService.listYears(cars, '21', '100'))[0].code).toBe('2009-1');
    expect((await FipeService.getPriceByCode(cars, '21', '100', '2009-1')).referenceMonth).toBe('outubro de 2026');
    expect(dataCalls()).toHaveLength(2);
  });

  it('only persists the rate-limited FIPE v2 answers, not BrasilAPI catalogs', async () => {
    await FipeService.listBrands(cars);
    await FipeService.listYears(cars, '21', '100');
    expect(Object.keys(backend.data).filter(k => k.includes('brasilapi'))).toEqual([]);
    expect(Object.keys(backend.data).some(k => k.includes(YEARS_URL))).toBe(true);
  });

  describe('monthly table', () => {
    it('keeps an answer fresh for the whole month: weeks later, same table, no request', async () => {
      await FipeService.getPriceByCode(cars, '21', '100', '2009-1');
      clock += 25 * DAY;
      newPage();
      await FipeService.getPriceByCode(cars, '21', '100', '2009-1');
      expect(dataCalls()).toHaveLength(1);
      expect(calls.filter(u => u.endsWith('/references'))).toHaveLength(2); // only the cheap "which table" check repeats
    });

    it('asks which table is current at most twice a day, however many lookups', async () => {
      await FipeService.listYears(cars, '21', '100');
      await FipeService.listYears(cars, '21', '101');
      newPage();
      await FipeService.listYears(cars, '21', '102');
      expect(calls.filter(u => u.endsWith('/references'))).toHaveLength(1);
    });

    it('refetches once a newer table is published, and tags the new answer with it', async () => {
      await FipeService.getPriceByCode(cars, '21', '100', '2009-1');
      reference = '339';
      clock += DAY;
      newPage();
      await FipeService.getPriceByCode(cars, '21', '100', '2009-1');
      expect(dataCalls()).toHaveLength(2);
      expect((backend.data[`fipe-cache:${PRICE_URL}`] as { r: string }).r).toBe('339');
    });

    it('falls back to a short age window when the table check fails', async () => {
      await FipeService.getPriceByCode(cars, '21', '100', '2009-1');
      clock += 2 * DAY;
      status = 429; // the check fails, and so would the price
      newPage();
      expect((await FipeService.getPriceByCode(cars, '21', '100', '2009-1')).price).toBe('R$ 20.000,00');
      expect(dataCalls()).toHaveLength(1);
    });
  });

  it('answers a 429 with the stale copy instead of an error', async () => {
    await FipeService.getPriceByCode(cars, '21', '100', '2009-1');
    clock += FRESH_MS + DAY;
    status = 429;
    newPage();
    expect((await FipeService.getPriceByCode(cars, '21', '100', '2009-1')).price).toBe('R$ 20.000,00');
  });

  it('serves stale on a network failure too, but does not treat it as a rate limit', async () => {
    await FipeService.getPriceByCode(cars, '21', '100', '2009-1');
    clock += FRESH_MS + DAY;
    status = 0;
    newPage();
    await FipeService.getPriceByCode(cars, '21', '100', '2009-1');
    status = 200;
    newPage();
    await FipeService.listYears(cars, '21', '100'); // would be blocked if the failure had started a cooldown
    expect(calls.at(-1)).toBe(YEARS_URL);
  });

  it('does not serve (or keep) an answer past the stale limit', async () => {
    await FipeService.getPriceByCode(cars, '21', '100', '2009-1');
    clock += STALE_MAX_MS + 1;
    status = 429;
    newPage();
    await expect(FipeService.getPriceByCode(cars, '21', '100', '2009-1')).rejects.toMatchObject({ kind: 'rate-limit' });
    expect(Object.keys(backend.data).some(k => k.endsWith('2009-1'))).toBe(false);
  });

  describe('cooldown after a 429', () => {
    it('stops spending requests while the quota is gone, then tries again', async () => {
      status = 429;
      await expect(FipeService.listYears(cars, '21', '100')).rejects.toMatchObject({ kind: 'rate-limit' });
      const spent = calls.length;

      newPage(); // another tab, same storage
      await expect(FipeService.listYears(cars, '21', '101')).rejects.toMatchObject({ kind: 'rate-limit' });
      await expect(FipeService.getPriceByCode(cars, '21', '100', '2009-1')).rejects.toMatchObject({ kind: 'rate-limit' });
      expect(calls).toHaveLength(spent);

      clock += COOLDOWN_MS + 1;
      status = 200;
      newPage();
      await FipeService.listYears(cars, '21', '101');
      expect(dataCalls()).toHaveLength(spent); // the 429'd attempt(s) plus this one
    });

    it('does not extend itself when a request is skipped', async () => {
      status = 429;
      await expect(FipeService.listYears(cars, '21', '100')).rejects.toBeDefined();
      clock += COOLDOWN_MS - 1000;
      newPage();
      await expect(FipeService.listYears(cars, '21', '101')).rejects.toBeDefined(); // skipped
      clock += 2000;
      status = 200;
      newPage();
      await FipeService.listYears(cars, '21', '101');
      expect(calls.at(-1)).toBe('https://fipe.parallelum.com.br/api/v2/cars/brands/21/models/101/years');
    });

    it('"Tentar novamente" (retryNow) goes to the network right away', async () => {
      status = 429;
      await expect(FipeService.listYears(cars, '21', '100')).rejects.toBeDefined();
      status = 200;
      newPage();
      await FipeService.retryNow();
      await FipeService.listYears(cars, '21', '100');
      expect(calls.at(-1)).toBe(YEARS_URL);
    });

    it('a token has its own quota, so an anonymous 429 does not block it', async () => {
      status = 429;
      await expect(FipeService.listYears(cars, '21', '100')).rejects.toBeDefined();
      status = 200;
      newPage();
      await FipeService.listYears(cars, '21', '100', 'tok');
      expect(calls.at(-1)).toBe(YEARS_URL);
    });
  });

  describe('quota counter', () => {
    it('counts every request sent to the API, split by token use, and restarts each day', async () => {
      await FipeService.listYears(cars, '21', '100');           // references + years
      await FipeService.listYears(cars, '21', '101', 'tok');    // years with a token
      await Promise.all([FipeService.listYears(cars, '21', '102'), FipeService.listYears(cars, '21', '103')]);
      expect(await readUsage(backend, clock)).toMatchObject({ anon: 4, token: 1 });
      expect(await readUsage(backend, clock + DAY)).toMatchObject({ anon: 0, token: 0 });
    });

    it('does not count answers served from storage', async () => {
      await FipeService.listYears(cars, '21', '100');
      const before = await readUsage(backend, clock);
      newPage();
      await FipeService.listYears(cars, '21', '100');
      expect(await readUsage(backend, clock)).toEqual(before);
    });
  });

  it('evicts the oldest entries beyond the cap', async () => {
    const store = new PersistentCache(backend, () => clock);
    for (let i = 0; i < MAX_ENTRIES + 3; i++) { clock += 1; await store.store(`u${i}`, i); }
    const keys = Object.keys(backend.data);
    expect(keys).toHaveLength(MAX_ENTRIES);
    expect(keys).not.toContain('fipe-cache:u0');
    expect(keys).toContain(`fipe-cache:u${MAX_ENTRIES + 2}`);
  });

  it('trims an oversized store when it is loaded, not only on the next write', async () => {
    for (let i = 0; i < MAX_ENTRIES + 5; i++) backend.data[`fipe-cache:u${i}`] = { v: i, t: clock + i };
    const store = new PersistentCache(backend, () => clock + MAX_ENTRIES + 10);
    await store.lookup('u0');
    expect(Object.keys(backend.data)).toHaveLength(MAX_ENTRIES);
    expect(backend.data['fipe-cache:u0']).toBeUndefined();
  });

  it('frees space before writing, so a full quota cannot block the eviction', async () => {
    const order: string[] = [];
    const spy: Backend = { ...backend, set: async items => { order.push('set'); await backend.set(items); }, remove: async keys => { order.push('remove'); await backend.remove(keys); } };
    const store = new PersistentCache(spy, () => clock);
    for (let i = 0; i < MAX_ENTRIES; i++) { clock += 1; await store.store(`u${i}`, i); }
    order.length = 0;
    clock += 1;
    await store.store('overflow', 1);
    expect(order).toEqual(['remove', 'set']);
  });

  it('follows a cooldown another tab started, without waiting for its own 429', async () => {
    const store = new PersistentCache(backend, () => clock);
    expect(await store.coolingDown(false)).toBe(false);
    store.applyChanges({ 'fipe-cache:cooldown': { newValue: { until: clock + COOLDOWN_MS, authed: false } } });
    expect(await store.coolingDown(false)).toBe(true);
    store.applyChanges({ 'fipe-cache:cooldown': {} }); // cleared by "Tentar novamente" there
    expect(await store.coolingDown(false)).toBe(false);
  });

  it('keeps working when storage throws', async () => {
    const broken: Backend = { get: async () => { throw new Error('boom'); }, set: async () => { throw new Error('boom'); }, remove: async () => { throw new Error('boom'); } };
    FipeService.clearCache();
    useStore(new PersistentCache(broken, () => clock));
    expect((await FipeService.listYears(cars, '21', '100'))[0].code).toBe('2009-1');
  });
});
