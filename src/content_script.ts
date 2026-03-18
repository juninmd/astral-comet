import { FipeService } from './fipe_service';
import { CalculationResult } from './types';

const VEHICLE_DESCRIPTION_PATTERN = /(?:[^/\s,]+\/)?[^/,]+\/[^,]+,\s*\d{2}\/\d{2}/i;
const CURRENCY_PATTERN = /R\$\s*[\d.]+,\d{2}/i;
const DETAIL_PANEL_ID = 'fipe-detail-helper';
const AUTO_LOOKUP_KEY = 'astralCometAutoLookup';
const COMMISSION_PATTERN = /(\d+(?:\.\d+)?)\s*%\s*(?:referente à comissão|comissão do leiloeiro)/i;
const ADMIN_FEE_PATTERN = /Despesas administrativas[^,]*?(?:Organização e Depósito)?[^,]*?no valor de\s*(R\$\s*[\d.]+,\d{2})/i;
const LOGISTICS_FEE_PATTERN = /Despesas de logística[^,]*?no valor de\s*(R\$\s*[\d.]+,\d{2})/i;

const DEFAULT_TOWING = 1500;
const DEFAULT_EXTRA_COSTS = 0;
const DEFAULT_ADMIN_FEE = 1900;
const DEFAULT_ATPV_FEE = 40;
const DEFAULT_COMMISSION_RATE = 5;
const DEFAULT_IPVA_FEE = 0;

async function getSettings(): Promise<{ towing: number; extraCosts: number; adminFee: number; logisticsFee: number; atpvFee: number; commissionRate: number; ipvaFee: number }> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['towing', 'extraCosts', 'adminFee', 'logisticsFee', 'atpvFee', 'commissionRate', 'ipvaFee'], (result) => {
      resolve({
        towing: (result.towing as number) ?? DEFAULT_TOWING,
        extraCosts: (result.extraCosts as number) ?? DEFAULT_EXTRA_COSTS,
        adminFee: (result.adminFee as number) ?? DEFAULT_ADMIN_FEE,
        logisticsFee: (result.logisticsFee as number) ?? 0,
        atpvFee: (result.atpvFee as number) ?? DEFAULT_ATPV_FEE,
        commissionRate: (result.commissionRate as number) ?? DEFAULT_COMMISSION_RATE / 100,
        ipvaFee: (result.ipvaFee as number) ?? DEFAULT_IPVA_FEE,
      });
    });
  });
}

async function getAutoLookupEnabled(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([AUTO_LOOKUP_KEY], (result) => {
      if (typeof result[AUTO_LOOKUP_KEY] === 'boolean') {
        resolve(result[AUTO_LOOKUP_KEY]);
      } else {
        resolve(true);
      }
    });
  });
}

async function setAutoLookupEnabled(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [AUTO_LOOKUP_KEY]: enabled }, () => resolve());
  });
}

async function setIpvaFee(value: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ ipvaFee: value }, () => resolve());
  });
}

const IPVA_PAID_PATTERN = /IPVA\s*\d{0,4}\s*PAGO/i;

async function extractFeesFromPage(): Promise<{ adminFee?: number; logisticsFee?: number; commissionRate?: number; ipvaPaid?: boolean }> {
  const result: { adminFee?: number; logisticsFee?: number; commissionRate?: number; ipvaPaid?: boolean } = {};

  const bodyText = document.body?.textContent || '';
  if (IPVA_PAID_PATTERN.test(bodyText)) {
    result.ipvaPaid = true;
  }

  const lists = document.querySelectorAll('ul.small.text-secondary');
  for (let i = 0; i < lists.length; i++) {
    const text = lists[i].textContent || '';

    if (IPVA_PAID_PATTERN.test(text)) {
      result.ipvaPaid = true;
    }

    const commissionMatch = text.match(COMMISSION_PATTERN);
    if (commissionMatch) {
      const rate = parseFloat(commissionMatch[1]) / 100;
      if (!Number.isNaN(rate)) {
        result.commissionRate = rate;
      }
    }

    const adminMatch = text.match(ADMIN_FEE_PATTERN);
    if (adminMatch) {
      result.adminFee = parseCurrency(adminMatch[1]);
    }

    const logisticsMatch = text.match(LOGISTICS_FEE_PATTERN);
    if (logisticsMatch) {
      result.logisticsFee = parseCurrency(logisticsMatch[1]);
    }
  }

  return result;
}

function getTextContent(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function isVisible(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  return Boolean(htmlElement.offsetWidth || htmlElement.offsetHeight || htmlElement.getClientRects().length);
}

function extractCurrency(text: string): string | null {
  return text.match(CURRENCY_PATTERN)?.[0] || null;
}

function parseCurrency(text: string): number {
  const currency = extractCurrency(text) || text;
  const normalized = currency
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  return normalized ? parseFloat(normalized) : 0;
}

function parseDescription(description: string): { brand: string; model: string; modelYear: number } | null {
  const match = description.match(/^(?:[^/]+\/)?([^/]+)\/(.+?),\s*(\d{2})\/(\d{2})/);
  if (!match) return null;

  return {
    brand: match[1].trim(),
    model: match[2].trim(),
    modelYear: parseInt(`20${match[4]}`, 10),
  };
}

function findElementsByText(root: ParentNode, pattern: RegExp): HTMLElement[] {
  const matches: HTMLElement[] = [];

  if (root instanceof Element) {
    const rootText = getTextContent(root);
    if (rootText && pattern.test(rootText)) {
      matches.push(root as HTMLElement);
    }
  }

  const elements = root.querySelectorAll('div, span, p, h1, h2, h3, h4, td, li, small, strong, a');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (!isVisible(element)) continue;
    const text = getTextContent(element);
    if (!text || text.length > 600) continue;
    if (pattern.test(text)) {
      matches.push(element as HTMLElement);
    }
  }

  return matches;
}

function findDescriptionElement(root: ParentNode): HTMLElement | null {
  const selectorCandidates = [
    '.cardLote-descVeic',
    '[class*="descVeic"]',
    '[class*="Descricao"]',
    '[class*="descricao"]',
    'div[style*="text-align:justify"]',
  ];

  for (const selector of selectorCandidates) {
    const elements = root.querySelectorAll(selector);
    for (let index = 0; index < elements.length; index += 1) {
      const text = getTextContent(elements[index]);
      if (VEHICLE_DESCRIPTION_PATTERN.test(text)) {
        return elements[index] as HTMLElement;
      }
    }
  }

  const textMatches = findElementsByText(root, VEHICLE_DESCRIPTION_PATTERN);
  return textMatches.find(element => getTextContent(element).length < 250) || null;
}

function createManualModal() {
  const existing = document.querySelector('.fipe-modal-overlay');
  if (existing) return existing as HTMLElement;

  const overlay = document.createElement('div');
  overlay.className = 'fipe-modal-overlay';
  overlay.innerHTML = `
    <div class="fipe-modal">
      <h3>Consultar FIPE</h3>
      <div class="fipe-modal-row">
        <label>Marca<span>*</span><input name="brand" type="text" autocomplete="off" /></label>
      </div>
      <div class="fipe-modal-row">
        <label>Modelo<span>*</span><input name="model" type="text" autocomplete="off" /></label>
      </div>
      <div class="fipe-modal-row">
        <label>Ano<span>*</span><input name="year" type="number" min="1900" max="2100" /></label>
      </div>
      <div class="fipe-modal-row">
        <label>IPVA (se não pago)<span></span><input name="ipva" type="number" min="0" step="0.01" placeholder="0" /></label>
      </div>
      <div class="fipe-modal-actions">
        <button type="button" class="fipe-modal-cancel">Cancelar</button>
        <button type="button" class="fipe-modal-submit">Consultar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  return overlay;
}

function closeManualModal(overlay: HTMLElement) {
  overlay.remove();
}

function showManualModal(
  defaults: { brand?: string; model?: string; modelYear?: number; ipvaFee?: number } | null,
  onSubmit: (brand: string, model: string, year: number, ipvaFee: number) => void
) {
  const overlay = createManualModal();
  const brandInput = overlay.querySelector<HTMLInputElement>('input[name="brand"]')!;
  const modelInput = overlay.querySelector<HTMLInputElement>('input[name="model"]')!;
  const yearInput = overlay.querySelector<HTMLInputElement>('input[name="year"]')!;
  const ipvaInput = overlay.querySelector<HTMLInputElement>('input[name="ipva"]')!;
  const cancelBtn = overlay.querySelector<HTMLButtonElement>('.fipe-modal-cancel')!;
  const submitBtn = overlay.querySelector<HTMLButtonElement>('.fipe-modal-submit')!;

  brandInput.value = defaults?.brand ?? '';
  modelInput.value = defaults?.model ?? '';
  yearInput.value = defaults?.modelYear ? String(defaults.modelYear) : '';
  ipvaInput.value = defaults?.ipvaFee ? String(defaults.ipvaFee) : '';

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  cancelBtn.onclick = () => close();
  submitBtn.onclick = () => {
    const brand = brandInput.value.trim();
    const model = modelInput.value.trim();
    const year = parseInt(yearInput.value, 10);
    const ipvaFee = parseFloat(ipvaInput.value.replace(',', '.')) || 0;
    if (!brand || !model || Number.isNaN(year)) return;
    onSubmit(brand, model, year, ipvaFee);
    close();
  };

  document.addEventListener('keydown', onKeyDown);
}

async function renderWithMode(container: HTMLElement, description: string, bidText: string) {
  const auto = await getAutoLookupEnabled();
  const settings = await getSettings();
  const controls = container.querySelector<HTMLElement>('.fipe-controls');
  if (!controls) return;

  controls.innerHTML = '';

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'fipe-toggle';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = auto;
  toggleLabel.appendChild(toggle);
  toggleLabel.appendChild(document.createTextNode('Consulta automática'));

  const manualButton = document.createElement('button');
  manualButton.type = 'button';
  manualButton.className = 'fipe-manual-btn';
  manualButton.textContent = 'Selecionar veículo';

  toggle.addEventListener('change', async () => {
    await setAutoLookupEnabled(toggle.checked);
    scanPage();
  });

  manualButton.addEventListener('click', () => {
    const parsed = parseDescription(description);
    showManualModal({ ...parsed, ipvaFee: settings.ipvaFee }, async (brand, model, year, ipvaFee) => {
      await setIpvaFee(ipvaFee);
      await renderEvaluation(container, description, bidText, { brand, model, modelYear: year });
    });
  });

  controls.appendChild(toggleLabel);
  controls.appendChild(manualButton);

  if (auto) {
    await renderEvaluation(container, description, bidText);
  } else {
    const parsed = parseDescription(description);
    const resultsEl = getResultsContainer(container);
    resultsEl.innerHTML = `
      <div class="fipe-row">
        <span class="fipe-label">Modo manual:</span>
        <span class="fipe-value">${parsed ? `${parsed.brand} / ${parsed.model} (${parsed.modelYear})` : 'Nenhum veículo detectado'}</span>
      </div>
      <div class="fipe-row">
        <span class="fipe-label"></span>
        <button class="fipe-manual-open">Abrir seleção</button>
      </div>
    `;

    const openBtn = resultsEl.querySelector<HTMLButtonElement>('.fipe-manual-open');
    openBtn?.addEventListener('click', () => {
      showManualModal({ ...parsed, ipvaFee: settings.ipvaFee }, async (brand, model, year, ipvaFee) => {
        await setIpvaFee(ipvaFee);
        await renderEvaluation(container, description, bidText, { brand, model, modelYear: year });
      });
    });
  }
}

function findBidText(root: ParentNode): string {
  for (const selector of ['#hdMaiorLance', '#dvMaiorLance', '[id*="MaiorLance"]', '[class*="MaiorLance"]']) {
    const elements = root.querySelectorAll(selector);
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      if (selector !== '#hdMaiorLance' && !isVisible(element)) continue;

      const inputValue = (element as HTMLInputElement).value;
      if (inputValue) {
        const normalized = inputValue.replace(',', '.');
        const value = parseFloat(normalized);
        if (value > 0) {
          return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
      }

      const text = getTextContent(element);
      const currency = extractCurrency(text);
      if (currency) return currency;
    }
  }

  const candidates = findElementsByText(root, CURRENCY_PATTERN)
    .map(element => getTextContent(element))
    .filter(text => !/incremento/i.test(text));

  const currentBid = candidates.find(text => /maior lance|lance atual/i.test(text));
  if (currentBid) return extractCurrency(currentBid) || '0';

  const initialBid = candidates.find(text => /lance inicial/i.test(text));
  if (initialBid) return extractCurrency(initialBid) || '0';

  return extractCurrency(candidates[0] || '') || '0';
}

function ensureContainer(host: HTMLElement, insertionTarget: HTMLElement, id?: string): HTMLElement {
  let container = id
    ? host.querySelector<HTMLElement>(`#${id}`)
    : host.querySelector<HTMLElement>('.fipe-helper-container[data-role="lot"]');

  if (!container) {
    container = document.createElement('div');
    container.className = 'fipe-helper-container';
    container.dataset.role = 'lot';
    if (id) container.id = id;
    insertionTarget.appendChild(container);
  }

  // Ensure structure supports the new manual/auto UI.
  let controls = container.querySelector<HTMLElement>('.fipe-controls');
  if (!controls) {
    controls = document.createElement('div');
    controls.className = 'fipe-controls';
    container.prepend(controls);
  }

  let results = container.querySelector<HTMLElement>('.fipe-results');
  if (!results) {
    results = document.createElement('div');
    results.className = 'fipe-results';
    container.appendChild(results);
  }

  return container;
}

function getResultsContainer(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('.fipe-results') ?? container;
}

function updateResults(container: HTMLElement, results: CalculationResult) {
  const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const isPositive = results.profit > 0;
  const resultsEl = getResultsContainer(container);

  container.style.borderLeftColor = isPositive ? '#00c853' : '#ff5252';
  resultsEl.innerHTML = `
    <div class="fipe-row">
      <span class="fipe-label">Lance (Maior/Inicial):</span>
      <span class="fipe-value">${formatter.format(results.bidValue)}</span>
    </div>
    <div class="fipe-row">
      <span class="fipe-label">Comissão Leiloeiro (5%):</span>
      <span class="fipe-value">${formatter.format(results.commission)}</span>
    </div>
    <div class="fipe-row">
      <span class="fipe-label">Despesas Adm/Org/Dep:</span>
      <span class="fipe-value">${formatter.format(results.adminFee)}</span>
    </div>
    <div class="fipe-row">
      <span class="fipe-label">Despesas Logística:</span>
      <span class="fipe-value">${formatter.format(results.logisticsFee)}</span>
    </div>
    <div class="fipe-row">
      <span class="fipe-label">Custos Extras:</span>
      <span class="fipe-value">${formatter.format(results.extraCosts)}</span>
    </div>
    <div class="fipe-row">
      <span class="fipe-label">ATPV-e:</span>
      <span class="fipe-value">${formatter.format(results.atpvFee)}</span>
    </div>
    <div class="fipe-row">
      <span class="fipe-label">Guincho (Est.):</span>
      <span class="fipe-value">${formatter.format(results.towing)}</span>
    </div>
    ${results.ipvaFee > 0 ? `
      <div class="fipe-row">
        <span class="fipe-label">IPVA (não pago):</span>
        <span class="fipe-value">${formatter.format(results.ipvaFee)}</span>
      </div>
    ` : ''}
    <div class="fipe-row" style="font-weight:700">
      <span class="fipe-label">Custo Total:</span>
      <span class="fipe-value">${formatter.format(results.totalCost)}</span>
    </div>
    <div class="fipe-row" style="margin-top:8px;border-top:1px solid #ccc;padding-top:8px">
      <span class="fipe-label">Valor FIPE (Opcional):</span>
      <span class="fipe-value">${formatter.format(results.fipeValue)}</span>
    </div>
    <div class="fipe-profit ${isPositive ? '' : 'negative'}">
      <span class="fipe-label">Lucro Estimado:</span>
      <span class="fipe-value">${formatter.format(results.profit)}</span>
      <span class="fipe-badge ${isPositive ? '' : 'negative'}">${results.profitPercentage.toFixed(1)}%</span>
    </div>
  `;
}

async function calculateProfit(fipe: number, bid: number): Promise<CalculationResult> {
  const settings = await getSettings();
  const pageFees = await extractFeesFromPage();

  const commissionRate = pageFees.commissionRate ?? settings.commissionRate;
  const commission = bid * commissionRate;
  const adminFee = pageFees.adminFee ?? settings.adminFee;
  const logisticsFee = pageFees.logisticsFee ?? settings.logisticsFee;

  const ipvaPaid = pageFees.ipvaPaid ?? false;
  const ipvaCost = ipvaPaid ? 0 : settings.ipvaFee;

  const totalCost = bid + commission + adminFee + logisticsFee + settings.extraCosts + settings.atpvFee + settings.towing + ipvaCost;
  const profit = fipe - totalCost;
  const profitPercentage = totalCost > 0 ? (profit / totalCost) * 100 : 0;

  return {
    fipeValue: fipe,
    bidValue: bid,
    commission,
    adminFee,
    logisticsFee,
    extraCosts: settings.extraCosts,
    atpvFee: settings.atpvFee,
    towing: settings.towing,
    ipvaFee: ipvaCost,
    totalCost,
    profit,
    profitPercentage,
  };
}

async function renderEvaluation(
  container: HTMLElement,
  description: string,
  bidText: string,
  overrideParsed?: { brand: string; model: string; modelYear: number }
) {
  const parsed = overrideParsed ?? parseDescription(description);
  const resultsEl = getResultsContainer(container);

  if (!parsed) {
    resultsEl.innerHTML = '<div class="fipe-row"><span class="fipe-label fipe-not-found">Não foi possível interpretar o veículo</span></div>';
    return;
  }

  const bidValue = parseCurrency(bidText);
  const cacheKey = `${parsed.brand}|${parsed.model}|${parsed.modelYear}|${bidValue}`;
  if (container.dataset.cacheKey === cacheKey && container.dataset.state === 'done') {
    return;
  }

  if (container.dataset.state === 'loading' && container.dataset.cacheKey === cacheKey) {
    return;
  }

  container.dataset.state = 'loading';
  container.dataset.cacheKey = cacheKey;
  resultsEl.innerHTML = '<div class="fipe-row fipe-loading"><span class="fipe-label">Consultando FIPE...</span></div>';

  const fipeData = await FipeService.getPrice(parsed.brand, parsed.model, parsed.modelYear);

  if (!fipeData) {
    const results = await calculateProfit(0, bidValue);
    updateResults(container, results);
    return;
  }

  const fipeValue = parseCurrency(fipeData.valor);
  const results = await calculateProfit(fipeValue, bidValue);
  updateResults(container, results);
  container.dataset.state = 'done';
}

function findLotCards(): HTMLElement[] {
  const cards = new Set<HTMLElement>();

  document
    .querySelectorAll('.cardlote, .cardLote, [class*="cardLote"], [class*="card-lote"], a[href*="LoteDetalhes"]')
    .forEach(element => {
      const host = element instanceof HTMLAnchorElement
        ? element.closest('.card, article, li, [class*="card"], [class*="col-"]')
        : element;

      if (!(host instanceof HTMLElement)) return;
      if (!findDescriptionElement(host)) return;
      cards.add(host);
    });

  return [...cards];
}

async function processLot(card: HTMLElement) {
  const descriptionElement = findDescriptionElement(card);
  if (!descriptionElement) return;

  const description = getTextContent(descriptionElement);
  const bidText = findBidText(card);
  const insertionTarget =
    card.querySelector<HTMLElement>('.cardLote-lance')?.parentElement ||
    card.querySelector<HTMLElement>('[class*="lance"]')?.parentElement ||
    card;

  const container = ensureContainer(card, insertionTarget as HTMLElement);
  await renderWithMode(container, description, bidText);
}

function isDetailPage(): boolean {
  return /LoteDetalhes/i.test(window.location.href);
}

async function processDetailPage() {
  const descriptionElement = findDescriptionElement(document);
  if (!descriptionElement) return;

  const description = getTextContent(descriptionElement);
  const bidText = findBidText(document);
  const host =
    descriptionElement.closest('.col-md-8') ||
    descriptionElement.closest('.card') ||
    document.querySelector('main') ||
    document.body;

  if (!(host instanceof HTMLElement)) return;

  const insertionTarget =
    descriptionElement.closest('.card') ||
    descriptionElement.parentElement ||
    host;

  const container = ensureContainer(host, insertionTarget as HTMLElement, DETAIL_PANEL_ID);
  if (container.parentElement !== insertionTarget) {
    insertionTarget.prepend(container);
  }

  await renderWithMode(container, description, bidText);
}

let scanTimer: number | null = null;

function scanPage() {
  if (scanTimer !== null) {
    window.clearTimeout(scanTimer);
  }

  scanTimer = window.setTimeout(() => {
    if (isDetailPage()) {
      void processDetailPage();
      return;
    }

    for (const card of findLotCards()) {
      void processLot(card);
    }
  }, 150);
}

if (window.self === window.top) {
  const start = () => {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', start, { once: true });
      return;
    }

    scanPage();

    const observer = new MutationObserver((mutations) => {
      const hasMeaningfulChange = mutations.some(m =>
        m.addedNodes.length > 0 ||
        (m.type === 'characterData') ||
        (m.type === 'childList' && (m.target as HTMLElement).classList?.contains('cardLote-vlr'))
      );

      if (hasMeaningfulChange) {
        scanPage();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  };

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
}
