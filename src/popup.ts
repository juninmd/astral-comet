const DEFAULT_TOWING = 1500;
const DEFAULT_EXTRA_COSTS = 0;
const DEFAULT_ADMIN_FEE = 1900;
const DEFAULT_LOGISTICS_FEE = 1416;
const DEFAULT_ATPV_FEE = 40;
const DEFAULT_COMMISSION_RATE = 5;

const commissionRateInput = document.getElementById('commissionRate') as HTMLInputElement;
const adminFeeInput = document.getElementById('adminFee') as HTMLInputElement;
const logisticsFeeInput = document.getElementById('logisticsFee') as HTMLInputElement;
const towingInput = document.getElementById('towing') as HTMLInputElement;
const extraCostsInput = document.getElementById('extraCosts') as HTMLInputElement;
const form = document.getElementById('config-form') as HTMLFormElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;
const successMsg = document.getElementById('success') as HTMLDivElement;

function loadSettings() {
  chrome.storage.sync.get(['towing', 'extraCosts', 'adminFee', 'logisticsFee', 'atpvFee', 'commissionRate'], (result) => {
    const commissionRate = result.commissionRate as number | undefined;
    const adminFee = result.adminFee as number | undefined;
    const logisticsFee = result.logisticsFee as number | undefined;
    const towing = result.towing as number | undefined;
    const extraCosts = result.extraCosts as number | undefined;
    
    commissionRateInput.value = commissionRate !== undefined ? commissionRate.toString() : DEFAULT_COMMISSION_RATE.toString();
    adminFeeInput.value = adminFee !== undefined ? adminFee.toString() : DEFAULT_ADMIN_FEE.toString();
    logisticsFeeInput.value = logisticsFee !== undefined ? logisticsFee.toString() : DEFAULT_LOGISTICS_FEE.toString();
    towingInput.value = towing !== undefined ? towing.toString() : DEFAULT_TOWING.toString();
    extraCostsInput.value = extraCosts !== undefined ? extraCosts.toString() : DEFAULT_EXTRA_COSTS.toString();
  });
}

function saveSettings() {
  const commissionRate = parseFloat(commissionRateInput.value);
  const adminFee = parseFloat(adminFeeInput.value);
  const logisticsFee = parseFloat(logisticsFeeInput.value);
  const towing = parseFloat(towingInput.value);
  const extraCosts = parseFloat(extraCostsInput.value);

  chrome.storage.sync.set({ 
    commissionRate: Number.isNaN(commissionRate) ? DEFAULT_COMMISSION_RATE : commissionRate,
    adminFee: Number.isNaN(adminFee) ? DEFAULT_ADMIN_FEE : adminFee,
    logisticsFee: Number.isNaN(logisticsFee) ? DEFAULT_LOGISTICS_FEE : logisticsFee,
    towing: Number.isNaN(towing) ? DEFAULT_TOWING : towing,
    extraCosts: Number.isNaN(extraCosts) ? DEFAULT_EXTRA_COSTS : extraCosts
  }, () => {
    successMsg.style.display = 'block';
    setTimeout(() => { successMsg.style.display = 'none'; }, 2000);
  });
}

function resetDefaults() {
  commissionRateInput.value = DEFAULT_COMMISSION_RATE.toString();
  adminFeeInput.value = DEFAULT_ADMIN_FEE.toString();
  logisticsFeeInput.value = DEFAULT_LOGISTICS_FEE.toString();
  towingInput.value = DEFAULT_TOWING.toString();
  extraCostsInput.value = DEFAULT_EXTRA_COSTS.toString();
  saveSettings();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  saveSettings();
});

resetBtn.addEventListener('click', resetDefaults);

loadSettings();
