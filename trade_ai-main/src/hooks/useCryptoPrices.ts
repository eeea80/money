import { useState, useEffect, useCallback } from 'react';
import { CryptoPricesResponse, PriceHistory } from '@/types/crypto';

const API_URL = '/api/crypto-prices';
const FETCH_INTERVAL = 5000; // 5 seconds
const MAX_HISTORY_POINTS = 100; // Keep last 100 data points

export const useCryptoPrices = () => {
  const [prices, setPrices] = useState<CryptoPricesResponse | null>(null);
  const [priceHistory, setPriceHistory] = useState<Record<string, PriceHistory[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPrices = useCallback(async () => {
    try {
      const response = await fetch(API_URL);
      
      // Check if response is OK
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // Check content type
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Received non-JSON response:', text);
        throw new Error('دریافت داده ناموفق بود. پاسخ سرور معتبر نیست.');
      }
      
      const data: CryptoPricesResponse = await response.json();
      return data;
    } catch (err: any) {
      console.error('Error fetching crypto prices:', err);
      
      // More specific error messages
      if (err instanceof TypeError) {
        throw new Error('خطا در اتصال به سرور. لطفاً اتصال اینترنت خود را بررسی کنید.');
      } else if (err.message.includes('HTTP error')) {
        throw new Error(`خطای سرور: ${err.message}`);
      } else {
        throw new Error('خطا در دریافت قیمت‌ها: ' + (err.message || 'خطای نامشخص'));
      }
    }
  }, []);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const updatePrices = async () => {
      try {
        const data = await fetchPrices();
        setPrices(data);
        setIsLoading(false);
        setError(null);

        // Update price history for each crypto
        setPriceHistory((prev) => {
          const updated = { ...prev };
          
          Object.entries(data.prices).forEach(([symbol, priceData]) => {
            if (!updated[symbol]) {
              updated[symbol] = [];
            }
            
            updated[symbol] = [
              ...updated[symbol],
              {
                timestamp: priceData.timestamp,
                price: priceData.price,
              },
            ].slice(-MAX_HISTORY_POINTS); // Keep only last MAX_HISTORY_POINTS
          });
          
          return updated;
        });
      } catch (err: any) {
        setError(err.message);
        setIsLoading(false);
      }
    };

    // Initial fetch
    updatePrices().catch((err) => {
      setError(err.message);
      setIsLoading(false);
    });

    // Set up interval for live updates
    intervalId = setInterval(() => {
      updatePrices().catch((err) => {
        setError(err.message);
      });
    }, FETCH_INTERVAL);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [fetchPrices]);

  return { prices, priceHistory, isLoading, error };
};
