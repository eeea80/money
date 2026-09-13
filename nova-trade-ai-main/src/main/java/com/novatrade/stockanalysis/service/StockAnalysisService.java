package com.novatrade.stockanalysis.service;

import com.novatrade.stockanalysis.dto.StockAnalysisResponse;

public interface StockAnalysisService {

    StockAnalysisResponse analyze(String stockName);
}
