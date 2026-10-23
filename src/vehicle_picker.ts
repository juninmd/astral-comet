import { Category, FipeError, FipeService, NamedCode } from './fipe_service';
import { createCombobox } from './combobox';
import { getToken } from './settings';

/** Exact FIPE codes picked by the user; prices are fetched by code, with no name matching. */
export interface Selection {
  categoryKey: Category['brasil'];
  brandCode: string;
  modelCode: string;
  yearCode: string;
}

export interface PickerInput {
  detected: { brand: string; model: string; modelYear: number } | null;
  /** A previous pick for this lot; wins over detection. */
  initial?: Selection;
  ipvaFee: number;
}

interface Preset { category: Category; brandCode: string; modelCode: string | null; yearCode?: string; year?: number }

// Only one picker can be open; replacing it must also detach the old one's document listeners.
let closeActive: (() => void) | null = null;

const FOCUSABLE = 'input:not(:disabled), select:not(:disabled), button:not(:disabled)';

export function categoryOf(key: Selection['categoryKey']): Category {
  return FipeService.CATEGORIES.find(c => c.brasil === key) ?? FipeService.CATEGORIES[0];
}

export function showVehiclePicker(input: PickerInput, onSubmit: (selection: Selection, ipvaFee: number) => void) {
  closeActive?.();
  const previousFocus = document.activeElement as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.className = 'fipe-modal-overlay';
  overlay.innerHTML = `
    <div class="fipe-modal" role="dialog" aria-modal="true" aria-labelledby="fipe-modal-title" tabindex="-1">
      <h3 id="fipe-modal-title">Consultar FIPE</h3>
      <p class="fipe-modal-sub">Escolha o veículo na tabela FIPE. Já vem preenchido com o que detectamos no lote.</p>
      <div class="fipe-modal-row fipe-field"><label for="fipe-category">Categoria</label><select id="fipe-category" name="category"></select></div>
      <div class="fipe-modal-row" data-slot="brand"></div>
      <div class="fipe-modal-row" data-slot="model"></div>
      <div class="fipe-modal-row fipe-field"><label for="fipe-year">Ano<span class="fipe-req" aria-hidden="true"> *</span></label><select id="fipe-year" name="year" disabled></select></div>
      <div class="fipe-modal-row fipe-field"><label for="fipe-ipva">IPVA (se não pago)</label><input id="fipe-ipva" name="ipva" type="number" min="0" step="0.01" placeholder="0" aria-describedby="fipe-ipva-hint" /><span id="fipe-ipva-hint" class="fipe-hint">Some só se o edital atribuir o IPVA ao comprador; a regra de débitos muda de leilão para leilão.</span></div>
      <div class="fipe-modal-status" role="status" aria-live="polite"></div>
      <div class="fipe-modal-actions">
        <button type="button" class="fipe-modal-cancel">Cancelar</button>
        <button type="button" class="fipe-modal-submit" disabled>Consultar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const dialog = overlay.querySelector<HTMLElement>('.fipe-modal')!;
  const categorySel = overlay.querySelector<HTMLSelectElement>('#fipe-category')!;
  const yearSel = overlay.querySelector<HTMLSelectElement>('#fipe-year')!;
  const ipvaInput = overlay.querySelector<HTMLInputElement>('#fipe-ipva')!;
  const statusEl = overlay.querySelector<HTMLElement>('.fipe-modal-status')!;
  const submitBtn = overlay.querySelector<HTMLButtonElement>('.fipe-modal-submit')!;
  const cancelBtn = overlay.querySelector<HTMLButtonElement>('.fipe-modal-cancel')!;

  let category = FipeService.CATEGORIES[0];
  let interacted = false; // once the user drives the form, background prefill must not override them
  const seq = { brands: 0, models: 0, years: 0 }; // stale async results are dropped when a newer load starts

  const brand = createCombobox({ label: 'Marca', required: true, onChange: (opt) => { interacted = true; resetModel(); if (opt) void loadModels(opt.code); } });
  const model = createCombobox({ label: 'Modelo', required: true, onChange: (opt) => { interacted = true; resetYear(); if (opt) void loadYears(opt.code); } });
  overlay.querySelector('[data-slot="brand"]')!.append(brand.root);
  overlay.querySelector('[data-slot="model"]')!.append(model.root);

  categorySel.replaceChildren(...FipeService.CATEGORIES.map(c => new Option(c.label, c.brasil)));
  ipvaInput.value = input.ipvaFee ? String(input.ipvaFee) : '';

  const syncSubmit = () => { submitBtn.disabled = !(brand.value && model.value && yearSel.value); };

  function setStatus(message: string, retry?: () => void) {
    statusEl.textContent = message;
    if (!retry) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fipe-modal-retry';
    button.textContent = 'Tentar novamente';
    button.onclick = () => void FipeService.retryNow().then(retry);
    statusEl.append(' ', button);
  }

  /** Resolves to undefined when the request failed (message shown) or was superseded; null/values are real answers. */
  async function load<T>(key: keyof typeof seq, task: () => Promise<T>, what: string, retry: () => void): Promise<T | undefined> {
    const mine = ++seq[key];
    setStatus(`Carregando ${what}…`);
    try {
      const result = await task();
      if (mine !== seq[key]) return undefined;
      setStatus('');
      return result;
    } catch (e) {
      if (mine !== seq[key]) return undefined;
      setStatus(e instanceof FipeError && e.kind === 'rate-limit'
        ? 'Limite da API FIPE excedido. Tente mais tarde ou informe um token no popup.'
        : `Não foi possível carregar ${what}.`, retry);
      return undefined;
    }
  }

  function resetYear() {
    seq.years++;
    setStatus(''); // drop stale "loading"/retry messages of the fields being reset
    yearSel.replaceChildren(new Option('Escolha o modelo primeiro', ''));
    yearSel.disabled = true;
    syncSubmit();
  }

  function resetModel() {
    seq.models++;
    model.setOptions([]);
    model.setState({ disabled: true, placeholder: 'Escolha a marca primeiro' });
    resetYear();
  }

  async function loadBrands(): Promise<NamedCode[] | null> {
    brand.setOptions([]);
    brand.setState({ disabled: true, placeholder: 'Carregando marcas…' });
    resetModel();
    const list = await load('brands', () => FipeService.listBrands(category), 'as marcas', () => void loadBrands());
    if (!list) return null;
    brand.setOptions(list);
    brand.setState({ disabled: false, placeholder: 'Digite para buscar a marca' });
    return list;
  }

  async function loadModels(brandCode: string): Promise<NamedCode[] | null> {
    model.setState({ disabled: true, placeholder: 'Carregando modelos…' });
    const list = await load('models', () => FipeService.listModels(category, brandCode), 'os modelos', () => void loadModels(brandCode));
    if (!list) return null;
    model.setOptions(list);
    model.setState({ disabled: false, placeholder: 'Digite para buscar o modelo' });
    return list;
  }

  async function loadYears(modelCode: string): Promise<NamedCode[] | null> {
    const brandCode = brand.value?.code;
    if (!brandCode) return null;
    yearSel.replaceChildren(new Option('Carregando anos…', ''));
    yearSel.disabled = true;
    const list = await load('years', async () => FipeService.listYears(category, brandCode, modelCode, (await getToken()) || undefined), 'os anos', () => void loadYears(modelCode));
    if (!list) return null;
    yearSel.replaceChildren(new Option(list.length ? 'Selecione o ano' : 'Sem anos disponíveis', ''), ...list.map(y => new Option(y.name, y.code)));
    yearSel.disabled = list.length === 0;
    return list;
  }

  async function applyPreset(p: Preset) {
    category = p.category;
    categorySel.value = category.brasil;
    if (!await loadBrands()) return;
    brand.select(p.brandCode);
    if (!brand.value) return;

    const models = await loadModels(p.brandCode);
    if (!models) return;
    if (!p.modelCode) return setStatus('Modelo não identificado automaticamente. Escolha na lista.');
    model.select(p.modelCode);
    if (!model.value) return;

    const years = await loadYears(p.modelCode);
    if (!years) return;
    const match = years.find(y => (p.yearCode ? y.code === p.yearCode : parseInt(y.code, 10) === p.year));
    if (match) {
      yearSel.value = match.code;
      if (p.year && parseInt(match.code, 10) !== p.year) setStatus(`Ano ${p.year} não existe na FIPE para este modelo; usando ${match.name}.`);
    } else if (p.year) setStatus(`Ano ${p.year} não existe para este modelo. Escolha o ano.`);
    syncSubmit();
  }

  async function start() {
    if (input.initial) {
      const { categoryKey, brandCode, modelCode, yearCode } = input.initial;
      await applyPreset({ category: categoryOf(categoryKey), brandCode, modelCode, yearCode });
    } else {
      const detected = input.detected;
      const found = detected
        ? await load('brands', async () => FipeService.resolveVehicle(detected.brand, detected.model, detected.modelYear, (await getToken()) || undefined), 'o veículo do lote', () => void start())
        : null;
      if (interacted || found === undefined) return; // user took over, or the error is on screen with its retry
      if (found) await applyPreset({ ...found, year: detected!.modelYear });
      else if (await loadBrands() && detected) setStatus('Veículo do lote não identificado na FIPE. Selecione abaixo.');
    }
    if (interacted) return;
    // Land on the submit button when fully prefilled, else on the first field still missing.
    const empty = [brand.input, model.input, yearSel].find(el => !el.disabled && !el.value);
    (submitBtn.disabled ? empty ?? dialog : submitBtn).focus();
  }

  const close = () => {
    closeActive = null;
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
    previousFocus?.focus?.();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !dialog.contains(current))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (current === last || !dialog.contains(current))) { event.preventDefault(); first.focus(); }
    }
  };

  categorySel.onchange = () => { interacted = true; category = categoryOf(categorySel.value as Category['brasil']); void loadBrands(); };
  yearSel.onchange = () => { interacted = true; syncSubmit(); };
  cancelBtn.onclick = close;
  submitBtn.onclick = () => {
    if (!brand.value || !model.value || !yearSel.value) return;
    const ipvaFee = parseFloat(ipvaInput.value.replace(',', '.')) || 0;
    onSubmit({ categoryKey: category.brasil, brandCode: brand.value.code, modelCode: model.value.code, yearCode: yearSel.value }, ipvaFee);
    close();
  };

  closeActive = close;
  document.addEventListener('keydown', onKeyDown);
  dialog.focus();
  void start();
}
