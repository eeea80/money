package com.novatrade.stockanalysis.service.impl;

import com.novatrade.common.BusinessException;
import com.novatrade.stockanalysis.client.FuyaoApiException;
import com.novatrade.stockanalysis.client.FuyaoMarketDataClient;
import com.novatrade.stockanalysis.client.FuyaoMarketDataClient.FuyaoResult;
import com.novatrade.stockanalysis.dto.StockAnalysisResponse;
import com.novatrade.stockanalysis.service.StockAiAdviceService;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CanslimStockAnalysisServiceTests {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Clock CLOCK = Clock.fixed(
            Instant.parse("2026-08-23T08:00:00Z"), ZoneId.of("Asia/Shanghai"));

    @Test
    void resolvesStockNameAndBuildsFullySourcedCanslimAnalysis() {
        FuyaoMarketDataClient client = completeClient();
        StockAiAdviceService advisor = mock(StockAiAdviceService.class);
        when(advisor.advise(org.mockito.ArgumentMatchers.any(StockAnalysisResponse.class)))
                .thenReturn("AI 建议：继续观察盈利与量价配合。仅供研究参考，不构成投资建议。");
        var service = new CanslimStockAnalysisService(client, advisor, CLOCK);

        var result = service.analyze("贵州茅台");

        assertThat(result.target().name()).isEqualTo("贵州茅台");
        assertThat(result.target().thscode()).isEqualTo("600519.SH");
        assertThat(result.dimensions()).extracting("code")
                .containsExactly("C", "A", "N", "S", "L", "I", "M");
        assertThat(result.dimensions()).allMatch(dimension -> !"INSUFFICIENT".equals(dimension.status()));
        assertThat(result.score()).isEqualTo(100);
        assertThat(result.coveredMaxScore()).isEqualTo(100);
        assertThat(result.normalizedScore()).isEqualByComparingTo("100.00");
        assertThat(result.dataSources()).hasSize(9).allMatch(source -> "SUCCESS".equals(source.status()));
        assertThat(result.warnings()).anyMatch(warning -> warning.startsWith("N 使用"));
        assertThat(result.disclaimer()).contains("不构成投资建议");
        assertThat(result.aiAdvice()).contains("继续观察盈利");
        verify(advisor).advise(org.mockito.ArgumentMatchers.any(StockAnalysisResponse.class));
        verify(client).financialIndicators("600519.SH", "2026-2");
    }

    @Test
    void keepsPartialResultAndMarksDimensionsWhenOptionalPriceSourceFails() {
        FuyaoMarketDataClient client = completeClient();
        when(client.stockHistory(anyString(), anyLong(), anyLong()))
                .thenThrow(new FuyaoApiException(5002, "上游超时", "req-timeout"));
        var service = new CanslimStockAnalysisService(client, CLOCK);

        var result = service.analyze("贵州茅台");

        assertThat(result.dimensions()).filteredOn(dimension -> "INSUFFICIENT".equals(dimension.status()))
                .extracting("code").contains("N", "S", "L");
        assertThat(result.coveredMaxScore()).isLessThan(100);
        assertThat(result.warnings()).anyMatch(warning -> warning.contains("req-timeout"));
        assertThat(result.dataSources()).anyMatch(source -> "FAILED".equals(source.status()));
    }

    @Test
    void rejectsAmbiguousStockNameInsteadOfGuessingAResult() {
        FuyaoMarketDataClient client = mock(FuyaoMarketDataClient.class);
        when(client.searchAStock("科技")).thenReturn(result("""
                {"timestamp":1,"item":[
                  {"name":"科技A","ticker":"600001","thscode":"600001.SH","exchange":"SH","currency":"CNY"},
                  {"name":"科技B","ticker":"000001","thscode":"000001.SZ","exchange":"SZ","currency":"CNY"}
                ]}
                """));
        var service = new CanslimStockAnalysisService(client, CLOCK);

        assertThatThrownBy(() -> service.analyze("科技"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("多个匹配")
                .extracting("code").isEqualTo(409);
    }

    private FuyaoMarketDataClient completeClient() {
        FuyaoMarketDataClient client = mock(FuyaoMarketDataClient.class);
        when(client.searchAStock(anyString())).thenReturn(result("""
                {"timestamp":1,"item":[
                  {"name":"贵州茅台","ticker":"600519","thscode":"600519.SH","exchange":"SH","currency":"CNY"}
                ]}
                """));
        when(client.stockSnapshot(anyString())).thenReturn(result("""
                {"timestamp":1787472000000,"item":[{
                  "thscode":"600519.SH","last_price":209.0,"price_change":3.0,
                  "price_change_ratio_pct":1.46,"open_price":207.0,"high_price":210.0,
                  "low_price":205.0,"prev_price":206.0,"volume":2000000,"turnover":418000000
                }]}
                """));
        when(client.stockHistory(anyString(), anyLong(), anyLong())).thenReturn(history(100, 0.5, true));
        when(client.indexHistory(anyString(), anyLong(), anyLong())).thenReturn(history(3000, 1, false));
        when(client.incomeStatements(anyString(), org.mockito.ArgumentMatchers.eq("quarterly"), anyInt()))
                .thenReturn(result("""
                    {"timestamp":1,"item":[
                      {"period_end_ms":1782748800000,"fiscal_year":2026,"fiscal_period":"H1","basic_eps":1.4,"operating_income":130,"parent_holder_net_profit":140},
                      {"period_end_ms":1751212800000,"fiscal_year":2025,"fiscal_period":"H1","basic_eps":1.0,"operating_income":100,"parent_holder_net_profit":100}
                    ]}
                    """));
        when(client.incomeStatements(anyString(), org.mockito.ArgumentMatchers.eq("annual"), anyInt()))
                .thenReturn(result("""
                    {"timestamp":1,"item":[
                      {"period_end_ms":1767110400000,"fiscal_year":2025,"fiscal_period":"FY","basic_eps":2.9,"operating_income":290,"parent_holder_net_profit":250},
                      {"period_end_ms":1735574400000,"fiscal_year":2024,"fiscal_period":"FY","basic_eps":2.2,"operating_income":240,"parent_holder_net_profit":205},
                      {"period_end_ms":1704038400000,"fiscal_year":2023,"fiscal_period":"FY","basic_eps":1.7,"operating_income":200,"parent_holder_net_profit":165},
                      {"period_end_ms":1672502400000,"fiscal_year":2022,"fiscal_period":"FY","basic_eps":1.3,"operating_income":160,"parent_holder_net_profit":130},
                      {"period_end_ms":1640966400000,"fiscal_year":2021,"fiscal_period":"FY","basic_eps":1.0,"operating_income":125,"parent_holder_net_profit":100}
                    ]}
                    """));
        when(client.cashFlowStatements(anyString(), anyString(), anyInt())).thenReturn(result("""
                {"timestamp":1,"item":[{"period_end_ms":1767110400000,"act_cash_flow_net":300}]}
                """));
        when(client.financialIndicators(anyString(), anyString())).thenReturn(result("""
                {"thscode":"600519.SH","report":"2026-2","abilities":[
                  {"ability":"growth","indicators":[
                    {"index_id":"net_profit_yoy_growth_ratio","value":"35.0"},
                    {"index_id":"operating_income_yoy_growth_ratio","value":"25.0"}
                  ]}
                ]}
                """));
        when(client.latestInstitutionDragonTigerList()).thenReturn(result("""
                {"timestamp":1787472000000,"trade_date":"2026-08-21","stock_items":[
                  {"thscode":"600519.SH","org_net_value":50000000,"net_value":60000000}
                ]}
                """));
        return client;
    }

    private FuyaoResult history(double startPrice, double step, boolean volumeExpansion) {
        StringBuilder json = new StringBuilder("{\"timestamp\":1787472000000,\"item\":[");
        for (int index = 0; index < 220; index++) {
            if (index > 0) {
                json.append(',');
            }
            double close = startPrice + step * index;
            long volume = volumeExpansion && index >= 200 ? 2_000_000L : 1_000_000L;
            json.append("{\"date_ms\":").append(1_740_000_000_000L + index * 86_400_000L)
                    .append(",\"high_price\":").append(close * 1.001)
                    .append(",\"close_price\":").append(close)
                    .append(",\"volume\":").append(volume).append('}');
        }
        return result(json.append("]}").toString());
    }

    private FuyaoResult result(String json) {
        JsonNode data = JSON.readTree(json);
        return new FuyaoResult(data, "request-id");
    }
}
