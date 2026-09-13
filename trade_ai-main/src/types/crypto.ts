export interface CryptoPrice {
  symbol: string;
  price: number;
  timestamp: number;
}

export interface CryptoPricesResponse {
  prices: {
    [key: string]: CryptoPrice;
  };
  serverTime: number;
}

export interface PriceHistory {
  timestamp: number;
  price: number;
}