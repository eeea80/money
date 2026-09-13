package com.novatrade.ai.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Getter
@Setter
@NoArgsConstructor
@TableName("ai_chat_message")
public class AiChatMessage {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;
    private Long userId;
    private Long conversationId;
    private String role;
    private String content;
    private LocalDateTime createdAt;
}
