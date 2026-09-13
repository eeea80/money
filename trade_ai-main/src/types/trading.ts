export interface TechnicalIndicators {
  ema20: number;
  macd: number;
  rsi7: number;
  rsi14: number;
}

export interface CoinData {
  symbol: string;
  currentPrice: number;
  indicators: TechnicalIndicators;
  openInterest: number;
  fundingRate: number;
  priceHistory: number[];
  emaHistory: number[];
  macdHistory: number[];
  rsiHistory: number[];
}

export interface Position {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  liquidation_price?: number;
  leverage: number;
  unrealizedPnl: number;
  entryTime: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface Trade {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  timestamp: number;
  reason: string;
  confidence: number;
}

export interface Portfolio {
  cash: number;
  totalValue: number;
  positions: Position[];
  trades: Trade[];
  totalReturn: number;
}

export interface AIDecision {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasoning: string;
  quantity?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface TradingStrategy {
  name: string;
  riskPerTrade: number; // درصد سرمایه برای هر معامله
  maxPositions: number; // حداکثر تعداد پوزیشن همزمان
  minConfidence: number; // حداقل اطمینان برای ورود به معامله
  useTrailingStop: boolean; // استفاده از حد ضرر متحرک
  trailingStopPercent: number; // درصد حد ضرر متحرک
  useDCA: boolean; // استفاده از میانگین‌گیری هزینه دلاری
  dcaLevels: number; // تعداد سطوح DCA
  useScalping: boolean; // استفاده از اسکالپینگ
  scalpingTargetPercent: number; // هدف سود اسکالپینگ
  useMarketTiming: boolean; // استفاده از زمان‌بندی بازار
  avoidWeekends: boolean; // اجتناب از معاملات آخر هفته
  maxLeverage: number; // حداکثر لوریج
  diversification: boolean; // تنوع‌بخشی پرتفوی
}

export const DEFAULT_STRATEGIES: Record<string, TradingStrategy> = {
  conservative: {
    name: 'محافظه‌کارانه',
    riskPerTrade: 1,
    maxPositions: 3,
    minConfidence: 0.75,
    useTrailingStop: true,
    trailingStopPercent: 2,
    useDCA: false,
    dcaLevels: 0,
    useScalping: false,
    scalpingTargetPercent: 0,
    useMarketTiming: true,
    avoidWeekends: true,
    maxLeverage: 5,
    diversification: true,
  },
  moderate: {
    name: 'متعادل',
    riskPerTrade: 2,
    maxPositions: 5,
    minConfidence: 0.65,
    useTrailingStop: true,
    trailingStopPercent: 3,
    useDCA: true,
    dcaLevels: 2,
    useScalping: false,
    scalpingTargetPercent: 0,
    useMarketTiming: true,
    avoidWeekends: false,
    maxLeverage: 10,
    diversification: true,
  },
  aggressive: {
    name: 'تهاجمی',
    riskPerTrade: 3,
    maxPositions: 8,
    minConfidence: 0.60,
    useTrailingStop: true,
    trailingStopPercent: 4,
    useDCA: true,
    dcaLevels: 3,
    useScalping: true,
    scalpingTargetPercent: 1.5,
    useMarketTiming: false,
    avoidWeekends: false,
    maxLeverage: 20,
    diversification: false,
  },
  scalper: {
    name: 'اسکالپر',
    riskPerTrade: 1.5,
    maxPositions: 10,
    minConfidence: 0.70,
    useTrailingStop: false,
    trailingStopPercent: 0,
    useDCA: false,
    dcaLevels: 0,
    useScalping: true,
    scalpingTargetPercent: 0.8,
    useMarketTiming: false,
    avoidWeekends: false,
    maxLeverage: 15,
    diversification: false,
  },
};