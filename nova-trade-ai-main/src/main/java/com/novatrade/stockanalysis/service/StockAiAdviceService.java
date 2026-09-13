package com.novatrade.stockanalysis.service;

import com.novatrade.stockanalysis.dto.StockAnalysisResponse;

public interface StockAiAdviceService {

    String advise(StockAnalysisResponse analysis);
}
