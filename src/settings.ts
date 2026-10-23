import { Fees } from './lib';

export const DEFAULTS = {
  towing: 1500,
  extraCosts: 0,
  adminFee: 1900,
  logisticsFee: 1416,
  atpvFee: 40,
  /** Percent, as shown in the popup (5 = 5%). */
  commissionRate: 5,
  ipvaFee: 0,
  /** Percent under FIPE the car is expected to resell for. */
  resaleDiscount: 0,
  /** Percent profit wanted over the total cost. */
  targetMargin: 0,
};

export const AUTO_LOOKUP_KEY = 'astralCometAutoLookup';
export const TOKEN_KEY = 'fipeToken';

const FEE_KEYS = Object.keys(DEFAULTS);

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function getSettings(): Promise<Fees> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(FEE_KEYS, (r) => {
      resolve({
        towing: num(r.towing, DEFAULTS.towing),
        extraCosts: num(r.extraCosts, DEFAULTS.extraCosts),
        adminFee: num(r.adminFee, DEFAULTS.adminFee),
        logisticsFee: num(r.logisticsFee, DEFAULTS.logisticsFee),
        atpvFee: num(r.atpvFee, DEFAULTS.atpvFee),
        commissionRate: num(r.commissionRate, DEFAULTS.commissionRate) / 100,
        ipvaFee: num(r.ipvaFee, DEFAULTS.ipvaFee),
        resaleDiscount: Math.min(num(r.resaleDiscount, DEFAULTS.resaleDiscount), 95) / 100,
        targetMargin: num(r.targetMargin, DEFAULTS.targetMargin) / 100,
      });
    });
  });
}

export function getAutoLookupEnabled(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([AUTO_LOOKUP_KEY], (r) => {
      resolve(typeof r[AUTO_LOOKUP_KEY] === 'boolean' ? r[AUTO_LOOKUP_KEY] : true);
    });
  });
}

export function setStored(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.sync.set(values, () => resolve()));
}

export function getToken(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([TOKEN_KEY], (r) => resolve(typeof r[TOKEN_KEY] === 'string' ? r[TOKEN_KEY].trim() : ''));
  });
}
