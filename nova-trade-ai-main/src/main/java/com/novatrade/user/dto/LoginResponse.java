package com.novatrade.user.dto;

public record LoginResponse(
        String tokenName,
        String tokenPrefix,
        String tokenValue,
        long expiresIn,
        UserInfoResponse user
) {
}
