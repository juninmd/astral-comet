import { describe, expect, it } from 'vitest';
import { calculate, expandYear, parseCurrency, parseDescription } from '../src/lib';
import { Fees } from '../src/lib';

const fees: Fees = { towing: 1500, extraCosts: 0, adminFee: 1900, logisticsFee: 1416, atpvFee: 40, commissionRate: 0.05, ipvaFee: 0 };

describe('parseCurrency', () => {
  it.each([
    ['R$ 1.234,56', 1234.56],
    ['R$ 15.000,00', 15000],
    ['Lance: R$ 800,00 incremento', 800],
    ['R$0,99', 0.99],
    ['15000,5', 15000.5],
  ])('%s → %d', (text, value) => expect(parseCurrency(text)).toBe(value));
  it.each(['', 'abc', 'R$'])('invalid "%s" → 0', text => expect(parseCurrency(text)).toBe(0));
});

describe('parseDescription', () => {
  it('parses brand/model, YY/YY', () => {
    expect(parseDescription('FIAT/UNO MILLE, 08/09')).toEqual({ brand: 'FIAT', model: 'UNO MILLE', modelYear: 2009 });
  });
  it('skips the import prefix', () => {
    expect(parseDescription('I/VW/GOL 1.0 CITY, 12/13')).toEqual({ brand: 'VW', model: 'GOL 1.0 CITY', modelYear: 2013 });
  });
  it('handles 19xx years', () => {
    expect(parseDescription('VW/FUSCA, 74/75')?.modelYear).toBe(1975);
  });
  it('returns null for unparseable text', () => {
    expect(parseDescription('Sucata sem descrição')).toBeNull();
    expect(parseDescription('')).toBeNull();
  });
  it('expandYear: next year stays in this century', () => {
    expect(expandYear(27, new Date('2026-10-23'))).toBe(2027);
    expect(expandYear(28, new Date('2026-10-23'))).toBe(1928);
  });
});

describe('calculate', () => {
  it('sums every cost and computes profit', () => {
    const r = calculate(30000, 10000, fees);
    expect(r.commission).toBe(500);
    expect(r.totalCost).toBe(10000 + 500 + 1900 + 1416 + 0 + 40 + 1500);
    expect(r.profit).toBe(30000 - r.totalCost);
    expect(r.profitPercentage).toBeCloseTo((r.profit / r.totalCost) * 100);
  });
  it('page fees override settings', () => {
    const r = calculate(30000, 10000, fees, { commissionRate: 0.1, adminFee: 2000, logisticsFee: 0 });
    expect(r.commission).toBe(1000);
    expect(r.adminFee).toBe(2000);
    expect(r.logisticsFee).toBe(0);
    expect(r.commissionRate).toBe(0.1);
  });
  it('IPVA is charged only when not paid on the page', () => {
    expect(calculate(0, 0, { ...fees, ipvaFee: 800 }).ipvaFee).toBe(800);
    expect(calculate(0, 0, { ...fees, ipvaFee: 800 }, { ipvaPaid: true }).ipvaFee).toBe(0);
  });
  it('negative profit when FIPE is lower than the cost', () => {
    expect(calculate(5000, 10000, fees).profit).toBeLessThan(0);
  });
  it('zero bid and zero fees does not divide by zero', () => {
    const zero: Fees = { towing: 0, extraCosts: 0, adminFee: 0, logisticsFee: 0, atpvFee: 0, commissionRate: 0, ipvaFee: 0 };
    expect(calculate(1000, 0, zero).profitPercentage).toBe(0);
  });
});
