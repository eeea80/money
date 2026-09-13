export type AIProvider = 'openai' | 'openrouter' | 'ollama';

export interface AIConfig {
  provider: AIProvider;
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

export interface MarketAnalysis {
  decision: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasoning: string;
  chainOfThought: string;
  stopLoss?: number;
  takeProfit?: number;
  invalidationCondition?: string;
}

export class AIService {
  private config: AIConfig;
  private requestCount: number = 0;
  private lastRequestTime: number = 0;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async analyzeMarket(
    symbol: string,
    price: number,
    indicators: {
      rsi7: number;
      rsi14: number;
      macd: number;
      ema20: number;
      priceHistory: number[];
      emaHistory: number[];
      macdHistory: number[];
      rsiHistory: number[];
    },
    currentPositions: any[],
    portfolioValue: number,
    availableCash: number
  ): Promise<MarketAnalysis> {
    const prompt = this.buildProfessionalPrompt(
      symbol,
      price,
      indicators,
      currentPositions,
      portfolioValue,
      availableCash
    );

    try {
      const response = await this.callAIWithRetry(prompt, 3);
      return this.parseResponse(response, price);
    } catch (error) {
      console.error('AI analysis failed:', error);
      return this.fallbackAnalysis(indicators, price);
    }
  }

  private async callAIWithRetry(prompt: string, maxRetries: number = 3): Promise<string> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Add exponential backoff delay between retries
        if (attempt > 0) {
          const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        
        return await this.callAI(prompt);
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on authentication errors
        if (error.message?.includes('401') || error.message?.includes('403')) {
          throw error;
        }
        
        // Don't retry on rate limit errors, just throw
        if (error.message?.includes('429') || error.message?.includes('rate limit')) {
          throw new Error('محدودیت نرخ درخواست. لطفاً چند دقیقه صبر کنید');
        }
        
        console.warn(`تلاش ${attempt + 1} از ${maxRetries} ناموفق بود:`, error.message);
      }
    }
    
    throw lastError || new Error('خطا در ارتباط با API');
  }

  private buildProfessionalPrompt(
    symbol: string,
    price: number,
    indicators: any,
    positions: any[],
    portfolioValue: number,
    cash: number
  ): string {
    const currentPosition = positions.find(p => p.symbol === symbol);
    
    return `شما یک معامله‌گر حرفه‌ای ارزهای دیجیتال هستید که در حال تحلیل ${symbol} می‌باشید. لطفاً یک تصمیم معاملاتی دقیق ارائه دهید.

وضعیت فعلی بازار برای ${symbol}
قیمت فعلی: $${price}
EMA(20) فعلی: $${indicators.ema20.toFixed(2)}
MACD فعلی: ${indicators.macd.toFixed(3)}
RSI(7) فعلی: ${indicators.rsi7.toFixed(2)}
RSI(14) فعلی: ${indicators.rsi14.toFixed(2)}

تاریخچه قیمت در بازه زمانی کوتاه (قدیمی‌ترین → جدیدترین):
${indicators.priceHistory.slice(-10).map((p: number) => p.toFixed(2)).join(', ')}

تاریخچه EMA(20):
${indicators.emaHistory.slice(-10).map((e: number) => e.toFixed(2)).join(', ')}

تاریخچه MACD:
${indicators.macdHistory.slice(-10).map((m: number) => m.toFixed(3)).join(', ')}

تاریخچه RSI(7):
${indicators.rsiHistory.slice(-10).map((r: number) => r.toFixed(2)).join(', ')}

اطلاعات حساب شما
ارزش کل پرتفوی: $${portfolioValue.toFixed(2)}
موجودی نقد در دسترس: $${cash.toFixed(2)}

${currentPosition ? `
پوزیشن فعلی در ${symbol}:
مقدار: ${currentPosition.quantity}
قیمت ورود: $${currentPosition.entryPrice}
قیمت فعلی: $${price}
سود/زیان تحقق نیافته: $${currentPosition.unrealizedPnl.toFixed(2)}
حد ضرر: $${currentPosition.stopLoss || 'تنظیم نشده'}
حد سود: $${currentPosition.takeProfit || 'تنظیم نشده'}
` : `هیچ پوزیشن فعالی در این دارایی وجود ندارد.`}

دستورالعمل‌ها:
1. اندیکاتورهای تکنیکال (EMA، MACD، RSI) را تحلیل کنید
2. جهت روند و مومنتوم را در نظر بگیرید
3. نسبت ریسک به ریوارد را ارزیابی کنید
4. تصمیم خود را مشخص کنید: خرید (BUY)، فروش (SELL)، یا نگهداری (HOLD)

پاسخ خود را دقیقاً به این فرمت JSON ارائه دهید (همه توضیحات باید به فارسی باشد):
{
  "chainOfThought": "فرآیند تفکر و تحلیل دقیق خود را اینجا توضیح دهید. بگویید چه چیزی در داده‌ها می‌بینید، چرا این تصمیم را می‌گیرید و چه شرایطی باعث باطل شدن این تحلیل می‌شود.",
  "decision": "BUY|SELL|HOLD",
  "confidence": 0.0-1.0,
  "reasoning": "خلاصه کوتاه از تصمیم شما به فارسی",
  "stopLoss": قیمت_عددی,
  "takeProfit": قیمت_عددی,
  "invalidationCondition": "شرایطی که باعث خروج از معامله می‌شود"
}

مهم: تمام توضیحات و تحلیل‌ها باید به زبان فارسی باشد.`;
  }

  private async callAI(prompt: string): Promise<string> {
    const { provider, apiKey, model, baseURL } = this.config;

    // Rate limiting check
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < 1000) {
      await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();

    if (provider === 'ollama') {
      return this.callOllama(prompt, model || 'llama2');
    }

    if (!apiKey) {
      throw new Error('کلید API برای این ارائه‌دهنده الزامی است');
    }

    const url = baseURL || (provider === 'openrouter' 
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          ...(provider === 'openrouter' ? {
            'HTTP-Referer': window.location.origin,
            'X-Title': 'Crypto Trading Bot'
          } : {})
        },
        body: JSON.stringify({
          model: model || (provider === 'openrouter' ? 'openai/gpt-3.5-turbo' : 'gpt-3.5-turbo'),
          messages: [
            { 
              role: 'system', 
              content: 'شما یک تحلیلگر حرفه‌ای معاملات ارزهای دیجیتال با تخصص در تحلیل تکنیکال هستید. همیشه پاسخ‌های خود را به صورت JSON معتبر و به زبان فارسی ارائه دهید.' 
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        
        if (response.status === 429) {
          throw new Error('محدودیت نرخ درخواست API');
        }
        
        throw new Error(`خطای API هوش مصنوعی: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      this.requestCount++;
      return data.choices[0].message.content;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('زمان درخواست به API تمام شد');
      }
      throw error;
    }
  }

  private async callOllama(prompt: string, model: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('خطای API Ollama');
      }

      const data = await response.json();
      return data.response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('زمان درخواست به Ollama تمام شد');
      }
      throw error;
    }
  }

  private parseResponse(response: string, currentPrice: number): MarketAnalysis {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          decision: parsed.decision || 'HOLD',
          confidence: parsed.confidence || 0.5,
          reasoning: parsed.reasoning || 'تحلیل هوش مصنوعی',
          chainOfThought: parsed.chainOfThought || 'تحلیل دقیق ارائه نشده است',
          stopLoss: parsed.stopLoss,
          takeProfit: parsed.takeProfit,
          invalidationCondition: parsed.invalidationCondition
        };
      }
    } catch (e) {
      console.error('خطا در تجزیه پاسخ هوش مصنوعی:', e);
    }

    return this.fallbackAnalysis({ rsi7: 50, rsi14: 50, macd: 0, ema20: currentPrice }, currentPrice);
  }

  private fallbackAnalysis(
    indicators: { rsi7: number; rsi14: number; macd: number; ema20: number },
    price: number
  ): MarketAnalysis {
    const { rsi7, rsi14, macd, ema20 } = indicators;
    
    if (rsi7 < 30 && macd > 0 && price > ema20) {
      return {
        decision: 'BUY',
        confidence: 0.75,
        reasoning: 'RSI در ناحیه اشباع فروش با MACD صعودی و قیمت بالاتر از EMA',
        chainOfThought: 'تحلیل تکنیکال نشان می‌دهد که شرایط اشباع فروش (RSI < 30) همراه با مومنتوم صعودی (MACD > 0) و قیمت بالاتر از میانگین متحرک نمایی 20 دوره‌ای، احتمال بازگشت قیمت به سمت بالا را نشان می‌دهد.',
        stopLoss: price * 0.98,
        takeProfit: price * 1.04,
        invalidationCondition: 'قیمت زیر EMA20 بسته شود'
      };
    }
    
    if (rsi7 > 70 && macd < 0 && price < ema20) {
      return {
        decision: 'SELL',
        confidence: 0.75,
        reasoning: 'RSI در ناحیه اشباع خرید با MACD نزولی و قیمت پایین‌تر از EMA',
        chainOfThought: 'بازار شرایط اشباع خرید (RSI > 70) را با مومنتوم نزولی (MACD < 0) و قیمت پایین‌تر از EMA20 نشان می‌دهد که احتمال ریزش قیمت را افزایش می‌دهد.',
        invalidationCondition: 'قیمت بالاتر از EMA20 بسته شود'
      };
    }

    return {
      decision: 'HOLD',
      confidence: 0.5,
      reasoning: 'سیگنال معاملاتی واضحی وجود ندارد',
      chainOfThought: 'شرایط فعلی بازار فرصت معاملاتی مشخصی ارائه نمی‌دهد. RSI در حالت خنثی است و MACD سیگنال‌های مختلطی نشان می‌دهد. بهتر است منتظر سیگنال واضح‌تری بمانیم.',
      invalidationCondition: 'ندارد'
    };
  }
}