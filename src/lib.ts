import { CalculationResult } from './types';

export const CURRENCY_PATTERN = /R\$\s*[\d.]+,\d{2}/i;

/** Extracts the first "R$ 1.234,56" occurrence from text. */
export function extractCurrency(text: string): string | null {
  return text.match(CURRENCY_PATTERN)?.[0] || null;
}

/** Parses a Brazilian currency string ("R$ 1.234,56") into a number. Returns 0 when no number is found. */
export function parseCurrency(text: string): number {
  const currency = extractCurrency(text) || text;
  const normalized = currency
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  const value = normalized ? parseFloat(normalized) : 0;
  return Number.isFinite(value) ? value : 0;
}

/** Two-digit model year → four digits (anything beyond next year is assumed to be 19xx). */
export function expandYear(twoDigits: number, now = new Date()): number {
  const current = now.getFullYear();
  const year = 2000 + twoDigits;
  return year > current + 1 ? 1900 + twoDigits : year;
}

/** Parses "FIAT/UNO MILLE, 08/09" (optionally prefixed by "I/") into brand, model and model year. */
export function parseDescription(description: string): { brand: string; model: string; modelYear: number } | null {
  const match = description.match(/^(?:[^/]+\/)?([^/]+)\/(.+?),\s*(\d{2})\/(\d{2})/);
  if (!match) return null;

  return {
    brand: match[1].trim(),
    model: match[2].trim(),
    modelYear: expandYear(parseInt(match[4], 10)),
  };
}

export interface Fees {
  towing: number;
  extraCosts: number;
  adminFee: number;
  logisticsFee: number;
  atpvFee: number;
  /** Rate as a fraction (0.05 = 5%). */
  commissionRate: number;
  ipvaFee: number;
}

/** Fees read from the lot page, which take precedence over user settings. */
export interface PageFees {
  adminFee?: number;
  logisticsFee?: number;
  commissionRate?: number;
  ipvaPaid?: boolean;
}

export function calculate(fipe: number, bid: number, settings: Fees, pageFees: PageFees = {}): CalculationResult {
  const commissionRate = pageFees.commissionRate ?? settings.commissionRate;
  const commission = bid * commissionRate;
  const adminFee = pageFees.adminFee ?? settings.adminFee;
  const logisticsFee = pageFees.logisticsFee ?? settings.logisticsFee;
  const ipvaFee = pageFees.ipvaPaid ? 0 : settings.ipvaFee;

  const fixedCosts = adminFee + logisticsFee + settings.extraCosts + settings.atpvFee + settings.towing + ipvaFee;
  const totalCost = bid + commission + fixedCosts;
  const profit = fipe - totalCost;
  // Break-even: bid × (1 + commission) + fixed = FIPE. Rounded down so the bid never overshoots by a cent.
  const maxBid = Math.max(0, Math.floor(((fipe - fixedCosts) / (1 + commissionRate)) * 100) / 100);
  const profitPercentage = totalCost > 0 ? (profit / totalCost) * 100 : 0;

  return {
    fipeValue: fipe,
    bidValue: bid,
    commission,
    commissionRate,
    adminFee,
    logisticsFee,
    extraCosts: settings.extraCosts,
    atpvFee: settings.atpvFee,
    towing: settings.towing,
    ipvaFee,
    totalCost,
    maxBid,
    profit,
    profitPercentage,
  };
}
