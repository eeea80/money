package com.novatrade.stockanalysis.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record StockAnalysisRequest(
        @NotBlank(message = "股票名称不能为空")
        @Size(max = 50, message = "股票名称不能超过 50 个字符")
        String stockName) {
}
