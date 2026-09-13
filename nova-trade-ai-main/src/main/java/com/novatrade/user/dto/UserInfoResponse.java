package com.novatrade.user.dto;

import com.novatrade.user.entity.User;

import java.time.LocalDateTime;

public record UserInfoResponse(
        Long id,
        String username,
        String nickname,
        String email,
        String phone,
        String avatarUrl,
        LocalDateTime lastLoginAt,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
    public static UserInfoResponse from(User user) {
        return new UserInfoResponse(
                user.getId(), user.getUsername(), user.getNickname(), user.getEmail(), user.getPhone(), user.getAvatarUrl(),
                user.getLastLoginAt(), user.getCreatedAt(), user.getUpdatedAt());
    }
}
