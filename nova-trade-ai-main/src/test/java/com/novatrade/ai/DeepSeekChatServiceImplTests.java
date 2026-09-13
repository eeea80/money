package com.novatrade.ai;

import com.novatrade.ai.entity.AiChatConversation;
import com.novatrade.ai.entity.AiChatMessage;
import com.novatrade.ai.mapper.AiChatConversationMapper;
import com.novatrade.ai.mapper.AiChatMessageMapper;
import com.novatrade.common.BusinessException;
import com.novatrade.ai.service.impl.DeepSeekChatServiceImpl;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.chat.client.ChatClient;
import reactor.core.publisher.Flux;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.RETURNS_DEEP_STUBS;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DeepSeekChatServiceImplTests {

    @Test
    void rejectsRequestWhenApiKeyIsNotConfigured() {
        ChatClient.Builder builder = mock(ChatClient.Builder.class);
        when(builder.build()).thenReturn(mock(ChatClient.class));
        var service = new DeepSeekChatServiceImpl(
                builder,
                mock(AiChatConversationMapper.class),
                mock(AiChatMessageMapper.class),
                "not-configured",
                "deepseek-v4-flash");

        assertThatThrownBy(() -> service.streamChat(1L, 1L, "你好"))
                .isInstanceOf(BusinessException.class)
                .hasMessage("DeepSeek API Key 尚未配置")
                .extracting("code")
                .isEqualTo(503);
    }

    @Test
    void streamsDeepSeekContentChunks() {
        ChatClient chatClient = mock(ChatClient.class, RETURNS_DEEP_STUBS);
        ChatClient.Builder builder = mock(ChatClient.Builder.class);
        AiChatConversationMapper conversationMapper = mock(AiChatConversationMapper.class);
        AiChatMessageMapper messageMapper = mock(AiChatMessageMapper.class);
        when(builder.build()).thenReturn(chatClient);
        when(conversationMapper.selectOne(org.mockito.ArgumentMatchers.any()))
                .thenReturn(conversation(5L, 7L, "新聊天"));
        when(chatClient.prompt().system(anyString()).user("分析黄金走势").stream().content())
                .thenReturn(Flux.just("黄金短期", "波动上升，", "需要关注风险。"));
        var service = new DeepSeekChatServiceImpl(
                builder, conversationMapper, messageMapper, "test-key", "deepseek-v4-flash");

        var stream = service.streamChat(7L, 5L, "分析黄金走势");
        var chunks = stream.content().collectList().block();

        assertThat(stream.conversationId()).isEqualTo(5L);
        assertThat(chunks).containsExactly("黄金短期", "波动上升，", "需要关注风险。");
        ArgumentCaptor<AiChatMessage> captor = ArgumentCaptor.forClass(AiChatMessage.class);
        verify(messageMapper, times(2)).insert(captor.capture());
        assertThat(captor.getAllValues())
                .extracting(AiChatMessage::getConversationId, AiChatMessage::getRole, AiChatMessage::getContent)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(5L, "user", "分析黄金走势"),
                        org.assertj.core.groups.Tuple.tuple(5L, "assistant", "黄金短期波动上升，需要关注风险。"));
    }

    @Test
    void returnsHistoryInChronologicalOrder() {
        ChatClient.Builder builder = mock(ChatClient.Builder.class);
        AiChatConversationMapper conversationMapper = mock(AiChatConversationMapper.class);
        AiChatMessageMapper messageMapper = mock(AiChatMessageMapper.class);
        when(builder.build()).thenReturn(mock(ChatClient.class));
        when(messageMapper.selectList(org.mockito.ArgumentMatchers.any()))
                .thenReturn(new ArrayList<>(List.of(
                        message(2L, "assistant", "你好"),
                        message(1L, "user", "在吗"))));
        var service = new DeepSeekChatServiceImpl(
                builder, conversationMapper, messageMapper, "test-key", "deepseek-v4-flash");

        var history = service.getHistory(7L, 100);

        assertThat(history).extracting("id", "role", "content")
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(1L, "user", "在吗"),
                        org.assertj.core.groups.Tuple.tuple(2L, "assistant", "你好"));
    }

    @Test
    void clearsOnlyCurrentUsersHistory() {
        ChatClient.Builder builder = mock(ChatClient.Builder.class);
        AiChatConversationMapper conversationMapper = mock(AiChatConversationMapper.class);
        AiChatMessageMapper messageMapper = mock(AiChatMessageMapper.class);
        when(builder.build()).thenReturn(mock(ChatClient.class));
        var service = new DeepSeekChatServiceImpl(
                builder, conversationMapper, messageMapper, "test-key", "deepseek-v4-flash");

        service.clearHistory(7L);

        verify(conversationMapper).delete(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void createsANewConversation() {
        ChatClient.Builder builder = mock(ChatClient.Builder.class);
        AiChatConversationMapper conversationMapper = mock(AiChatConversationMapper.class);
        when(builder.build()).thenReturn(mock(ChatClient.class));
        doAnswer(invocation -> {
            invocation.getArgument(0, AiChatConversation.class).setId(9L);
            return 1;
        }).when(conversationMapper).insert(org.mockito.ArgumentMatchers.any(AiChatConversation.class));
        var service = new DeepSeekChatServiceImpl(
                builder, conversationMapper, mock(AiChatMessageMapper.class), "test-key", "deepseek-v4-flash");

        var created = service.createConversation(7L);

        assertThat(created.id()).isEqualTo(9L);
        assertThat(created.title()).isEqualTo("新聊天");
    }

    @Test
    void returnsRecentConversationsInMapperOrder() {
        ChatClient.Builder builder = mock(ChatClient.Builder.class);
        AiChatConversationMapper conversationMapper = mock(AiChatConversationMapper.class);
        when(builder.build()).thenReturn(mock(ChatClient.class));
        when(conversationMapper.selectList(org.mockito.ArgumentMatchers.any()))
                .thenReturn(List.of(
                        conversation(2L, 7L, "今天的聊天"),
                        conversation(1L, 7L, "昨天的聊天")));
        var service = new DeepSeekChatServiceImpl(
                builder, conversationMapper, mock(AiChatMessageMapper.class), "test-key", "deepseek-v4-flash");

        var conversations = service.getRecentConversations(7L, 20);

        assertThat(conversations).extracting("id", "title")
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(2L, "今天的聊天"),
                        org.assertj.core.groups.Tuple.tuple(1L, "昨天的聊天"));
    }

    @Test
    void rejectsDeletingAnotherUsersConversation() {
        ChatClient.Builder builder = mock(ChatClient.Builder.class);
        AiChatConversationMapper conversationMapper = mock(AiChatConversationMapper.class);
        when(builder.build()).thenReturn(mock(ChatClient.class));
        when(conversationMapper.delete(org.mockito.ArgumentMatchers.any())).thenReturn(0);
        var service = new DeepSeekChatServiceImpl(
                builder, conversationMapper, mock(AiChatMessageMapper.class), "test-key", "deepseek-v4-flash");

        assertThatThrownBy(() -> service.deleteConversation(7L, 99L))
                .isInstanceOf(BusinessException.class)
                .hasMessage("聊天会话不存在");
    }

    private AiChatMessage message(long id, String role, String content) {
        AiChatMessage message = new AiChatMessage();
        message.setId(id);
        message.setUserId(7L);
        message.setConversationId(5L);
        message.setRole(role);
        message.setContent(content);
        message.setCreatedAt(LocalDateTime.now());
        return message;
    }

    private AiChatConversation conversation(long id, long userId, String title) {
        AiChatConversation conversation = new AiChatConversation();
        conversation.setId(id);
        conversation.setUserId(userId);
        conversation.setTitle(title);
        conversation.setCreatedAt(LocalDateTime.now());
        conversation.setUpdatedAt(LocalDateTime.now());
        return conversation;
    }
}
