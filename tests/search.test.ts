import { describe, expect, it } from 'vitest';
import { filterOptions, nextActiveIndex } from '../src/search';

const opts = (...names: string[]) => names.map((name, i) => ({ name, code: String(i) }));

describe('filterOptions', () => {
  const models = opts('Uno Mille Economy 1.0 Fire Flex 8V 4p', 'Uno 1.4 Evo', 'Palio Fire 1.0', 'Gol Mi 1.0', 'Strada Fire Cabine Estendida');

  it('returns everything (up to the limit) for an empty query', () => {
    const r = filterOptions(models, '  ', 3);
    expect(r.items).toHaveLength(3);
    expect(r.total).toBe(5);
  });

  it('keeps the catalog order for an empty query (no length ranking without a search term)', () => {
    const r = filterOptions(opts('Zeta Longo Nome Completo', 'Alfa', 'Beta Medio'), '');
    expect(r.items.map(o => o.name)).toEqual(['Zeta Longo Nome Completo', 'Alfa', 'Beta Medio']);
  });

  it('ignores case and accents on both sides', () => {
    const r = filterOptions(opts('Citroën C3', 'Fiat Uno'), 'CITROEN');
    expect(r.items.map(o => o.name)).toEqual(['Citroën C3']);
  });

  it('requires every token, in any order', () => {
    const r = filterOptions(models, '1.0 fire');
    expect(r.items.map(o => o.name)).toEqual(['Palio Fire 1.0', 'Uno Mille Economy 1.0 Fire Flex 8V 4p']);
  });

  it('keeps engine sizes as one token so "1.0" does not match "1.4"', () => {
    expect(filterOptions(models, 'uno 1.0').items.map(o => o.name)).toEqual(['Uno Mille Economy 1.0 Fire Flex 8V 4p']);
  });

  it('puts prefix matches first, then shorter names', () => {
    const r = filterOptions(opts('Gol City Fire', 'Fire', 'Palio Fire'), 'fire');
    expect(r.items.map(o => o.name)).toEqual(['Fire', 'Palio Fire', 'Gol City Fire']);
  });

  it('reports the full match count when the visible list is capped', () => {
    const many = opts(...Array.from({ length: 200 }, (_, i) => `Modelo ${i}`));
    const r = filterOptions(many, 'modelo', 50);
    expect(r.items).toHaveLength(50);
    expect(r.total).toBe(200);
  });

  it('returns nothing for a query that matches no option', () => {
    expect(filterOptions(models, 'nave espacial')).toEqual({ items: [], total: 0 });
  });
});

describe('nextActiveIndex', () => {
  it('wraps around with the arrow keys', () => {
    expect(nextActiveIndex(-1, 'ArrowDown', 3)).toBe(0);
    expect(nextActiveIndex(2, 'ArrowDown', 3)).toBe(0);
    expect(nextActiveIndex(-1, 'ArrowUp', 3)).toBe(2);
    expect(nextActiveIndex(0, 'ArrowUp', 3)).toBe(2);
  });

  it('jumps with Home/End and is inert for an empty list', () => {
    expect(nextActiveIndex(1, 'Home', 4)).toBe(0);
    expect(nextActiveIndex(1, 'End', 4)).toBe(3);
    expect(nextActiveIndex(0, 'ArrowDown', 0)).toBe(-1);
  });
});
