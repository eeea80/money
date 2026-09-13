package com.novatrade.stockanalysis.client;

import tools.jackson.databind.JsonNode;

public interface FuyaoMarketDataClient {

    FuyaoResult searchAStock(String query);

    FuyaoResult stockSnapshot(String thscode);

    FuyaoResult stockHistory(String thscode, long startMs, long endMs);

    FuyaoResult indexHistory(String thscode, long startMs, long endMs);

    FuyaoResult incomeStatements(String thscode, String period, int limit);

    FuyaoResult cashFlowStatements(String thscode, String period, int limit);

    FuyaoResult financialIndicators(String thscode, String report);

    FuyaoResult latestInstitutionDragonTigerList();

    record FuyaoResult(JsonNode data, String requestId) {
    }
}
