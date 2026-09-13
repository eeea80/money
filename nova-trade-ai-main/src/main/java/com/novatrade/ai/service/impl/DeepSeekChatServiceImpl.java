package com.novatrade.ai.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.novatrade.ai.dto.AiChatConversationResponse;
import com.novatrade.ai.dto.AiChatMessageResponse;
import com.novatrade.ai.dto.AiChatStreamResult;
import com.novatrade.ai.entity.AiChatConversation;
import com.novatrade.ai.entity.AiChatMessage;
import com.novatrade.ai.mapper.AiChatConversationMapper;
import com.novatrade.ai.mapper.AiChatMessageMapper;
import com.novatrade.ai.service.AiChatService;
import com.novatrade.common.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;

@Service
public class DeepSeekChatServiceImpl implements AiChatService {

    private static final Logger log = LoggerFactory.getLogger(DeepSeekChatServiceImpl.class);
    private static final String UNCONFIGURED_API_KEY = "not-configured";
    private static final String DEFAULT_TITLE = "新聊天";
    private static final int TITLE_MAX_LENGTH = 30;
    private static final String SYSTEM_PROMPT = """
            你是 Nova Trade AI，一个专业、谨慎的智能交易助手。
            请优先使用中文回答，内容要清晰、客观并说明关键风险。
            不得承诺收益，不得将一般性市场分析表述为确定性的投资建议。
            """;

    private final ChatClient chatClient;
    private final AiChatConversationMapper conversationMapper;
    private final AiChatMessageMapper messageMapper;
    private final String apiKey;
    private final String model;

    public DeepSeekChatServiceImpl(
            ChatClient.Builder chatClientBuilder,
            AiChatConversationMapper conversationMapper,
            AiChatMessageMapper messageMapper,
            @Value("${spring.ai.deepseek.api-key:}") String apiKey,
            @Value("${spring.ai.deepseek.chat.model:deepseek-v4-flash}") String model) {
        this.chatClient = chatClientBuilder.build();
        this.conversationMapper = conversationMapper;
        this.messageMapper = messageMapper;
        this.apiKey = apiKey;
        this.model = model;
    }

    @Override
    public AiChatStreamResult streamChat(long userId, Long conversationId, String message) {
        if (!StringUtils.hasText(apiKey) || UNCONFIGURED_API_KEY.equals(apiKey)) {
            throw BusinessException.serviceUnavailable("DeepSeek API Key 尚未配置");
        }

        String userMessage = message.trim();
        AiChatConversation conversation = conversationId == null
                ? createConversationEntity(userId)
                : getRequiredConversation(userId, conversationId);
        long resolvedConversationId = conversation.getId();
        saveMessage(userId, resolvedConversationId, "user", userMessage);
        touchConversation(conversation, userMessage);
        StringBuilder assistantMessage = new StringBuilder();

        Flux<String> content = chatClient.prompt()
                .system(SYSTEM_PROMPT)
                .user(userMessage)
                .stream()
                .content()
                .filter(StringUtils::hasText)
                .switchIfEmpty(Flux.error(BusinessException.serviceUnavailable("DeepSeek 未返回有效内容")))
                .doOnNext(assistantMessage::append)
                .doOnError(exception -> log.error("DeepSeek streaming chat request failed", exception))
                .onErrorMap(exception -> exception instanceof BusinessException
                        ? exception
                        : BusinessException.serviceUnavailable("DeepSeek 服务暂时不可用，请稍后重试"));

        Flux<String> persistedContent = content
                .onErrorResume(exception -> persistAssistant(userId, resolvedConversationId, assistantMessage)
                        .thenMany(Flux.error(exception)))
                .concatWith(Mono.defer(() -> persistAssistant(userId, resolvedConversationId, assistantMessage)));
        return new AiChatStreamResult(resolvedConversationId, persistedContent);
    }

    @Override
    public List<AiChatConversationResponse> getRecentConversations(long userId, int limit) {
        return conversationMapper.selectList(Wrappers.<AiChatConversation>lambdaQuery()
                        .eq(AiChatConversation::getUserId, userId)
                        .orderByDesc(AiChatConversation::getUpdatedAt)
                        .orderByDesc(AiChatConversation::getId)
                        .last("LIMIT " + limit))
                .stream()
                .map(AiChatConversationResponse::from)
                .toList();
    }

    @Override
    public AiChatConversationResponse createConversation(long userId) {
        return AiChatConversationResponse.from(createConversationEntity(userId));
    }

    @Override
    public void deleteConversation(long userId, long conversationId) {
        int deleted = conversationMapper.delete(Wrappers.<AiChatConversation>lambdaQuery()
                .eq(AiChatConversation::getId, conversationId)
                .eq(AiChatConversation::getUserId, userId));
        if (deleted == 0) {
            throw BusinessException.notFound("聊天会话不存在");
        }
    }

    @Override
    public List<AiChatMessageResponse> getConversationMessages(long userId, long conversationId, int limit) {
        getRequiredConversation(userId, conversationId);
        List<AiChatMessage> messages = messageMapper.selectList(Wrappers.<AiChatMessage>lambdaQuery()
                .eq(AiChatMessage::getUserId, userId)
                .eq(AiChatMessage::getConversationId, conversationId)
                .orderByDesc(AiChatMessage::getId)
                .last("LIMIT " + limit));
        Collections.reverse(messages);
        return messages.stream().map(AiChatMessageResponse::from).toList();
    }

    @Override
    public List<AiChatMessageResponse> getHistory(long userId, int limit) {
        List<AiChatMessage> messages = messageMapper.selectList(Wrappers.<AiChatMessage>lambdaQuery()
                .eq(AiChatMessage::getUserId, userId)
                .orderByDesc(AiChatMessage::getId)
                .last("LIMIT " + limit));
        Collections.reverse(messages);
        return messages.stream().map(AiChatMessageResponse::from).toList();
    }

    @Override
    public void clearHistory(long userId) {
        conversationMapper.delete(Wrappers.<AiChatConversation>lambdaQuery()
                .eq(AiChatConversation::getUserId, userId));
    }

    private Mono<String> persistAssistant(long userId, long conversationId, StringBuilder content) {
        if (content.isEmpty()) {
            return Mono.empty();
        }
        String response = content.toString();
        return Mono.fromRunnable(() -> {
                    saveMessage(userId, conversationId, "assistant", response);
                    updateConversationTime(conversationId);
                })
                .subscribeOn(Schedulers.boundedElastic())
                .onErrorResume(exception -> {
                    log.error("Failed to persist AI chat response for user {}", userId, exception);
                    return Mono.empty();
                })
                .then(Mono.empty());
    }

    private AiChatConversation createConversationEntity(long userId) {
        LocalDateTime now = LocalDateTime.now();
        AiChatConversation conversation = new AiChatConversation();
        conversation.setUserId(userId);
        conversation.setTitle(DEFAULT_TITLE);
        conversation.setCreatedAt(now);
        conversation.setUpdatedAt(now);
        conversationMapper.insert(conversation);
        if (conversation.getId() == null) {
            throw new IllegalStateException("创建聊天会话后未获取到会话 ID");
        }
        return conversation;
    }

    private AiChatConversation getRequiredConversation(long userId, long conversationId) {
        AiChatConversation conversation = conversationMapper.selectOne(Wrappers.<AiChatConversation>lambdaQuery()
                .eq(AiChatConversation::getId, conversationId)
                .eq(AiChatConversation::getUserId, userId));
        if (conversation == null) {
            throw BusinessException.notFound("聊天会话不存在");
        }
        return conversation;
    }

    private void touchConversation(AiChatConversation conversation, String firstMessage) {
        AiChatConversation update = new AiChatConversation();
        update.setId(conversation.getId());
        update.setUpdatedAt(LocalDateTime.now());
        if (DEFAULT_TITLE.equals(conversation.getTitle())) {
            update.setTitle(titleFrom(firstMessage));
        }
        conversationMapper.updateById(update);
    }

    private void updateConversationTime(long conversationId) {
        AiChatConversation update = new AiChatConversation();
        update.setId(conversationId);
        update.setUpdatedAt(LocalDateTime.now());
        conversationMapper.updateById(update);
    }

    private String titleFrom(String message) {
        String title = message.replaceAll("\\s+", " ").trim();
        return title.length() <= TITLE_MAX_LENGTH
                ? title
                : title.substring(0, TITLE_MAX_LENGTH) + "…";
    }

    private void saveMessage(long userId, long conversationId, String role, String content) {
        AiChatMessage message = new AiChatMessage();
        message.setUserId(userId);
        message.setConversationId(conversationId);
        message.setRole(role);
        message.setContent(content);
        message.setCreatedAt(LocalDateTime.now());
        messageMapper.insert(message);
    }
}
