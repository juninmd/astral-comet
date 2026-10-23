export interface FipeVehicle {
  price: string;
  brand: string;
  model: string;
  modelYear: number;
  fuel: string;
  codeFipe: string;
  referenceMonth: string;
}

export type FipeErrorKind = 'rate-limit' | 'network' | 'not-found';

export interface CalculationResult {
  fipeValue: number;
  bidValue: number;
  commission: number;
  commissionRate: number;
  adminFee: number;
  logisticsFee: number;
  extraCosts: number;
  atpvFee: number;
  towing: number;
  ipvaFee: number;
  totalCost: number;
  profit: number;
  profitPercentage: number;
}
