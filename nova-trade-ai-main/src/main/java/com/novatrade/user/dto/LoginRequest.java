package com.novatrade.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record LoginRequest(
        @NotBlank(message = "用户名不能为空")
        @Size(max = 50, message = "用户名长度不能超过 50 个字符")
        String username,

        @NotBlank(message = "密码不能为空")
        @Size(max = 72, message = "密码长度不能超过 72 个字符")
        String password,

        Boolean rememberMe
) {
}
