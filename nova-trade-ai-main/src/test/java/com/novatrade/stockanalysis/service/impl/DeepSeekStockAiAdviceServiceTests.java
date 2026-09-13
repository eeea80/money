package com.novatrade.stockanalysis.service.impl;

import com.novatrade.stockanalysis.dto.StockAnalysisResponse;
import com.novatrade.stockanalysis.dto.StockAnalysisResponse.Target;
import org.junit.jupiter.api.Test;
import org.springframework.boot.restclient.RestTemplateBuilder;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class DeepSeekStockAiAdviceServiceTests {

    @Test
    void returnsAiAdviceGeneratedFromStructuredAnalysis() {
        var service = new DeepSeekStockAiAdviceService(
                new RestTemplateBuilder(), new ObjectMapper(), "https://api.deepseek.example",
                "test-key", "deepseek-v4-flash", 0.7, 2048, Duration.ofSeconds(2));
        RestTemplate restTemplate = (RestTemplate) ReflectionTestUtils.getField(service, "restTemplate");
        assertThat(restTemplate).isNotNull();
        MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
        server.expect(requestTo("https://api.deepseek.example/chat/completions"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer test-key"))
                .andExpect(header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE))
                .andExpect(content().string(containsString("deepseek-v4-flash")))
                .andExpect(content().string(containsString("贵州茅台")))
                .andRespond(withSuccess("""
                        {
                          "choices": [{
                            "message": {
                              "content": "综合判断：成长较强，但需要继续观察。仅供研究参考，不构成投资建议。"
                            }
                          }]
                        }
                        """, MediaType.APPLICATION_JSON));

        String advice = service.advise(analysis());

        assertThat(advice).contains("成长较强").contains("不构成投资建议");
        server.verify();
    }

    @Test
    void returnsExplicitFallbackWhenDeepSeekIsNotConfigured() {
        var service = new DeepSeekStockAiAdviceService(
                new RestTemplateBuilder(), new ObjectMapper(), "https://api.deepseek.example",
                "not-configured", "deepseek-v4-flash", 0.7, 2048, Duration.ofSeconds(2));

        String advice = service.advise(analysis());

        assertThat(advice).contains("AI 深度建议暂不可用");
    }

    private StockAnalysisResponse analysis() {
        return new StockAnalysisResponse(
                "贵州茅台",
                new Target("贵州茅台", "600519", "600519.SH", "SH", "CNY"),
                1787472000000L,
                null,
                80,
                100,
                new BigDecimal("80.00"),
                "观察候选",
                "规则化摘要",
                List.of(),
                null,
                null,
                List.of("I 为代理指标"),
                List.of(),
                "不构成投资建议",
                null);
    }
}
