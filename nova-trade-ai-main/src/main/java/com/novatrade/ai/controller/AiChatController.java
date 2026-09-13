package com.novatrade.ai.controller;

import com.novatrade.ai.dto.AiChatConversationResponse;
import com.novatrade.ai.dto.AiChatRequest;
import com.novatrade.ai.dto.AiChatMessageResponse;
import com.novatrade.ai.dto.AiChatStreamResult;
import com.novatrade.ai.dto.AiChatStreamEvent;
import com.novatrade.ai.service.AiChatService;
import com.novatrade.auth.CurrentUser;
import com.novatrade.common.ApiResponse;
import com.novatrade.common.BusinessException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.List;

@RestController
@RequestMapping("/api/ai")
@Validated
public class AiChatController {

    private final AiChatService aiChatService;
    private final CurrentUser currentUser;
    private final String model;

    public AiChatController(
            AiChatService aiChatService,
            CurrentUser currentUser,
            @Value("${spring.ai.deepseek.chat.model:deepseek-v4-flash}") String model) {
        this.aiChatService = aiChatService;
        this.currentUser = currentUser;
        this.model = model;
    }

    @PostMapping(value = "/chat", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<AiChatStreamEvent>> chat(@Valid @RequestBody AiChatRequest request) {
        long userId = currentUser.id();
        AiChatStreamResult stream = aiChatService.streamChat(userId, request.conversationId(), request.message());
        long conversationId = stream.conversationId();
        Flux<ServerSentEvent<AiChatStreamEvent>> messages = stream.content()
                .map(content -> event("message", AiChatStreamEvent.message(content, model, conversationId)));

        return messages
                .concatWith(Mono.just(event("done", AiChatStreamEvent.done(model, conversationId))))
                .onErrorResume(exception -> Flux.just(event(
                        "error",
                        AiChatStreamEvent.error(errorMessage(exception), model, conversationId))));
    }

    @GetMapping("/conversations")
    public ApiResponse<List<AiChatConversationResponse>> conversations(
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int limit) {
        return ApiResponse.success(aiChatService.getRecentConversations(currentUser.id(), limit));
    }

    @PostMapping("/conversations")
    public ApiResponse<AiChatConversationResponse> createConversation() {
        return ApiResponse.success(aiChatService.createConversation(currentUser.id()));
    }

    @DeleteMapping("/conversations/{conversationId}")
    public ApiResponse<Void> deleteConversation(@PathVariable @Min(1) long conversationId) {
        aiChatService.deleteConversation(currentUser.id(), conversationId);
        return ApiResponse.success();
    }

    @GetMapping("/conversations/{conversationId}/messages")
    public ApiResponse<List<AiChatMessageResponse>> conversationMessages(
            @PathVariable @Min(1) long conversationId,
            @RequestParam(defaultValue = "100") @Min(1) @Max(200) int limit) {
        return ApiResponse.success(
                aiChatService.getConversationMessages(currentUser.id(), conversationId, limit));
    }

    @GetMapping("/chat/history")
    public ApiResponse<List<AiChatMessageResponse>> history(
            @RequestParam(defaultValue = "100") @Min(1) @Max(200) int limit) {
        return ApiResponse.success(aiChatService.getHistory(currentUser.id(), limit));
    }

    @DeleteMapping("/chat/history")
    public ApiResponse<Void> clearHistory() {
        aiChatService.clearHistory(currentUser.id());
        return ApiResponse.success();
    }

    private ServerSentEvent<AiChatStreamEvent> event(String event, AiChatStreamEvent data) {
        return ServerSentEvent.<AiChatStreamEvent>builder(data)
                .event(event)
                .build();
    }

    private String errorMessage(Throwable exception) {
        if (exception instanceof BusinessException businessException) {
            return businessException.getMessage();
        }
        return "DeepSeek 服务暂时不可用，请稍后重试";
    }
}
