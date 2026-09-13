package com.novatrade.stockanalysis.controller;

import com.novatrade.common.ApiResponse;
import com.novatrade.stockanalysis.dto.StockAnalysisRequest;
import com.novatrade.stockanalysis.dto.StockAnalysisResponse;
import com.novatrade.stockanalysis.service.StockAnalysisService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai/stocks")
public class StockAnalysisController {

    private final StockAnalysisService stockAnalysisService;

    public StockAnalysisController(StockAnalysisService stockAnalysisService) {
        this.stockAnalysisService = stockAnalysisService;
    }

    @PostMapping("/canslim")
    public ApiResponse<StockAnalysisResponse> analyze(@Valid @RequestBody StockAnalysisRequest request) {
        return ApiResponse.success(stockAnalysisService.analyze(request.stockName()));
    }
}
