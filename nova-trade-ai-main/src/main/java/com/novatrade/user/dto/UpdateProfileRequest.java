package com.novatrade.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record UpdateProfileRequest(
        @NotBlank(message = "昵称不能为空")
        @Size(max = 50, message = "昵称长度不能超过 50 个字符")
        String nickname,

        @Email(message = "邮箱格式不正确")
        @Size(max = 254, message = "邮箱长度不能超过 254 个字符")
        String email,

        @Pattern(regexp = "^$|^\\+?[0-9]{6,20}$", message = "手机号格式不正确")
        String phone,

        @Size(max = 500, message = "头像地址长度不能超过 500 个字符")
        String avatarUrl
) {
}
