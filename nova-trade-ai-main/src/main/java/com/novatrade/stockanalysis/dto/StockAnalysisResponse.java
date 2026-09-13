package com.novatrade.stockanalysis.dto;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

public record StockAnalysisResponse(
        String query,
        Target target,
        long generatedAtMs,
        MarketSnapshot market,
        int score,
        int coveredMaxScore,
        BigDecimal normalizedScore,
        String verdict,
        String summary,
        List<CanslimDimension> dimensions,
        Fundamentals fundamentals,
        Technicals technicals,
        List<String> warnings,
        List<DataSource> dataSources,
        String disclaimer,
        String aiAdvice) {

    public StockAnalysisResponse withAiAdvice(String advice) {
        return new StockAnalysisResponse(
                query, target, generatedAtMs, market, score, coveredMaxScore, normalizedScore, verdict, summary,
                dimensions, fundamentals, technicals, warnings, dataSources, disclaimer, advice);
    }

    public record Target(String name, String ticker, String thscode, String exchange, String currency) {
    }

    public record MarketSnapshot(
            Long dataTimestampMs,
            BigDecimal lastPrice,
            BigDecimal priceChange,
            BigDecimal priceChangeRatioPct,
            BigDecimal openPrice,
            BigDecimal highPrice,
            BigDecimal lowPrice,
            BigDecimal previousClose,
            BigDecimal volume,
            BigDecimal turnover) {
    }

    public record CanslimDimension(
            String code,
            String name,
            int score,
            int maxScore,
            String status,
            String summary,
            Map<String, Object> evidence,
            List<String> sourceEndpoints) {
    }

    public record Fundamentals(
            String latestQuarterReport,
            BigDecimal latestQuarterEps,
            BigDecimal latestQuarterRevenue,
            BigDecimal latestQuarterNetProfit,
            List<AnnualEarnings> annualEarnings,
            BigDecimal latestAnnualOperatingCashFlow,
            BigDecimal cashFlowToNetProfitRatio) {
    }

    public record AnnualEarnings(
            Integer fiscalYear,
            BigDecimal eps,
            BigDecimal revenue,
            BigDecimal netProfit) {
    }

    public record Technicals(
            BigDecimal high52Week,
            BigDecimal distanceFromHighPct,
            BigDecimal stockReturn20DayPct,
            BigDecimal stockReturn120DayPct,
            BigDecimal csi300Return120DayPct,
            BigDecimal relativeStrengthPctPoints,
            BigDecimal recentToPriorVolumeRatio,
            BigDecimal csi300Ma50,
            BigDecimal csi300Ma200) {
    }

    public record DataSource(
            String endpoint,
            String status,
            String requestId,
            Long dataTimestampMs) {
    }
}
