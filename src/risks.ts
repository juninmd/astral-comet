export type RiskLevel = 'high' | 'warn';
export interface Risk { key: string; label: string; level: RiskLevel }

// Words buyers are told to check before bidding (edital, Detran/Renajud, sinistro/sucata). Matched on
// accent-free lowercase text. A negation up to two words before the term cancels it ("sem sinistro",
// "nao consta restricao judicial", "sem nenhum registro de sinistro").
const NOT = '(?<!\\b(?:sem|nao|nenhum|nenhuma|livre de)(?: [a-z]+){0,2} )';
const flag = (key: string, label: string, level: RiskLevel, body: string) => ({ key, label, level, pattern: new RegExp(`${NOT}(?:${body})`) });
const RULES: { key: string; label: string; level: RiskLevel; pattern: RegExp }[] = [
  flag('scrap', 'Sucata / baixa definitiva', 'high', 'sucata|baixa definitiva|baixado definitivamente'),
  // "sinistros ja ocorridos em qualquer classificacao de monta" is the auction-wide disclaimer, not a finding. It also
  // appears as the tail of a list of nouns ("..., SUBSTITUICOES E SINISTROS"), hence no plural right after "e ".
  flag('crash', 'Sinistro', 'high', 'sinistrad[oa]|sinistro\\b|(?<!\\be )sinistros\\b(?! ja ocorrid)|grande monta|media monta'),
  flag('flood', 'Alagamento', 'high', 'alagad|alagamento|enchente|inundad'),
  flag('structure', 'Danos estruturais', 'high', 'danos? estrutura'),
  { key: 'docs', label: 'Sem documentação / cadastro', level: 'warn', pattern: /sem (?:direito a )?(?:documento|documentacao|crv|crlv)|sem cadastro nos orgaos|sem emplacamento|documentacao irregular/ },
  flag('lien', 'Restrição judicial (Renajud)', 'warn', 'renajud|restricao judicial|bloqueio judicial'),
  { key: 'debts', label: 'Débitos por conta do arrematante', level: 'warn', pattern: /debitos?[^.;]{0,60}(?:por conta|responsabilidade)[^.;]{0,15}(?:arrematante|comprador)/ },
  // "veiculo nao liga", not "ar condicionado nao funciona".
  { key: 'engine', label: 'Mecânica comprometida', level: 'warn', pattern: /motor (?:fundido|batido|batendo|travado)|sem motor|(?:veiculo|moto|carro) nao (?:funciona|liga)/ },
];

// Freitas repeats the same long conditions on every lot. Inside one text block they start here; what comes before is about this lot.
const AUCTION_WIDE_CLAUSES = /a concretizacao da arrematacao/;
// "DÉBITOS ATE R$ 500,00 P/C DO COMPRADOR": a cost the buyer carries, stated inside those clauses.
const DEBT_CAP = /debitos? ate (r\$\s*[\d.]+,\d{2}) p\/?\s*c do comprador/;

const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Red flags found in a lot's text, most severe first. Pass the page's text blocks (one per text node) so the
 * auction-wide clauses can be dropped block by block. Never decides anything: it only points where to read the edital.
 */
export function detectRisks(input: string | readonly string[]): Risk[] {
  const blocks = (typeof input === 'string' ? [input] : input).map(fold);
  const lotText = blocks.map(block => {
    const cut = block.search(AUCTION_WIDE_CLAUSES);
    return cut === -1 ? block : block.slice(0, cut);
  }).join(' ');

  const found: Risk[] = RULES
    .filter(rule => rule.pattern.test(lotText))
    .map(({ key, label, level }) => ({ key, label, level }));

  const cap = blocks.join(' ').match(DEBT_CAP)?.[1];
  if (cap) found.push({ key: 'debt-cap', label: `Débitos até ${cap.toUpperCase().replace(/\s+/g, ' ')} por conta do comprador`, level: 'warn' });

  return found.sort((a, b) => Number(b.level === 'high') - Number(a.level === 'high'));
}
