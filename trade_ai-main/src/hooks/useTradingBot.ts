import { useState, useEffect, useCallback, useRef } from 'react';
import { Portfolio, Trade, AIDecision, TradingStrategy } from '@/types/trading';
import { PortfolioManager } from '@/services/portfolioManager';
import { TechnicalIndicators } from '@/services/technicalIndicators';
import { AIService, AIConfig } from '@/services/aiService';
import { CryptoPricesResponse, PriceHistory } from '@/types/crypto';
import { toast } from 'sonner';

let portfolioManager: PortfolioManager;

// Helper function to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const useTradingBot = (
  prices: CryptoPricesResponse | null,
  priceHistory: Record<string, PriceHistory[]>,
  isEnabled: boolean,
  aiConfig: AIConfig,
  strategy: TradingStrategy,
  initialBalance: number
) => {
  const [portfolio, setPortfolio] = useState<Portfolio>(() => {
    portfolioManager = new PortfolioManager(strategy, initialBalance);
    return portfolioManager.getPortfolio();
  });
  const [decisions, setDecisions] = useState<AIDecision[]>([]);
  const [aiReports, setAiReports] = useState<Array<{
    timestamp: number;
    symbol: string;
    analysis: string;
    chainOfThought: string;
    decision: string;
    confidence: number;
  }>>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const lastAnalysisTime = useRef<number>(0);
  const ANALYSIS_COOLDOWN = 10000; // 10 seconds between full analysis cycles

  // Update initial balance when it changes
  useEffect(() => {
    if (portfolioManager) {
      portfolioManager.setInitialBalance(initialBalance);
    }
  }, [initialBalance]);

  // Update strategy when it changes
  useEffect(() => {
    if (portfolioManager) {
      portfolioManager.setStrategy(strategy);
    }
  }, [strategy]);

  const analyzeAndTrade = useCallback(async () => {
    if (!prices || !isEnabled || isAnalyzing) return;

    // Check cooldown to prevent too frequent analysis
    const now = Date.now();
    if (now - lastAnalysisTime.current < ANALYSIS_COOLDOWN) {
      return;
    }

    // Check if API key is configured
    if (aiConfig.provider !== 'ollama' && !aiConfig.apiKey) {
      toast.error('لطفاً ابتدا کلید API را در تنظیمات وارد کنید');
      return;
    }

    setIsAnalyzing(true);
    lastAnalysisTime.current = now;
    
    const aiService = new AIService(aiConfig);
    const currentPrices: Record<string, number> = {};
    const newDecisions: AIDecision[] = [];
    const newReports: typeof aiReports = [];

    try {
      const symbols = Object.keys(prices.prices);
      
      // Process symbols one by one with delay to avoid rate limits
      for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        const priceData = prices.prices[symbol];
        
        currentPrices[symbol] = priceData.price;
        const history = priceHistory[symbol] || [];
        
        if (history.length < 20) continue;

        const priceValues = history.map(h => h.price);
        const rsi7Values: number[] = [];
        const rsi14Values: number[] = [];
        const emaValues: number[] = [];
        const macdValues: number[] = [];

        for (let j = 14; j < priceValues.length; j++) {
          const slice = priceValues.slice(0, j + 1);
          rsi7Values.push(TechnicalIndicators.calculateRSI(slice, 7));
          rsi14Values.push(TechnicalIndicators.calculateRSI(slice, 14));
          emaValues.push(TechnicalIndicators.calculateEMA(slice, 20));
          macdValues.push(TechnicalIndicators.calculateMACD(slice).macd);
        }

        const currentRsi7 = TechnicalIndicators.calculateRSI(priceValues, 7);
        const currentRsi14 = TechnicalIndicators.calculateRSI(priceValues, 14);
        const currentEma20 = TechnicalIndicators.calculateEMA(priceValues, 20);
        const currentMacd = TechnicalIndicators.calculateMACD(priceValues).macd;

        try {
          // Add delay between API calls to respect rate limits
          if (i > 0) {
            await delay(2000); // 2 second delay between each API call
          }

          const analysis = await aiService.analyzeMarket(
            symbol,
            priceData.price,
            {
              rsi7: currentRsi7,
              rsi14: currentRsi14,
              macd: currentMacd,
              ema20: currentEma20,
              priceHistory: priceValues,
              emaHistory: emaValues,
              macdHistory: macdValues,
              rsiHistory: rsi7Values
            },
            portfolio.positions,
            portfolio.totalValue,
            portfolio.cash
          );

          const decision: AIDecision = {
            symbol,
            action: analysis.decision,
            confidence: analysis.confidence,
            reasoning: analysis.reasoning,
            stopLoss: analysis.stopLoss,
            takeProfit: analysis.takeProfit
          };

          newDecisions.push(decision);
          newReports.push({
            timestamp: Date.now(),
            symbol,
            analysis: analysis.reasoning,
            chainOfThought: analysis.chainOfThought,
            decision: analysis.decision,
            confidence: analysis.confidence
          });

          if (decision.action !== 'HOLD') {
            const quantity = portfolioManager.calculatePositionSize(decision, priceData.price);

            if (quantity > 0 && decision.action === 'BUY') {
              const trade = portfolioManager.executeTrade(decision, priceData.price, quantity);
              if (trade) {
                toast.success(`معامله خرید ${symbol} انجام شد`);
                console.log('معامله انجام شد:', trade);
              }
            } else if (decision.action === 'SELL') {
              const position = portfolio.positions.find(p => p.symbol === symbol);
              if (position) {
                const trade = portfolioManager.executeTrade(decision, priceData.price, position.quantity);
                if (trade) {
                  toast.success(`پوزیشن ${symbol} بسته شد`);
                  console.log('پوزیشن بسته شد:', trade);
                }
              }
            }
          }
        } catch (error: any) {
          console.error(`خطا در تحلیل ${symbol}:`, error);
          
          // If rate limit error, stop processing more symbols
          if (error.message?.includes('rate limit') || error.message?.includes('429')) {
            toast.error('به محدودیت نرخ درخواست رسیدیم. لطفاً چند دقیقه صبر کنید');
            break;
          }
          
          // Continue with next symbol for other errors
          continue;
        }
      }

      portfolioManager.updatePositions(currentPrices);
      setPortfolio(portfolioManager.getPortfolio());
      setDecisions(newDecisions);
      setAiReports(prev => [...newReports, ...prev].slice(0, 50));
      
      if (newDecisions.length > 0) {
        toast.success(`تحلیل ${newDecisions.length} ارز دیجیتال کامل شد`);
      }
    } catch (error) {
      console.error('خطا در تحلیل بازار:', error);
      toast.error('خطا در تحلیل بازار. لطفاً تنظیمات API را بررسی کنید');
    } finally {
      setIsAnalyzing(false);
    }
  }, [prices, priceHistory, isEnabled, aiConfig, portfolio.cash, portfolio.positions, isAnalyzing, strategy]);

  useEffect(() => {
    if (isEnabled && prices && !isAnalyzing) {
      analyzeAndTrade();
    }
  }, [prices, isEnabled]);

  const resetPortfolio = useCallback(() => {
    portfolioManager.resetPortfolio();
    setPortfolio(portfolioManager.getPortfolio());
    setDecisions([]);
    setAiReports([]);
    toast.success('پرتفوی ریست شد');
  }, []);

  return {
    portfolio,
    decisions,
    aiReports,
    isAnalyzing,
    resetPortfolio,
  };
};