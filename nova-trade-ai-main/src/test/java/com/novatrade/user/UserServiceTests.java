package com.novatrade.user;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.novatrade.auth.CurrentUser;
import com.novatrade.auth.TokenService;
import com.novatrade.common.BusinessException;
import com.novatrade.user.dto.ChangePasswordRequest;
import com.novatrade.user.dto.LoginRequest;
import com.novatrade.user.dto.RegisterRequest;
import com.novatrade.user.entity.User;
import com.novatrade.user.mapper.UserMapper;
import com.novatrade.user.service.UserService;
import com.novatrade.user.service.impl.UserServiceImpl;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class UserServiceTests {

    @Mock
    private UserMapper userMapper;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private TokenService tokenService;

    @Mock
    private CurrentUser currentUser;

    @Test
    void loginReturnsTokenAndRefreshesLastLoginTime() {
        User beforeLogin = user(1L, "encoded-password", 1);
        User afterLogin = user(1L, "encoded-password", 1);
        when(userMapper.selectOne(org.mockito.ArgumentMatchers.<Wrapper<User>>any())).thenReturn(beforeLogin);
        when(passwordEncoder.matches("password123", "encoded-password")).thenReturn(true);
        when(userMapper.selectById(1L)).thenReturn(afterLogin);

        when(tokenService.issue(1L, 7200L))
                .thenReturn(new TokenService.IssuedToken("token-value", 7200L));

        var response = service().login(new LoginRequest("nova", "password123", false));

        assertThat(response.tokenName()).isEqualTo("Authorization");
        assertThat(response.tokenValue()).isEqualTo("token-value");
        assertThat(response.expiresIn()).isEqualTo(7200L);
        assertThat(response.user().id()).isEqualTo(1L);
        verify(tokenService).issue(1L, 7200L);
        verify(userMapper).updateById(any(User.class));
    }

    @Test
    void loginRejectsWrongPasswordWithoutRevealingAccountState() {
        when(userMapper.selectOne(org.mockito.ArgumentMatchers.<Wrapper<User>>any()))
                .thenReturn(user(1L, "encoded-password", 1));
        when(passwordEncoder.matches("wrong-password", "encoded-password")).thenReturn(false);

        assertThatThrownBy(() -> service().login(new LoginRequest("nova", "wrong-password", false)))
                .isInstanceOf(BusinessException.class)
                .hasMessage("用户名或密码错误");

        verify(userMapper, never()).updateById(any(User.class));
    }

    @Test
    void loginRejectsDisabledUser() {
        when(userMapper.selectOne(org.mockito.ArgumentMatchers.<Wrapper<User>>any()))
                .thenReturn(user(1L, "encoded-password", 0));
        when(passwordEncoder.matches("password123", "encoded-password")).thenReturn(true);

        assertThatThrownBy(() -> service().login(new LoginRequest("nova", "password123", false)))
                .isInstanceOf(BusinessException.class)
                .hasMessage("用户已被禁用");
    }

    @Test
    void registerRejectsDuplicateUsernameBeforeWriting() {
        when(userMapper.selectCount(org.mockito.ArgumentMatchers.<Wrapper<User>>any())).thenReturn(1L);
        RegisterRequest request = new RegisterRequest("nova", "password123", "Nova", null, null);

        assertThatThrownBy(() -> service().register(request))
                .isInstanceOf(BusinessException.class)
                .hasMessage("用户名已被使用");

        verify(userMapper, never()).insert(any(User.class));
    }

    @Test
    void changePasswordUpdatesHashAndLogsOutAllSessions() {
        when(userMapper.selectById(1L)).thenReturn(user(1L, "old-hash", 1));
        when(passwordEncoder.matches("old-password", "old-hash")).thenReturn(true);
        when(passwordEncoder.matches("new-password", "old-hash")).thenReturn(false);
        when(passwordEncoder.encode("new-password")).thenReturn("new-hash");

        when(currentUser.id()).thenReturn(1L);

        service().changePassword(new ChangePasswordRequest("old-password", "new-password"));

        verify(tokenService).revokeAll(1L);
        verify(userMapper).updateById(any(User.class));
    }

    private UserService service() {
        return new UserServiceImpl(userMapper, passwordEncoder, tokenService, currentUser);
    }

    private User user(long id, String passwordHash, int status) {
        LocalDateTime now = LocalDateTime.now();
        User user = new User();
        user.setId(id);
        user.setUsername("nova");
        user.setPasswordHash(passwordHash);
        user.setNickname("Nova");
        user.setEmail("nova@example.com");
        user.setStatus(status);
        user.setCreatedAt(now);
        user.setUpdatedAt(now);
        return user;
    }
}
