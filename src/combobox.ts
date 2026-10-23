import { NamedCode } from './fipe_service';
import { filterOptions, nextActiveIndex } from './search';

export interface Combobox {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  readonly value: NamedCode | null;
  setOptions(options: NamedCode[]): void;
  /** Selects by code without firing onChange (used for programmatic prefill). */
  select(code: string): void;
  setState(state: { disabled: boolean; placeholder: string }): void;
}

interface Config {
  label: string;
  required?: boolean;
  /** Fires with null as soon as the user edits the text, so dependent fields can reset. */
  onChange: (option: NamedCode | null) => void;
}

let uid = 0;

/** Searchable single-select following the ARIA 1.2 combobox/listbox pattern. */
export function createCombobox({ label, required, onChange }: Config): Combobox {
  const id = `fipe-cb-${++uid}`;
  const root = document.createElement('div');
  root.className = 'fipe-field';
  root.innerHTML = `
    <label for="${id}">${label}${required ? '<span class="fipe-req" aria-hidden="true"> *</span>' : ''}</label>
    <div class="fipe-combo">
      <input id="${id}" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list" autocomplete="off" spellcheck="false" disabled />
      <div class="fipe-combo-pop" hidden>
        <ul id="${id}-list" role="listbox" aria-label="${label}"></ul>
        <div class="fipe-combo-foot" aria-live="polite"></div>
      </div>
    </div>`;

  const input = root.querySelector<HTMLInputElement>('input')!;
  const pop = root.querySelector<HTMLElement>('.fipe-combo-pop')!;
  const list = root.querySelector<HTMLUListElement>('ul')!;
  const foot = root.querySelector<HTMLElement>('.fipe-combo-foot')!;

  let options: NamedCode[] = [];
  let shown: NamedCode[] = [];
  let selected: NamedCode | null = null;
  let active = -1;

  const isOpen = () => !pop.hidden;

  function setActive(index: number) {
    active = index;
    list.querySelectorAll('[role="option"]').forEach((li, i) => li.classList.toggle('fipe-active', i === index));
    if (index < 0) return input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-activedescendant', `${id}-opt-${index}`);
    list.children[index]?.scrollIntoView({ block: 'nearest' });
  }

  function render(query: string) {
    const { items: found, total } = filterOptions(options, query);
    // Browsing (no search term): lead with the current choice, which may sit beyond the visible cap.
    const items = !query.trim() && selected ? [selected, ...found.filter(o => o.code !== selected!.code)].slice(0, found.length) : found;
    shown = items;
    list.replaceChildren(...items.map((option, i) => {
      const li = document.createElement('li');
      li.id = `${id}-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(option.code === selected?.code));
      li.dataset.index = String(i);
      li.textContent = option.name;
      return li;
    }));
    foot.textContent = items.length === 0 ? 'Nenhum resultado'
      : total > items.length ? `Mostrando ${items.length} de ${total} — digite para refinar` : '';
    const current = items.findIndex(o => o.code === selected?.code);
    setActive(query.trim() ? 0 : current);
    if (items.length === 0) setActive(-1);
  }

  function openList(query = '') {
    pop.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    render(query);
  }

  function closeList() {
    pop.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    input.value = selected?.name ?? ''; // discard half-typed text
  }

  function choose(option: NamedCode) {
    const changed = option.code !== selected?.code;
    selected = option;
    closeList();
    if (changed) onChange(option); // re-choosing the current value must not reset dependent fields
  }

  input.addEventListener('focus', () => {
    input.select();
    if (!isOpen()) openList();
  });
  input.addEventListener('click', () => { if (!isOpen()) openList(); });
  input.addEventListener('blur', closeList);
  input.addEventListener('input', () => {
    if (selected) { selected = null; onChange(null); }
    openList(input.value);
  });
  input.addEventListener('keydown', (event) => {
    const { key } = event;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen()) return openList();
      setActive(nextActiveIndex(active, key, shown.length));
    } else if ((key === 'Home' || key === 'End') && isOpen()) {
      event.preventDefault();
      setActive(nextActiveIndex(active, key, shown.length));
    } else if (key === 'Enter' && isOpen()) {
      event.preventDefault();
      const pick = shown[active] ?? (shown.length === 1 ? shown[0] : undefined);
      if (pick) choose(pick);
    } else if (key === 'Escape' && isOpen()) {
      event.preventDefault();
      event.stopPropagation(); // close the list, not the surrounding dialog
      closeList();
    }
  });

  // Keep focus in the input while clicking/dragging inside the popup.
  pop.addEventListener('mousedown', (event) => event.preventDefault());
  list.addEventListener('click', (event) => {
    const li = (event.target as Element).closest<HTMLElement>('[role="option"]');
    if (li) choose(shown[Number(li.dataset.index)]);
  });

  return {
    root,
    input,
    get value() { return selected; },
    setOptions(next) {
      options = next;
      selected = null;
      input.value = '';
      if (isOpen()) render('');
    },
    select(code) {
      selected = options.find(o => o.code === code) ?? null;
      input.value = selected?.name ?? '';
    },
    setState({ disabled, placeholder }) {
      input.disabled = disabled;
      input.placeholder = placeholder;
    },
  };
}
