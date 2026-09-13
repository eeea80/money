package com.novatrade.auth;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.novatrade.user.entity.User;
import com.novatrade.user.mapper.UserMapper;
import jakarta.servlet.DispatcherType;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TokenAuthInterceptorTests {

    @Mock
    private TokenService tokenService;

    @Mock
    private UserMapper userMapper;

    @Test
    void requestDispatchAuthenticatesBearerToken() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer token-value");
        when(tokenService.authenticate("token-value")).thenReturn(7L);
        when(userMapper.selectCount(org.mockito.ArgumentMatchers.<Wrapper<User>>any())).thenReturn(1L);

        boolean result = interceptor().preHandle(request, new MockHttpServletResponse(), new Object());

        assertThat(result).isTrue();
        assertThat(request.getAttribute(AuthAttributes.USER_ID)).isEqualTo(7L);
        assertThat(request.getAttribute(AuthAttributes.TOKEN)).isEqualTo("token-value");
    }

    @Test
    void asyncSseDispatchDoesNotAuthenticateAgain() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setDispatcherType(DispatcherType.ASYNC);

        boolean result = interceptor().preHandle(request, new MockHttpServletResponse(), new Object());

        assertThat(result).isTrue();
        verify(tokenService, never()).authenticate(any());
    }

    private TokenAuthInterceptor interceptor() {
        return new TokenAuthInterceptor(tokenService, userMapper);
    }
}
