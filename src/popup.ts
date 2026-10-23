import { DEFAULTS, TOKEN_KEY, setStored } from './settings';

const fields = ['commissionRate', 'adminFee', 'logisticsFee', 'towing', 'extraCosts'] as const;
type Field = typeof fields[number];

const inputs = Object.fromEntries(
  fields.map(f => [f, document.getElementById(f) as HTMLInputElement])
) as Record<Field, HTMLInputElement>;
const tokenInput = document.getElementById('fipeToken') as HTMLInputElement;
const form = document.getElementById('config-form') as HTMLFormElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;
const successMsg = document.getElementById('success') as HTMLDivElement;

function loadSettings() {
  chrome.storage.sync.get([...fields, TOKEN_KEY], (result) => {
    for (const f of fields) {
      const value = result[f];
      inputs[f].value = String(typeof value === 'number' && value >= 0 ? value : DEFAULTS[f]);
    }
    tokenInput.value = typeof result[TOKEN_KEY] === 'string' ? result[TOKEN_KEY] : '';
  });
}

/** Parses an input as a non-negative number (comma accepted); falls back to the default when empty/invalid. */
function readField(f: Field): number {
  const value = parseFloat(inputs[f].value.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) return DEFAULTS[f];
  return f === 'commissionRate' ? Math.min(value, 100) : value;
}

async function saveSettings() {
  const values: Record<string, unknown> = { [TOKEN_KEY]: tokenInput.value.trim() };
  for (const f of fields) {
    values[f] = readField(f);
    inputs[f].value = String(values[f]);
  }

  await setStored(values);
  successMsg.style.display = 'block';
  setTimeout(() => { successMsg.style.display = 'none'; }, 2000);
}

function resetDefaults() {
  for (const f of fields) inputs[f].value = String(DEFAULTS[f]);
  void saveSettings();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  void saveSettings();
});

resetBtn.addEventListener('click', resetDefaults);

loadSettings();
