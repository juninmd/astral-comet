import { describe, expect, it } from 'vitest';
import { detectRisks } from '../src/risks';

const keys = (text: string) => detectRisks(text).map(r => r.key);

describe('detectRisks', () => {
  it('flags the conditions buyers are warned about', () => {
    expect(keys('FIAT/UNO, 08/09 - SUCATA com direito a documento')).toContain('scrap');
    expect(keys('Veículo recuperado de SINISTRO de média monta')).toContain('crash');
    expect(keys('Carro ALAGADO em enchente')).toContain('flood');
    expect(keys('Vendido sem documentação')).toContain('docs');
    expect(keys('Consta restrição judicial (RENAJUD)')).toContain('lien');
    expect(keys('Motor fundido')).toContain('engine');
  });

  it('ignores accents and case', () => {
    expect(keys('BAIXA DEFINITIVA registrada')).toContain('scrap');
    expect(keys('Média Monta')).toContain('crash');
  });

  it('does not flag negated statements', () => {
    expect(keys('Veículo sem sinistro e sem restrição judicial')).toEqual([]);
    expect(keys('Não é sucata, não alagado')).toEqual([]);
    expect(keys('livre de sinistro')).toEqual([]);
  });

  it('negations may have a couple of words in between', () => {
    expect(keys('Não consta restrição judicial')).toEqual([]);
    expect(keys('sem nenhum registro de sinistro')).toEqual([]);
    expect(keys('sem registro de sinistro')).toEqual([]);
  });

  it('a negation does not reach across punctuation to hide a real finding', () => {
    expect(keys('SEM GARANTIA, SINISTRADO')).toEqual(['crash']);
  });

  it('only a vehicle that does not run counts as mechanical trouble, not an accessory', () => {
    expect(keys('AR CONDICIONADO NÃO FUNCIONA')).toEqual([]);
    expect(keys('veículo não liga')).toEqual(['engine']);
  });

  it('flags debts the edital puts on the buyer, but not generic debt mentions', () => {
    expect(keys('Débitos de IPVA e multas por conta do arrematante')).toContain('debts');
    expect(keys('Os débitos serão quitados com o valor da arrematação.')).toEqual([]);
  });

  it('puts the most severe first and reports each rule once', () => {
    const risks = detectRisks('sem documentação. SUCATA. sucata. sinistro');
    expect(risks.map(r => r.key)).toEqual(['scrap', 'crash', 'docs']);
    expect(risks.map(r => r.level)).toEqual(['high', 'high', 'warn']);
  });

  describe('Freitas lot pages (conditions block copied in shape from real lots)', () => {
    const clauses = 'A CONCRETIZAÇÃO DA ARREMATAÇÃO, MEDIANTE EMISSÃO DA NOTA DE VENDA, SOMENTE SERÁ REALIZADA EM NOME DE QUEM PAGOU. '
      + 'DANOS, REPAROS, SUBSTITUIÇÕES E SINISTROS JÁ OCORRIDOS EM QUALQUER CLASSIFICAÇÃO DE MONTA OU TIPO, COMERCIALIZADO POR SEGURADORAS CORRERÃO P/C DO COMPRADOR / '
      + 'DÉBITOS ATE R$ 500,00 P/C DO COMPRADOR, VALOR EXCEDIDO P/C DO COMITENTE VENDEDOR';

    it('does not flag the auction-wide disclaimer that every lot carries', () => {
      expect(keys(`FIAT/SIENA 1.0, 21/21. IPVA 2026 PAGO / ${clauses}`)).toEqual(['debt-cap']);
    });

    it('still flags what is written about this lot before those clauses', () => {
      expect(keys(`*** VEIC. ZERO KM***, SINISTRADO / PEQ. MONTA, SEM GARANTIA / ${clauses}`)).toEqual(['crash', 'debt-cap']);
      expect(keys(`DANOS ESTRUTURAIS (CAIXA DE AR), REGULARIZAÇÕES P/C DO COMPRADOR / ${clauses}`)).toContain('structure');
      expect(keys(`MOTOR BATENDO VÁLVULAS / ${clauses}`)).toContain('engine');
      expect(keys(`SEM CADASTRO NOS ORGÃOS DE TRANSITO, SEM EMPLACAMENTO, SEM DIREITO A DOCUMENTAÇÃO / ${clauses}`)).toContain('docs');
    });

    it('drops the clauses block by block: a standalone clause line must not hide the observations that follow it', () => {
      // Real pages list the fee items (one of which starts with the clause) before the lot's own observations.
      const blocks = [
        'Despesas de logística no valor de R$ 350,00 por conta do comprador;',
        'A concretização da arrematação, mediante emissão da nota de venda, somente será realizada em nome de quem pagou',
        `DANOS ESTRUTURAIS (CAIXA DE AR), REGULARIZAÇÕES P/C DO COMPRADOR / ${clauses}`,
      ];
      expect(detectRisks(blocks).map(r => r.key)).toEqual(['structure', 'debt-cap']);
      expect(detectRisks(blocks.slice(0, 2).concat(`PARTE ELÉTRICA DANIFICADA / ${clauses}`)).map(r => r.key)).toEqual(['debt-cap']);
    });

    it('ignores the disclaimer variant that ends a list of nouns, but not a real sinistro', () => {
      expect(keys('ESTRUTURA, FUNCIONAMENTO, REPAROS, REPOSIÇÕES, AUSÊNCIAS DE PEÇAS, SUBSTITUIÇÕES E SINISTROS R$ 335.000,00')).toEqual([]);
      expect(keys('Recuperado de SINISTRO')).toEqual(['crash']);
      expect(keys('veículo SINISTRADO')).toEqual(['crash']);
      expect(keys('histórico com sinistros')).toEqual(['crash']);
    });

    it('negation still works across text blocks that were split by markup', () => {
      expect(keys('veículo sem sinistro')).toEqual([]);
      expect(detectRisks(['veículo sem', 'sinistro']).map(r => r.key)).toEqual([]);
    });

    it('states the debt the buyer carries, with the amount from the edital', () => {
      expect(detectRisks(clauses)).toEqual([{ key: 'debt-cap', label: 'Débitos até R$ 500,00 por conta do comprador', level: 'warn' }]);
    });

    it('a stray "sinistros já ocorridos" without the surrounding clauses is still the disclaimer', () => {
      expect(keys('veículo vendido no estado, incluindo sinistros já ocorridos')).toEqual([]);
    });
  });

  it('returns nothing for an ordinary lot', () => {
    expect(detectRisks('FIAT/UNO MILLE ECONOMY, 08/09. Conservado. IPVA 2026 PAGO')).toEqual([]);
    expect(detectRisks('')).toEqual([]);
  });
});
