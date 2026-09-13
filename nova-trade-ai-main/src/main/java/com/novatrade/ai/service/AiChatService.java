package com.novatrade.ai.service;

import com.novatrade.ai.dto.AiChatConversationResponse;
import com.novatrade.ai.dto.AiChatMessageResponse;
import com.novatrade.ai.dto.AiChatStreamResult;

import java.util.List;

public interface AiChatService {

    AiChatStreamResult streamChat(long userId, Long conversationId, String message);

    List<AiChatConversationResponse> getRecentConversations(long userId, int limit);

    AiChatConversationResponse createConversation(long userId);

    void deleteConversation(long userId, long conversationId);

    List<AiChatMessageResponse> getConversationMessages(long userId, long conversationId, int limit);

    List<AiChatMessageResponse> getHistory(long userId, int limit);

    void clearHistory(long userId);
}
