import { Portfolio, Position, Trade, AIDecision, TradingStrategy } from '@/types/trading';

export class PortfolioManager {
  private portfolio: Portfolio;
  private initialCash: number;
  private strategy: TradingStrategy;
  private trailingStops: Map<string, number> = new Map();

  constructor(strategy?: TradingStrategy, initialBalance?: number) {
    this.initialCash = initialBalance || 10000;
    
    const savedPortfolio = localStorage.getItem('trading-portfolio');
    const savedInitialCash = localStorage.getItem('trading-initial-cash');
    
    if (savedPortfolio && savedInitialCash) {
      this.portfolio = JSON.parse(savedPortfolio);
      this.initialCash = Number(savedInitialCash);
    } else {
      this.portfolio = {
        cash: this.initialCash,
        totalValue: this.initialCash,
        positions: [],
        trades: [],
        totalReturn: 0,
      };
      this.saveInitialCash();
    }
    
    this.strategy = strategy || {
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
    };
  }

  setInitialBalance(balance: number) {
    this.initialCash = balance;
    this.saveInitialCash();
  }

  getInitialBalance(): number {
    return this.initialCash;
  }

  setStrategy(strategy: TradingStrategy) {
    this.strategy = strategy;
  }

  getPortfolio(): Portfolio {
    return { ...this.portfolio };
  }

  canOpenPosition(decision: AIDecision): boolean {
    // بررسی حداکثر تعداد پوزیشن
    if (this.portfolio.positions.length >= this.strategy.maxPositions) {
      return false;
    }

    // بررسی حداقل اطمینان
    if (decision.confidence < this.strategy.minConfidence) {
      return false;
    }

    // بررسی تنوع‌بخشی
    if (this.strategy.diversification) {
      const existingPosition = this.portfolio.positions.find(p => p.symbol === decision.symbol);
      if (existingPosition) {
        return false; // یک پوزیشن از این ارز داریم
      }
    }

    // بررسی زمان‌بندی بازار
    if (this.strategy.useMarketTiming && this.strategy.avoidWeekends) {
      const now = new Date();
      const day = now.getDay();
      if (day === 0 || day === 6) {
        return false; // آخر هفته
      }
    }

    return true;
  }

  calculatePositionSize(decision: AIDecision, currentPrice: number): number {
    const riskAmount = this.portfolio.cash * (this.strategy.riskPerTrade / 100);
    const quantity = (riskAmount / currentPrice);
    return Math.floor(quantity * 100) / 100;
  }

  executeTrade(decision: AIDecision, currentPrice: number, quantity: number): Trade | null {
    if (decision.action === 'HOLD') return null;

    const trade: Trade = {
      id: Date.now().toString(),
      symbol: decision.symbol,
      type: decision.action,
      quantity,
      price: currentPrice,
      timestamp: Date.now(),
      reason: decision.reasoning,
      confidence: decision.confidence,
    };

    if (decision.action === 'BUY') {
      if (!this.canOpenPosition(decision)) {
        console.warn('نمی‌توان پوزیشن جدید باز کرد');
        return null;
      }

      const cost = quantity * currentPrice;
      if (cost > this.portfolio.cash) {
        console.warn('موجودی کافی نیست');
        return null;
      }

      this.portfolio.cash -= cost;
      
      const existingPosition = this.portfolio.positions.find(p => p.symbol === decision.symbol);
      if (existingPosition && this.strategy.useDCA) {
        // DCA - میانگین‌گیری هزینه
        const totalQuantity = existingPosition.quantity + quantity;
        const avgPrice = (existingPosition.entryPrice * existingPosition.quantity + currentPrice * quantity) / totalQuantity;
        existingPosition.quantity = totalQuantity;
        existingPosition.entryPrice = avgPrice;
        existingPosition.currentPrice = currentPrice;
        existingPosition.stopLoss = decision.stopLoss;
        existingPosition.takeProfit = decision.takeProfit;
      } else {
        // پوزیشن جدید
        const leverage = Math.min(
          this.strategy.maxLeverage,
          decision.confidence > 0.8 ? this.strategy.maxLeverage : Math.floor(this.strategy.maxLeverage / 2)
        );

        this.portfolio.positions.push({
          symbol: decision.symbol,
          quantity,
          entryPrice: currentPrice,
          currentPrice,
          leverage,
          unrealizedPnl: 0,
          entryTime: Date.now(),
          stopLoss: decision.stopLoss,
          takeProfit: decision.takeProfit,
        });

        // تنظیم حد ضرر متحرک
        if (this.strategy.useTrailingStop) {
          this.trailingStops.set(decision.symbol, currentPrice);
        }
      }
    } else if (decision.action === 'SELL') {
      const positionIndex = this.portfolio.positions.findIndex(p => p.symbol === decision.symbol);
      if (positionIndex === -1) {
        console.warn('پوزیشنی برای فروش وجود ندارد');
        return null;
      }

      const position = this.portfolio.positions[positionIndex];
      const sellQuantity = Math.min(quantity, position.quantity);
      const proceeds = sellQuantity * currentPrice;

      this.portfolio.cash += proceeds;
      position.quantity -= sellQuantity;

      if (position.quantity <= 0) {
        this.portfolio.positions.splice(positionIndex, 1);
        this.trailingStops.delete(decision.symbol);
      }

      trade.quantity = sellQuantity;
    }

    this.portfolio.trades.unshift(trade);
    this.savePortfolio();
    return trade;
  }

  updatePositions(prices: Record<string, number>): void {
    let totalPositionValue = 0;

    this.portfolio.positions.forEach(position => {
      const currentPrice = prices[position.symbol];
      if (currentPrice) {
        position.currentPrice = currentPrice;
        position.unrealizedPnl = (currentPrice - position.entryPrice) * position.quantity;
        totalPositionValue += currentPrice * position.quantity;

        // بررسی حد ضرر متحرک
        if (this.strategy.useTrailingStop) {
          const highestPrice = this.trailingStops.get(position.symbol) || position.entryPrice;
          if (currentPrice > highestPrice) {
            this.trailingStops.set(position.symbol, currentPrice);
            const newStopLoss = currentPrice * (1 - this.strategy.trailingStopPercent / 100);
            position.stopLoss = newStopLoss;
          }
        }

        // بررسی اسکالپینگ
        if (this.strategy.useScalping) {
          const profitPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
          if (profitPercent >= this.strategy.scalpingTargetPercent) {
            console.log(`هدف اسکالپینگ برای ${position.symbol} رسید - سود: ${profitPercent.toFixed(2)}%`);
          }
        }

        // بررسی حد ضرر و حد سود
        if (position.stopLoss && currentPrice <= position.stopLoss) {
          console.log(`حد ضرر برای ${position.symbol} فعال شد`);
        }
        if (position.takeProfit && currentPrice >= position.takeProfit) {
          console.log(`حد سود برای ${position.symbol} رسید`);
        }
      }
    });

    this.portfolio.totalValue = this.portfolio.cash + totalPositionValue;
    this.portfolio.totalReturn = ((this.portfolio.totalValue - this.initialCash) / this.initialCash) * 100;
    this.savePortfolio();
  }

  resetPortfolio(): void {
    this.portfolio = {
      cash: this.initialCash,
      totalValue: this.initialCash,
      positions: [],
      trades: [],
      totalReturn: 0,
    };
    this.trailingStops.clear();
    this.savePortfolio();
  }

  private savePortfolio(): void {
    localStorage.setItem('trading-portfolio', JSON.stringify(this.portfolio));
  }

  private saveInitialCash(): void {
    localStorage.setItem('trading-initial-cash', this.initialCash.toString());
  }
}