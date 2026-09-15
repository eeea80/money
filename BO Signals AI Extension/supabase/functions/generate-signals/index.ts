import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  try {
    // Get config from server
    const configResp = await fetch('https://ai-tradebot.com/gptanalys/config.php');
    const config = await configResp.json();
    
    const pairs = config.pairs || ['EURUSD'];
    const timeframe = '1m';
    
    // Deterministic pair selection based on current minute
    const now = new Date();
    const minuteIndex = now.getMinutes() + now.getHours() * 60;
    const pair = pairs[minuteIndex % pairs.length];
    
    console.log(`Generating signal for ${pair} at ${now.toISOString()}`);
    
    // Check if signal already exists for this minute
    const tmin = Math.floor(now.getTime() / 60000) * 60000;
    const { data: existing } = await supabase
      .from('signals')
      .select('*')
      .eq('pair', pair)
      .eq('tf', timeframe)
      .eq('tmin', tmin)
      .single();
    
    if (existing) {
      return new Response(JSON.stringify({ ok: true, cached: true, signal: existing }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Fetch indicators
    const indicResp = await fetch(`https://ai-tradebot.com/gptanalys/parse.php?peir=${pair}&tf=1`);
    const indicators = await indicResp.json();
    
    // Build prompt
    const prompt = buildIndicatorsPrompt(pair, timeframe, indicators);
    
    // Call OpenRouter via proxy
    const aiResp = await fetch(config.openRouterProxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: 'You are precise and concise.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
      })
    });
    
    const aiData = await aiResp.json();
    const text = aiData?.choices?.[0]?.message?.content ?? '{}';
    const signal = JSON.parse(text);
    
    // Save to Supabase
    const ts = Date.now();
    await supabase.from('signals').insert({
      pair,
      tf: timeframe,
      ts,
      tmin,
      signal
    });
    
    // Send to Telegram
    if (config.telegramBotToken && config.telegramChatId) {
      await fetch('https://ai-tradebot.com/gptanalys/telegram.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair, timeframe, signal })
      }).catch(console.error);
    }
    
    return new Response(JSON.stringify({ ok: true, pair, signal }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
})

function buildIndicatorsPrompt(symbol: string, interval: string, indicators: any) {
  const keys = Object.keys(indicators || {});
  const compact = keys.slice(0, 80).map(k => `${k}:${indicators[k]}`).join('\n');
  return (
    `You are a trading assistant generating short-term binary options signals based on indicators.\n` +
    `Instrument: ${symbol}\nTimeframe: ${interval}\n` +
    `Indicators (key:value):\n${compact}\n` +
    `Rules: Reply STRICT JSON with keys: action(one of BUY_CALL, BUY_PUT, WAIT), confidence(0..1), reasoning(max 40 words), expiry_minutes(1|3|5), summary(max 80 words).` +
    ` Consider trend, volatility, momentum, confluence. Do not add extra text.`
  );
}



















