export interface FipeVehicle {
  valor: string;
  marca: string;
  modelo: string;
  anoModelo: number;
  combustivel: string;
  codigoFipe: string;
  mesReferencia: string;
  tipoVeiculo: number;
  siglaCombustivel: string;
  dataConsulta: string;
}

export interface CalculationResult {
  fipeValue: number;
  bidValue: number;
  commission: number;
  adminFee: number;
  logisticsFee: number;
  extraCosts: number;
  atpvFee: number;
  towing: number;
  totalCost: number;
  profit: number;
  profitPercentage: number;
}
