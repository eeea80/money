package com.novatrade.ai.dto;

public record AiChatStreamEvent(String type, String content, String model, Long conversationId) {

    public static AiChatStreamEvent message(String content, String model, long conversationId) {
        return new AiChatStreamEvent("message", content, model, conversationId);
    }

    public static AiChatStreamEvent done(String model, long conversationId) {
        return new AiChatStreamEvent("done", "", model, conversationId);
    }

    public static AiChatStreamEvent error(String message, String model, long conversationId) {
        return new AiChatStreamEvent("error", message, model, conversationId);
    }
}
