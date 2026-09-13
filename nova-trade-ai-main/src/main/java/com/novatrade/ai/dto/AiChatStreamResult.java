package com.novatrade.ai.dto;

import reactor.core.publisher.Flux;

public record AiChatStreamResult(long conversationId, Flux<String> content) {
}
