import { BrowserContext, expect, Page, test } from '@playwright/test';
import { ApiMode, DETAIL_URL, detailPage, launch, listPage, LIST_URL, Lot, lotCard, mockApis, popupUrl, serve, SHOTS } from './fixtures';

const UNO: Lot = { desc: 'FIAT/UNO MILLE ECONOMY, 08/09', bid: 5000 };      // FIPE 20.000 → profit
const GOL: Lot = { desc: 'I/VW/GOL 1.0 CITY, 12/13', bid: 38000 };            // FIPE 40.000 → loss
const NAVE: Lot = { desc: 'XPTO/NAVE ESPACIAL, 10/11', bid: 1000 };           // unknown brand

let context: BrowserContext;
let api: ApiMode;
let lots: Lot[];

test.beforeEach(async () => {
  context = await launch();
  api = { calls: [] };
  lots = [UNO, GOL, NAVE];
  await mockApis(context, api);
  await serve(context, {
    '/Leiloes/Lotes?id=1': () => listPage(lots),
    '/Leiloes/LoteDetalhes?id=1': () => detailPage(UNO),
  });
});
test.afterEach(async () => { await context.close(); });

const open = async (url = LIST_URL) => {
  const page = await context.newPage();
  await page.goto(url);
  return page;
};
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(350); // let entry animations settle
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

// 1 ─ happy path: profit math, colors, FIPE model line
test('list page: profit (green) and loss (red) with page fees', async () => {
  const page = await open();
  const uno = lotCard(page, 0);
  await expect(uno).toContainText('Lucro Estimado');
  // 5000 + 5% (250) + 1900 + 1416 + 0 + 40 + 1500 = 10106 → 20000 - 10106 = 9894
  await expect(uno).toContainText('R$ 10.106,00');
  await expect(uno).toContainText('R$ 9.894,00');
  await expect(uno).toContainText('Comissão Leiloeiro (5%)');
  await expect(uno).toContainText('Uno Mille Economy 1.0 Fire Flex 8V 4p');
  await expect(uno.locator('.fipe-profit')).not.toHaveClass(/negative/);
  await expect.poll(() => uno.evaluate(e => getComputedStyle(e).borderLeftColor)).toBe('rgb(5, 150, 105)'); // waits for the CSS transition

  const gol = lotCard(page, 1);
  await expect(gol).toContainText('Lucro Estimado');
  await expect(gol.locator('.fipe-profit')).toHaveClass(/negative/);
  await expect.poll(() => gol.evaluate(e => getComputedStyle(e).borderLeftColor)).toBe('rgb(220, 38, 38)');
  await shot(page, '01-lista-lotes');
  await uno.locator('.fipe-details summary').click();
  await expect(uno.locator('.fipe-details')).toHaveJSProperty('open', true);
  await shot(page, '11-detalhamento-custos');
});

// 2 ─ not found
test('unknown vehicle shows "FIPE não encontrada" without a fake profit', async () => {
  const page = await open();
  const nave = lotCard(page, 2);
  await expect(nave).toContainText('FIPE não encontrada');
  await expect(nave).not.toContainText('Lucro Estimado');
  await expect(nave).toContainText('Custo Total');
  await shot(page, '02-fipe-nao-encontrada');
});

// 3 ─ no render loop: DOM settles and API is hit once per resource
test('no infinite re-render loop and API calls are deduplicated', async () => {
  const page = await open();
  await expect(lotCard(page, 0)).toContainText('Lucro Estimado');
  await expect(lotCard(page, 1)).toContainText('Lucro Estimado');
  await page.waitForTimeout(500);
  const mutations = await page.evaluate(() => new Promise<number>(res => {
    let n = 0;
    new MutationObserver(m => { n += m.length; }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    setTimeout(() => res(n), 1500);
  }));
  expect(mutations).toBe(0);
  expect(api.calls.filter(u => u.endsWith('/marcas/v1/carros')).length).toBe(1);
  expect(api.calls.filter(u => /years$/.test(u)).length).toBe(2); // one per distinct model
});

// 4 ─ rate limit + retry
test('rate limit (429) shows a message and "Tentar novamente" recovers', async () => {
  api.price429 = true;
  const page = await open();
  const uno = lotCard(page, 0);
  await expect(uno).toContainText('Limite da API FIPE excedido');
  await expect(uno).not.toContainText('Lucro Estimado');
  await shot(page, '03-limite-api');
  api.price429 = false;
  await uno.locator('.fipe-retry').click();
  await expect(uno).toContainText('Lucro Estimado');
});

// 5 ─ offline
test('API offline shows a connection error', async () => {
  api.offline = true;
  const page = await open();
  await expect(lotCard(page, 0)).toContainText('Não foi possível consultar a FIPE');
  await shot(page, '04-api-offline');
});

// 6 ─ live auction: bid changes
test('bid update re-renders the lot', async () => {
  const page = await open();
  await expect(lotCard(page, 0)).toContainText('R$ 10.106,00');
  await lotCard(page, 0).locator('.fipe-details summary').click(); // stays open across re-renders
  await page.evaluate(() => {
    document.querySelector('#vlr-0')!.textContent = 'R$ 6.000,00';
    (document.querySelector('[data-testid="lot-0"] #hdMaiorLance') as HTMLInputElement).value = '6000';
  });
  // 6000 + 300 + 1900 + 1416 + 40 + 1500 = 11156
  await expect(lotCard(page, 0)).toContainText('R$ 11.156,00');
  await expect(lotCard(page, 0).locator('.fipe-details')).toHaveJSProperty('open', true);
});

// 7 ─ IPVA
test('IPVA: charged when unpaid (set via modal), free when page says PAGO', async () => {
  lots = [UNO, { ...UNO, desc: 'FIAT/UNO MILLE ECONOMY, 08/09', fees: '<li>IPVA 2025 PAGO</li><li>5% referente à comissão do leiloeiro</li>' }];
  const page = await open();
  const first = lotCard(page, 0);
  await expect(first).toContainText('Lucro Estimado');
  await expect(first).not.toContainText('IPVA (não pago)');

  await first.locator('.fipe-manual-btn').click();
  await page.fill('.fipe-modal input[name="ipva"]', '800');
  await page.click('.fipe-modal-submit');
  await expect(first).toContainText('IPVA (não pago)');
  // 10106 - (1900+1416 from page? lot has full default fees) + 800 = 10906
  await expect(first).toContainText('R$ 10.906,00');

  const second = lotCard(page, 1);
  await expect(second).toContainText('Lucro Estimado');
  await expect(second).not.toContainText('IPVA (não pago)');
});

// 8 ─ toggle + manual modal
test('auto-lookup off → manual mode → modal (validation, Escape, submit)', async () => {
  const page = await open();
  const gol = lotCard(page, 1);
  await expect(gol).toContainText('Lucro Estimado');

  await gol.locator('.fipe-auto-toggle').uncheck();
  await expect(gol).toContainText('Modo manual');
  await expect(gol).not.toContainText('Lucro Estimado');
  await expect(gol.locator('.fipe-auto-toggle')).not.toBeChecked();
  await shot(page, '05-modo-manual');

  await gol.locator('.fipe-manual-open').click();
  const modal = page.locator('.fipe-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('input[name="brand"]')).toHaveValue('VW');
  await expect(modal.locator('input[name="year"]')).toHaveValue('2013');
  await shot(page, '06-modal-selecionar-veiculo');

  await modal.locator('input[name="brand"]').fill('');
  await page.click('.fipe-modal-submit');
  await expect(modal).toBeVisible(); // required field missing → stays open

  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await gol.locator('.fipe-manual-btn').click();
  await page.fill('.fipe-modal input[name="brand"]', 'Fiat');
  await page.fill('.fipe-modal input[name="model"]', 'Uno Mille');
  await page.fill('.fipe-modal input[name="year"]', '2009');
  await page.click('.fipe-modal-submit');
  await expect(gol).toContainText('Lucro Estimado');
  await expect(gol).toContainText('Uno Mille Economy');

  await gol.locator('.fipe-auto-toggle').check();
  await expect(gol).toContainText('Lucro Estimado');
});

// 9 ─ detail page
test('detail page shows the panel once, above the description', async () => {
  const page = await open(DETAIL_URL);
  const panel = page.locator('#fipe-detail-helper');
  await expect(panel).toContainText('Lucro Estimado');
  await expect(page.locator('#fipe-detail-helper')).toHaveCount(1);
  await shot(page, '07-detalhe-lote');
});

// 10 ─ popup + settings propagate to the page
test('popup: defaults, save, persistence, reset, invalid input; settings reach the page', async () => {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 640 });
  await popup.goto(popupUrl());
  await expect(popup.locator('#commissionRate')).toHaveValue('5');
  await expect(popup.locator('#adminFee')).toHaveValue('1900');
  await expect(popup.locator('#logisticsFee')).toHaveValue('1416');
  await expect(popup.locator('#towing')).toHaveValue('1500');
  await expect(popup.locator('#extraCosts')).toHaveValue('0');
  await shot(popup, '08-popup-config');

  // page with no fee list → settings are used (commission default 5% = 5/100, not 500%)
  lots = [{ desc: UNO.desc, bid: 5000, fees: '' }];
  const page = await open();
  await expect(lotCard(page, 0)).toContainText('Lucro Estimado');
  // 5000 + 250 + 1900 + 1416 + 40 + 1500 = 10106
  await expect(lotCard(page, 0)).toContainText('R$ 10.106,00');

  await popup.fill('#towing', '2000');
  await popup.fill('#commissionRate', '10');
  await popup.fill('#extraCosts', '-5');          // browser validation (min=0) blocks the submit
  await popup.click('button[type="submit"]');
  await expect(popup.locator('#success')).toBeHidden();
  expect(await popup.locator('#extraCosts').evaluate((e: HTMLInputElement) => e.validity.rangeUnderflow)).toBe(true);
  await popup.fill('#extraCosts', '');             // empty → default 0
  await popup.fill('#adminFee', '');               // empty → default
  await popup.click('button[type="submit"]');
  await expect(popup.locator('#success')).toBeVisible();
  await shot(popup, '09-popup-salvo');
  await expect(popup.locator('#extraCosts')).toHaveValue('0');
  await expect(popup.locator('#adminFee')).toHaveValue('1900');
  // live update on the already-open lot page: 5000 + 500 + 1900 + 1416 + 0 + 40 + 2000 = 10856
  await expect(lotCard(page, 0)).toContainText('R$ 10.856,00');
  await expect(lotCard(page, 0)).toContainText('Comissão Leiloeiro (10%)');

  await popup.reload();
  await expect(popup.locator('#towing')).toHaveValue('2000');
  await expect(popup.locator('#commissionRate')).toHaveValue('10');

  await popup.click('#reset');
  await expect(popup.locator('#towing')).toHaveValue('1500');
  await expect(popup.locator('#commissionRate')).toHaveValue('5');
  await expect(lotCard(page, 0)).toContainText('R$ 10.106,00');

  await popup.fill('#commissionRate', '250');      // max=100 → browser validation blocks the submit
  await popup.click('button[type="submit"]');
  await expect(popup.locator('#success')).toBeHidden();
  expect(await popup.locator('#commissionRate').evaluate((e: HTMLInputElement) => e.validity.rangeOverflow)).toBe(true);
});

// 11 ─ non-matching pages are left alone
test('page without lots is untouched', async () => {
  lots = [];
  const page = await open();
  await page.waitForTimeout(600);
  await expect(page.locator('.fipe-helper-container')).toHaveCount(0);
});

// 12 ─ real BrasilAPI + FIPE v2 (only the auction site is a fixture). Run with LIVE=1.
test('live APIs: real FIPE price shows up in the page', async () => {
  test.skip(!process.env.LIVE, 'set LIVE=1 to hit the real FIPE APIs');
  await context.unroute(/brasilapi\.com\.br|fipe\.parallelum\.com\.br/);
  lots = [{ desc: 'VW/GOL 1.0 CITY, 12/13', bid: 15000 }];
  const page = await open();
  const card = lotCard(page, 0);
  await expect(card).toContainText('Valor FIPE', { timeout: 30000 });
  await expect(card).toContainText('Gol City');
  await shot(page, '10-fipe-real');
});
