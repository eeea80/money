package com.novatrade.stockanalysis.client;

import org.junit.jupiter.api.Test;
import org.springframework.boot.restclient.RestTemplateBuilder;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class FuyaoApiClientTests {

    @Test
    void sendsFuyaoRequestWithRestTemplateAndParsesEnvelope() {
        var client = new FuyaoApiClient(
                new RestTemplateBuilder(), "https://fuyao.example", "test-key", Duration.ofSeconds(2));
        RestTemplate restTemplate = (RestTemplate) ReflectionTestUtils.getField(client, "restTemplate");
        assertThat(restTemplate).isNotNull();
        MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();

        server.expect(request -> {
                    assertThat(request.getURI().getPath()).isEqualTo("/api/meta/tickers/search");
                    assertThat(URLDecoder.decode(request.getURI().getRawQuery(), StandardCharsets.UTF_8))
                            .isEqualTo("q=贵州茅台&asset_type=a-share&limit=10");
                })
                .andExpect(method(HttpMethod.GET))
                .andExpect(header("X-api-key", "test-key"))
                .andExpect(header(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE))
                .andRespond(withSuccess("""
                        {
                          "code": 0,
                          "request_id": "req-123",
                          "data": {
                            "item": [{"name": "贵州茅台", "thscode": "600519.SH"}]
                          }
                        }
                        """, MediaType.APPLICATION_JSON));

        FuyaoMarketDataClient.FuyaoResult result = client.searchAStock("贵州茅台");

        assertThat(result.requestId()).isEqualTo("req-123");
        assertThat(result.data().path("item").path(0).path("thscode").asString())
                .isEqualTo("600519.SH");
        server.verify();
    }
}
