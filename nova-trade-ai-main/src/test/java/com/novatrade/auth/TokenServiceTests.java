package com.novatrade.auth;

import com.novatrade.common.BusinessException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TokenServiceTests {

    private final TokenService tokenService = new TokenService();

    @Test
    void issuedTokenCanAuthenticateAndBeRevoked() {
        TokenService.IssuedToken issued = tokenService.issue(42L, 3600L);

        assertThat(issued.value()).isNotBlank();
        assertThat(issued.expiresInSeconds()).isEqualTo(3600L);
        assertThat(tokenService.authenticate(issued.value())).isEqualTo(42L);

        tokenService.revoke(issued.value());
        assertThatThrownBy(() -> tokenService.authenticate(issued.value()))
                .isInstanceOf(BusinessException.class)
                .hasMessage("登录状态已失效，请重新登录");
    }

    @Test
    void expiredTokenIsRejected() {
        TokenService.IssuedToken issued = tokenService.issue(42L, 0L);

        assertThatThrownBy(() -> tokenService.authenticate(issued.value()))
                .isInstanceOf(BusinessException.class)
                .hasMessage("登录状态已过期，请重新登录");
    }
}
