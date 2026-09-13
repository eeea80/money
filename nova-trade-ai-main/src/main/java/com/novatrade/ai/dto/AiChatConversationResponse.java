package com.novatrade.ai.dto;

import com.novatrade.ai.entity.AiChatConversation;

import java.time.LocalDateTime;

public record AiChatConversationResponse(
        Long id,
        String title,
        LocalDateTime createdAt,
        LocalDateTime updatedAt) {

    public static AiChatConversationResponse from(AiChatConversation conversation) {
        return new AiChatConversationResponse(
                conversation.getId(),
                conversation.getTitle(),
                conversation.getCreatedAt(),
                conversation.getUpdatedAt());
    }
}
