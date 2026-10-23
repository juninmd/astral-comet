import { describe, expect, it } from 'vitest';
import { parseDescription } from '../src/lib';
import { pickBrand, rankModels } from '../src/model_match';

// FIPE model names below are copied from the real catalog; the auction strings from real lot descriptions.
const fipe = (...names: string[]) => names.map((modelo, i) => ({ modelo, valor: String(i + 1) }));
const best = (names: string[], model: string, brand = '') => rankModels(fipe(...names), model, 5, brand)[0];

describe('parseDescription: imported lots ("I/TOYOTA HILUX ...")', () => {
  it('takes the brand from the first word(s) after the import marker', () => {
    expect(parseDescription('I/TOYOTA HILUX SWDMDA4JD, 19/20,')).toEqual({ brand: 'TOYOTA', model: 'HILUX SWDMDA4JD', modelYear: 2020 });
    expect(parseDescription('I/M.BENZ A200 SD HI, 19/20,')).toEqual({ brand: 'M.BENZ', model: 'A200 SD HI', modelYear: 2020 });
    expect(parseDescription('I/LR VELAR P250 SE RDYN, 18/18')).toMatchObject({ brand: 'LR', model: 'VELAR P250 SE RDYN' });
  });
  it('keeps two-word brands together', () => {
    expect(parseDescription('IMP/ALFA ROMEO 164 3.0 V6, 94/95')).toEqual({ brand: 'ALFA ROMEO', model: '164 3.0 V6', modelYear: 1995 });
    expect(parseDescription('I/LAND ROVER FREELANDER 2 S I6, 10/10')).toMatchObject({ brand: 'LAND ROVER', model: 'FREELANDER 2 S I6' });
  });
  it('leaves the other formats alone', () => {
    expect(parseDescription('I/VW/GOL 1.0 CITY, 12/13')).toEqual({ brand: 'VW', model: 'GOL 1.0 CITY', modelYear: 2013 });
    expect(parseDescription('SR/FACCHINI SRF 4CB, 22/23')).toMatchObject({ brand: 'SR', model: 'FACCHINI SRF 4CB' });
  });
});

describe('pickBrand (brand de-para)', () => {
  const brands = [
    { nome: 'VW - VolksWagen', valor: '59' }, { nome: 'GM - Chevrolet', valor: '23' }, { nome: 'Caoa Chery/Chery', valor: '161' },
    { nome: 'HARLEY-DAVIDSON', valor: '77' }, { nome: 'Jaguar', valor: '28' }, { nome: 'Mercedes-Benz', valor: '39' }, { nome: 'Land Rover', valor: '27' },
  ];
  it.each([['VW', '59'], ['CHEV', '23'], ['GM', '23'], ['CAOACHERY', '161'], ['H-D', '77'], ['JAG', '28'], ['M.BENZ', '39'], ['LR', '27'], ['land rover', '27']])(
    '%s → %s', (brand, code) => expect(pickBrand(brands, brand)).toBe(code));
  it('returns null for a brand FIPE does not list', () => {
    expect(pickBrand(brands, 'BASHAN')).toBeNull();
    expect(pickBrand(brands, '')).toBeNull();
  });
});

describe('rankModels: names as the Detran prints them (cut, glued, abbreviated)', () => {
  it('reads engine codes and cut words: "HB20S 10M EVOLUT" is the 1.0 manual Evolution', () => {
    const names = ['HB20S Impress 1.6 Flex 16V Aut.', 'HB20S Evolution 1.6 Flex 16V Aut.', 'HB20S Evolution 1.0 Flex 12V Mec.', 'HB20 Evolution 1.0 Flex 12V Mec.'];
    expect(best(names, 'HB20S 10M EVOLUT').modelo).toBe('HB20S Evolution 1.0 Flex 12V Mec.');
  });
  it('reads "10" as 1.0 and "EXPR" as Expression', () => {
    const names = ['SANDERO Authentique Hi-Flex 1.6 8V 5p', 'SANDERO Expression Flex 1.0 12V 5p', 'SANDERO Expression Hi-Flex 1.6 16V 5p'];
    expect(best(names, 'SANDERO EXPR 10').modelo).toBe('SANDERO Expression Flex 1.0 12V 5p');
  });
  it('splits glued words: "CRETA1TF LIMITED", "ACTROS 2548S", "A4X2"', () => {
    expect(best(['Creta Action 1.6 16V Flex Aut.', 'Creta Limited 1.0 TB 12V Flex Aut.'], 'CRETA1TF LIMITED').modelo).toBe('Creta Limited 1.0 TB 12V Flex Aut.');
    expect(best(['Actros 2546 LS 6x2 2p (diesel)', 'Actros 2548 S 6x2 2p (diesel)(E6)'], 'ACTROS 2548S').modelo).toBe('Actros 2548 S 6x2 2p (diesel)(E6)');
    expect(best(['G-420 A 6x2 2p (diesel)(E6)', 'G-420 A 4x2 2p (diesel)'], 'G 420 A4X2').modelo).toBe('G-420 A 4x2 2p (diesel)');
  });
  it('tells motorcycles by the number: "CB300F" is not a CB 250', () => {
    expect(best(['CB 250F Twister', 'CB 300F Twister Flex', 'CB 500F'], 'CB300F TWISTER CBS').modelo).toBe('CB 300F Twister Flex');
  });
  it('matches a family word later in the FIPE name ("Range R. VELAR") and a family cut ("MEGANEGT")', () => {
    expect(best(['Range R. EVOQUE 2.0', 'Range R. VELAR SE 2.0 4x4 TB 250cv Aut.'], 'VELAR P250 SE RDYN', 'LR').modelo).toBe('Range R. VELAR SE 2.0 4x4 TB 250cv Aut.');
    expect(best(['Megane Hatch RXE/Egeus 1.6 16V', 'Mégane Sedan 2.0'], 'MEGANEGT DYN 16', 'RENAULT').modelo).toBe('Megane Hatch RXE/Egeus 1.6 16V');
  });
  it('applies the per-brand rewrites (KGOO, C4L, EPACE, Mercedes class letters)', () => {
    expect(best(['Kangoo Express Hi-Flex 1.6 16V', 'Clio 1.0'], 'KGOO EXPRESS16', 'RENAULT').modelo).toBe('Kangoo Express Hi-Flex 1.6 16V');
    expect(best(['C4 VTR 2.0 16V', 'C4 LOUNGE Tendance 1.6 Turbo 4p Aut'], 'C4L A 2L TEND', 'CITROEN').modelo).toBe('C4 LOUNGE Tendance 1.6 Turbo 4p Aut');
    expect(best(['F-Pace 2.0', 'E-Pace R-Dyn. SE 2.0 AWD 250cv Aut/Flex.'], 'EPACE P250 S RDY', 'JAG').modelo).toBe('E-Pace R-Dyn. SE 2.0 AWD 250cv Aut/Flex.');
    expect(best(['Classe A 200 1.6 TB 16V Style', 'C-300 Sport 2.0 16V Aut.'], 'C300', 'M.BENZ').modelo).toBe('C-300 Sport 2.0 16V Aut.');
  });
  it('prefers the plain car over the van, chassis or EV that shares the family word', () => {
    expect(best(['Gol Furgao 1.0 mi', 'Gol 1.0 Flex 12V 5p'], 'GOL 1.0').modelo).toBe('Gol 1.0 Flex 12V 5p');
    expect(best(['S10 Blazer 2.4 MPFI', 'S10 P-Up Advantage 2.4 MPFI CD'], 'S10 ADV FD2', 'GM').modelo).toBe('S10 P-Up Advantage 2.4 MPFI CD');
  });
  it('still honours a van when the auction says so', () => {
    expect(best(['Gol 1.0 Flex 12V 5p', 'Gol Furgao 1.0 mi'], 'GOL FURGAO 1.0').modelo).toBe('Gol Furgao 1.0 mi');
  });

  describe('approximate: only the family word matched', () => {
    it('flags a guess and does not flag a match with variant evidence', () => {
      expect(best(['Opala Comodoro/Comod. SLE  4.1/2.5', 'Opala L/SL/SS/ 2.5/4.1'], 'OPALA LUXO').approximate).toBe(true);
      expect(best(['Uno Mille Economy 1.0 Fire Flex 8V 4p'], 'UNO MILLE ECONOMY').approximate).toBe(false);
    });
  });

  describe('never invents a match', () => {
    it('ignores models that share no family word, and lone letters cut out of glued tokens', () => {
      expect(rankModels(fipe('Palio Fire 1.0', 'Uno Mille 1.0'), 'NAVE ESPACIAL', 5)).toEqual([]);
      expect(rankModels(fipe('SHE-S 3000W (Elétrica)', 'XY 50Q VMV'), '400S S', 5, 'SHINERAY')).toEqual([]);
      expect(rankModels(fipe('Uno Mille 1.0'), '', 5)).toEqual([]);
    });
    it('needs the family word: engine size, flex and turbo alone never pick another model', () => {
      expect(rankModels(fipe('ONIX HATCH 1.0 Turbo Flex 12V Aut.', 'Cruze LT 1.4 16V Turbo Flex Aut.'), 'TRACKER 1.0 TURBO FLEX AUT', 5, 'GM')).toEqual([]);
      expect(rankModels(fipe('Palio Fire 1.0', 'Uno Mille 1.0'), 'SIENA 1.0 FIRE FLEX', 5, 'FIAT')).toEqual([]);
      expect(rankModels(fipe('Polo 1.0 Flex 12V 5p', 'Gol 1.0 Flex 12V 5p'), 'FOX 1.0 FLEX 12V', 5, 'VW')).toEqual([]);
    });
    it('does not let a bare number or letter carry a match', () => {
      expect(rankModels(fipe('Ka 1.0', 'Fiesta 1.6 Mec.'), 'A 10 M', 5)).toEqual([]);
    });
  });
});
