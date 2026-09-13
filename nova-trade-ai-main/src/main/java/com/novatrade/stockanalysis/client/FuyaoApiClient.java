package com.novatrade.stockanalysis.client;

import com.novatrade.common.BusinessException;
import org.springframework.boot.restclient.RestTemplateBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.DefaultUriBuilderFactory;
import org.springframework.web.util.UriBuilder;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.function.Function;
import tools.jackson.databind.JsonNode;

@Component
public class FuyaoApiClient implements FuyaoMarketDataClient {

    private static final String UNCONFIGURED_API_KEY = "not-configured";
    private static final int MAX_ATTEMPTS = 3;

    private final RestTemplate restTemplate;
    private final DefaultUriBuilderFactory uriBuilderFactory;
    private final HttpEntity<Void> requestEntity;
    private final String apiKey;

    public FuyaoApiClient(
            RestTemplateBuilder restTemplateBuilder,
            @Value("${fuyao.base-url:https://fuyao.aicubes.cn}") String baseUrl,
            @Value("${fuyao.api-key:}") String apiKey,
            @Value("${fuyao.timeout:15s}") Duration timeout) {
        this.restTemplate = restTemplateBuilder
                .connectTimeout(timeout)
                .readTimeout(timeout)
                .build();
        this.uriBuilderFactory = new DefaultUriBuilderFactory(baseUrl);
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-api-key", apiKey);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
        this.requestEntity = new HttpEntity<>(headers);
        this.apiKey = apiKey;
    }

    @Override
    public FuyaoResult searchAStock(String query) {
        return get(uri -> uri.path("/api/meta/tickers/search")
                .queryParam("q", query)
                .queryParam("asset_type", "a-share")
                .queryParam("limit", 10)
                .build());
    }

    @Override
    public FuyaoResult stockSnapshot(String thscode) {
        return get(uri -> uri.path("/api/a-share/prices/snapshot")
                .queryParam("thscodes", thscode)
                .build());
    }

    @Override
    public FuyaoResult stockHistory(String thscode, long startMs, long endMs) {
        return get(uri -> uri.path("/api/a-share/prices/historical")
                .queryParam("thscode", thscode)
                .queryParam("interval", "1d")
                .queryParam("start", startMs)
                .queryParam("end", endMs)
                .queryParam("adjust", "forward")
                .build());
    }

    @Override
    public FuyaoResult indexHistory(String thscode, long startMs, long endMs) {
        return get(uri -> uri.path("/api/a-share-index/prices/historical")
                .queryParam("thscode", thscode)
                .queryParam("interval", "1d")
                .queryParam("start", startMs)
                .queryParam("end", endMs)
                .build());
    }

    @Override
    public FuyaoResult incomeStatements(String thscode, String period, int limit) {
        return get(uri -> uri.path("/api/a-share/financials/income-statements")
                .queryParam("thscode", thscode)
                .queryParam("period", period)
                .queryParam("limit", limit)
                .build());
    }

    @Override
    public FuyaoResult cashFlowStatements(String thscode, String period, int limit) {
        return get(uri -> uri.path("/api/a-share/financials/cash-flow-statements")
                .queryParam("thscode", thscode)
                .queryParam("period", period)
                .queryParam("limit", limit)
                .build());
    }

    @Override
    public FuyaoResult financialIndicators(String thscode, String report) {
        return get(uri -> uri.path("/api/a-share/financials/indicators")
                .queryParam("thscode", thscode)
                .queryParam("report", report)
                .build());
    }

    @Override
    public FuyaoResult latestInstitutionDragonTigerList() {
        return get(uri -> uri.path("/api/a-share/special-data/dragon-tiger-list")
                .queryParam("board_type", "org")
                .build());
    }

    private FuyaoResult get(Function<UriBuilder, URI> uri) {
        ensureConfigured();
        FuyaoApiException lastFailure = null;
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                return getOnce(uri);
            } catch (FuyaoApiException exception) {
                lastFailure = exception;
                if (!retryable(exception.getUpstreamCode()) || attempt == MAX_ATTEMPTS) {
                    throw exception;
                }
                try {
                    Thread.sleep(150L * attempt);
                } catch (InterruptedException interruptedException) {
                    Thread.currentThread().interrupt();
                    throw new FuyaoApiException(5000, "同花顺金融数据请求被中断", exception.getRequestId());
                }
            }
        }
        throw lastFailure;
    }

    private FuyaoResult getOnce(Function<UriBuilder, URI> uri) {
        JsonNode envelope;
        try {
            URI requestUri = uri.apply(uriBuilderFactory.builder());
            ResponseEntity<JsonNode> response = restTemplate.exchange(
                    requestUri, HttpMethod.GET, requestEntity, JsonNode.class);
            envelope = response.getBody();
        } catch (RestClientResponseException exception) {
            throw new FuyaoApiException(
                    exception.getStatusCode().value(),
                    "同花顺金融数据 HTTP 服务返回异常",
                    requestId(exception.getResponseHeaders()));
        } catch (Exception exception) {
            if (exception instanceof FuyaoApiException fuyaoApiException) {
                throw fuyaoApiException;
            }
            throw new FuyaoApiException(5000, "同花顺金融数据服务连接失败或超时", null);
        }

        if (envelope == null || !envelope.isObject()) {
            throw new FuyaoApiException(5000, "同花顺金融数据服务返回空响应", null);
        }
        int code = envelope.path("code").asInt(-1);
        String requestId = text(envelope, "request_id");
        if (code != 0) {
            String upstreamMessage = text(envelope, "message");
            throw new FuyaoApiException(
                    code,
                    StringUtils.hasText(upstreamMessage) ? upstreamMessage : "同花顺金融数据业务请求失败",
                    requestId);
        }
        JsonNode data = envelope.get("data");
        if (data == null || data.isNull()) {
            throw new FuyaoApiException(5000, "同花顺金融数据响应缺少 data", requestId);
        }
        return new FuyaoResult(data, requestId);
    }

    private boolean retryable(int code) {
        return code == 4001 || code == 5000 || code >= 5001 && code <= 5999;
    }

    private void ensureConfigured() {
        if (!StringUtils.hasText(apiKey) || UNCONFIGURED_API_KEY.equals(apiKey)) {
            throw BusinessException.serviceUnavailable("Fuyao API Key 尚未配置");
        }
    }

    private String requestId(HttpHeaders headers) {
        return headers == null ? null : headers.getFirst("X-Request-Id");
    }

    private String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.asString();
    }
}
