# Trading Strategies Configuration

This directory contains the configuration file for all available trading strategies in the AI Trading Strategy Analyzer extension.

## Structure

The `trading-strategies.json` file contains all trading strategies with the following structure for each strategy:

```json
{
  "strategy-key": {
    "name": "Display Name",
    "description": "Brief description shown to users",
    "prompt": "The AI prompt used for analysis"
  }
}
```

## Available Strategies

1. **Wyckoff Method** - Analyzes accumulation/distribution phases and price/volume relationships
2. **Elliott Wave Theory** - Identifies market cycles through wave patterns
3. **Support & Resistance** - Identifies key price levels for entries and exits
4. **Fibonacci Retracement** - Uses Fibonacci ratios to predict price movements
5. **Moving Average Strategy** - Uses MA crossovers and dynamic support/resistance
6. **Price Action Trading** - Pure price movement analysis without indicators
7. **Volume Profile Analysis** - Analyzes volume distribution at price levels
8. **Ichimoku Cloud** - Comprehensive trend following system
9. **Harmonic Patterns** - Identifies geometric price patterns
10. **Market Structure Analysis** - Analyzes higher highs/lows and trend changes

## Adding New Strategies

To add a new trading strategy:

1. Open `trading-strategies.json`
2. Add a new entry with a unique key (e.g., "rsi-divergence")
3. Provide:
   - `name`: The display name for the dropdown
   - `description`: A brief description of the strategy
   - `prompt`: The complete AI prompt that includes:
     - The strategy methodology
     - Required output format (must match the existing structure)
     - Specific analysis instructions

### Example:

```json
"rsi-divergence": {
  "name": "RSI Divergence",
  "description": "Identifies divergences between price and RSI indicator",
  "prompt": "Analyze this trading chart using RSI Divergence strategy. Look for bullish and bearish divergences between price action and RSI momentum. Identify the coin name (e.g., #BTCUSD) and determine if the entry should be a MARKET or LIMIT order. Also provide a Confidence Level from 1 (low) to 5 (high). Provide the following in a structured format:\n\nCoin Name: [name]\nOrder Type: [MARKET or LIMIT]\nEntry Point: [price]\nStop Loss: [price]\nTake Profit: [price]\nConfidence Level: [1-5]\n\nExplanation: [Detailed explanation of RSI divergences found and trading rationale]"
}
```

## Important Notes

- The prompt MUST include the exact output format structure to ensure compatibility
- All strategies must provide: Coin Name, Order Type, Entry Point, Stop Loss, Take Profit, Confidence Level, and Explanation
- The strategy key must be unique and use lowercase with hyphens (e.g., "strategy-name")
- After modifying the JSON file, reload the extension for changes to take effect

## Modifying Existing Strategies

To modify an existing strategy's prompt:

1. Locate the strategy in `trading-strategies.json`
2. Update the `prompt` field while maintaining the required output format
3. Save the file and reload the extension

## Tips for Writing Effective Prompts

1. Be specific about the analysis methodology
2. Include relevant technical indicators or patterns to look for
3. Maintain consistency in the output format
4. Provide clear instructions for confidence level assessment
5. Request detailed explanations to help users understand the analysis
