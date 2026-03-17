import { FipeService } from './fipe_service';
import { CalculationResult } from './types';

async function processLot(card: HTMLElement) {
  if (card.querySelector('.fipe-helper-container')) return;

  const descElement = card.querySelector('.cardLote-descVeic');
  const bidElement = card.querySelector('.cardLote-vlr');
  const labelElement = card.querySelector('.cardLote-lance');

  if (!descElement || !bidElement || !labelElement) return;

  const description = descElement.textContent || '';
  const bidText = bidElement.textContent || '0';
  
  // Parse description: "CHEVROLET/CELTA 1.0L LT, 13/14, PLACA: O__-___0, GASOL/ALC, BRANCA"
  const parts = description.split(',');
  if (parts.length < 2) return;

  const vehiclePart = parts[0].trim(); // "CHEVROLET/CELTA 1.0L LT"
  const yearPart = parts[1].trim();    // "13/14"

  const [brand, ...modelParts] = vehiclePart.split('/');
  const model = modelParts.join('/');
  const modelYear = parseInt('20' + yearPart.split('/')[1]);

  // Parse bid: "R$ 18.000,00"
  const bidValue = parseFloat(bidText.replace(/[^\d,]/g, '').replace(',', '.'));

  if (!brand || !model || isNaN(modelYear)) return;

  const fipeData = await FipeService.getPrice(brand, model, modelYear);
  if (!fipeData) return;

  const fipeValue = parseFloat(fipeData.valor.replace(/[^\d,]/g, '').replace(',', '.'));
  
  const results = calculateProfit(fipeValue, bidValue);
  injectResults(labelElement, results);
}

function calculateProfit(fipe: number, bid: number): CalculationResult {
  const fees = bid * 0.04;
  const towing = 1500;
  const totalCost = bid + fees + towing;
  const profit = fipe - totalCost;
  const profitPercentage = (profit / totalCost) * 100;

  return {
    fipeValue: fipe,
    bidValue: bid,
    fees,
    towing,
    totalCost,
    profit,
    profitPercentage
  };
}

function injectResults(target: Element, results: CalculationResult) {
  const container = document.createElement('div');
  container.className = 'fipe-helper-container';
  
  const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const isPositive = results.profit > 0;

  container.innerHTML = `
    <div class="fipe-row">
      <span class="fipe-label">Valor FIPE:</span>
      <span class="fipe-value">${formatter.format(results.fipeValue)}</span>
    </div>
    <div class="fipe-row">
      <span class="fipe-label">Taxas (4%):</span>
      <span class="fipe-value">${formatter.format(results.fees)}</span>
    </div>
    <div class="fipe-row">
      <span class="fipe-label">Guincho:</span>
      <span class="fipe-value">${formatter.format(results.towing)}</span>
    </div>
    <div class="fipe-row">
      <span class="fipe-label">Custo Total:</span>
      <span class="fipe-value">${formatter.format(results.totalCost)}</span>
    </div>
    <div class="fipe-profit ${isPositive ? '' : 'negative'}">
      <span class="fipe-label">Lucro Estimado:</span>
      <span class="fipe-value">${formatter.format(results.profit)}</span>
      <span class="fipe-badge ${isPositive ? '' : 'negative'}">
        ${results.profitPercentage.toFixed(1)}%
      </span>
    </div>
  `;

  target.parentElement?.appendChild(container);
}

// Observe for dynamically loaded lots
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      const cards = document.querySelectorAll('.cardlote');
      cards.forEach(card => processLot(card as HTMLElement));
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial run
document.querySelectorAll('.cardlote').forEach(card => processLot(card as HTMLElement));
