import { describe, expect, it } from 'vitest';
import { Backend } from '../src/persistent_cache';
import { emptyRecord, LotStore, lotKey, safeLotUrl, sanitize } from '../src/lot_store';

function memory(): Backend & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async keys => (keys ? Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]])) : { ...data }),
    set: async items => { Object.assign(data, items); },
    remove: async keys => { for (const k of keys) delete data[k]; },
  };
}

describe('lotKey', () => {
  it('identifies a lot by auction and number, whatever else is in the URL', () => {
    const a = 'https://www.freitasleiloeiro.com.br/Leiloes/LoteDetalhes?leilaoId=8120&loteNumero=3';
    expect(lotKey(a)).toBe('lot:8120-3');
    expect(lotKey(`${a}&utm_source=x#top`)).toBe('lot:8120-3');
    expect(lotKey('https://freitasleiloeiro.com.br/Leiloes/LoteDetalhes?loteNumero=3&leilaoId=8120')).toBe('lot:8120-3');
  });
  it('falls back to id, then to the path, and tolerates junk', () => {
    expect(lotKey('https://x.com.br/Leiloes/LoteDetalhes?id=7')).toBe('lot:id-7');
    expect(lotKey('https://x.com.br/Leiloes/Foo?a=1')).toBe('lot:/leiloes/foo?a=1');
    expect(lotKey('not a url')).toBe('lot:not a url');
  });
});

describe('safeLotUrl', () => {
  it('only lets https links to the auction site through', () => {
    expect(safeLotUrl('https://www.freitasleiloeiro.com.br/Leiloes/LoteDetalhes?id=1')).not.toBeNull();
    expect(safeLotUrl('https://freitasleiloeiro.com.br/x')).not.toBeNull();
    expect(safeLotUrl('javascript:alert(1)')).toBeNull();
    expect(safeLotUrl('http://www.freitasleiloeiro.com.br/x')).toBeNull();
    expect(safeLotUrl('https://freitasleiloeiro.com.br.evil.com/x')).toBeNull();
    expect(safeLotUrl('https://evil.com/?https://freitasleiloeiro.com.br')).toBeNull();
    expect(safeLotUrl('')).toBeNull();
  });
});

describe('sanitize', () => {
  const base = emptyRecord('u', 't');
  it('coerces hostile or corrupt storage into a valid record', () => {
    const r = sanitize({ fav: 'yes', target: -5, checks: ['edital', 'edital', 'bogus', 7], note: 'x'.repeat(5000), title: 9 }, base);
    expect(r).toMatchObject({ fav: false, target: 0, checks: ['edital'], title: 't' });
    expect(r.note).toHaveLength(2000);
  });
  it('survives non-objects', () => {
    expect(sanitize(null, base)).toEqual(base);
    expect(sanitize('x', base)).toEqual(base);
  });
});

describe('LotStore', () => {
  it('round-trips a record and stamps the save time', async () => {
    const backend = memory();
    const store = new LotStore(backend, () => 1234);
    await store.save('lot:1-1', { ...emptyRecord('https://x', 'Uno'), fav: true, target: 9000, checks: ['edital'], note: 'ok' });
    expect(await store.get('lot:1-1', '', '')).toMatchObject({ fav: true, target: 9000, checks: ['edital'], note: 'ok', savedAt: 1234 });
  });

  it('keeps what the writer stamped, so it can recognise its own change event', async () => {
    const backend = memory();
    await new LotStore(backend, () => 1).save('lot:1-1', { ...emptyRecord('u', 't'), fav: true }, 777);
    expect((backend.data['lot:1-1'] as { savedAt: number }).savedAt).toBe(777);
  });

  it('lists only favorites, newest first, ignoring unrelated keys', async () => {
    const backend = memory();
    let t = 0;
    const store = new LotStore(backend, () => ++t);
    await store.save('lot:1-1', { ...emptyRecord('u1', 'a'), fav: true });
    await store.save('lot:1-2', { ...emptyRecord('u2', 'b'), note: 'only a note' });
    await store.save('lot:1-3', { ...emptyRecord('u3', 'c'), fav: true });
    backend.data['fipe-cache:x'] = { v: 1 };
    expect((await store.favorites()).map(f => f.key)).toEqual(['lot:1-3', 'lot:1-1']);
  });

  it('unfavorite keeps notes, and removes the entry when nothing else remains', async () => {
    const backend = memory();
    const store = new LotStore(backend);
    await store.save('lot:1-1', { ...emptyRecord('u', 't'), fav: true, note: 'keep me' });
    await store.unfavorite('lot:1-1');
    expect(await store.get('lot:1-1', '', '')).toMatchObject({ fav: false, note: 'keep me' });
    await store.save('lot:1-2', { ...emptyRecord('u', 't'), fav: true });
    await store.unfavorite('lot:1-2');
    expect(Object.keys(backend.data)).toEqual(['lot:1-1']);
  });

  it('degrades to empty when storage throws', async () => {
    const broken: Backend = { get: async () => { throw new Error('x'); }, set: async () => { throw new Error('x'); }, remove: async () => { throw new Error('x'); } };
    const store = new LotStore(broken);
    expect(await store.favorites()).toEqual([]);
    expect(await store.get('lot:1', 'u', 't')).toEqual(emptyRecord('u', 't'));
    await expect(store.save('lot:1', { ...emptyRecord('u', 't'), fav: true })).resolves.toBeUndefined();
  });
});
