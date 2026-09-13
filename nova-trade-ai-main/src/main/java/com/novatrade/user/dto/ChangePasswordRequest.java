package com.novatrade.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ChangePasswordRequest(
        @NotBlank(message = "原密码不能为空")
        @Size(max = 72, message = "原密码长度不能超过 72 个字符")
        String oldPassword,

        @NotBlank(message = "新密码不能为空")
        @Size(min = 8, max = 72, message = "新密码长度须为 8-72 个字符")
        String newPassword
) {
}
