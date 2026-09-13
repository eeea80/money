package com.novatrade.ai.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record AiChatRequest(
        @Positive(message = "会话 ID 不正确")
        Long conversationId,
        @NotBlank(message = "对话内容不能为空")
        @Size(max = 4000, message = "对话内容不能超过 4000 个字符")
        String message
) {
}
