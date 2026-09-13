package com.novatrade.ai.dto;

import com.novatrade.ai.entity.AiChatMessage;

import java.time.LocalDateTime;

public record AiChatMessageResponse(
        Long id,
        Long conversationId,
        String role,
        String content,
        LocalDateTime createdAt) {

    public static AiChatMessageResponse from(AiChatMessage message) {
        return new AiChatMessageResponse(
                message.getId(),
                message.getConversationId(),
                message.getRole(),
                message.getContent(),
                message.getCreatedAt());
    }
}
