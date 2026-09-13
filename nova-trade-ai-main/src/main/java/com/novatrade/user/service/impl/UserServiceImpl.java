package com.novatrade.user.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.spring.service.impl.ServiceImpl;
import com.novatrade.auth.CurrentUser;
import com.novatrade.auth.TokenService;
import com.novatrade.common.BusinessException;
import com.novatrade.user.dto.ChangePasswordRequest;
import com.novatrade.user.dto.LoginRequest;
import com.novatrade.user.dto.LoginResponse;
import com.novatrade.user.dto.RegisterRequest;
import com.novatrade.user.dto.UpdateProfileRequest;
import com.novatrade.user.dto.UserInfoResponse;
import com.novatrade.user.entity.User;
import com.novatrade.user.mapper.UserMapper;
import com.novatrade.user.service.UserService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Locale;

@Service
public class UserServiceImpl extends ServiceImpl<UserMapper, User> implements UserService {

    private static final long NORMAL_LOGIN_TIMEOUT = 2 * 60 * 60;
    private static final long REMEMBER_ME_TIMEOUT = 30 * 24 * 60 * 60;

    private final UserMapper userMapper;
    private final PasswordEncoder passwordEncoder;
    private final TokenService tokenService;
    private final CurrentUser currentUser;

    public UserServiceImpl(
            UserMapper userMapper,
            PasswordEncoder passwordEncoder,
            TokenService tokenService,
            CurrentUser currentUser) {
        this.userMapper = userMapper;
        this.passwordEncoder = passwordEncoder;
        this.tokenService = tokenService;
        this.currentUser = currentUser;
    }

    @Override
    @Transactional
    public LoginResponse register(RegisterRequest request) {
        String username = request.username().trim();
        String email = normalizeEmail(request.email());
        String phone = normalizeNullable(request.phone());
        ensureUnique(username, email, phone, null);

        LocalDateTime now = LocalDateTime.now();
        User user = new User();
        user.setUsername(username);
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setNickname(request.nickname().trim());
        user.setEmail(email);
        user.setPhone(phone);
        user.setStatus(1);
        user.setCreatedAt(now);
        user.setUpdatedAt(now);

        try {
            userMapper.insert(user);
        } catch (DataIntegrityViolationException exception) {
            throw BusinessException.conflict("用户名、邮箱或手机号已被使用");
        }
        if (user.getId() == null) {
            throw new IllegalStateException("创建用户后未获取到用户 ID");
        }
        return createLogin(getRequiredUser(user.getId()), REMEMBER_ME_TIMEOUT);
    }

    @Override
    @Transactional
    public LoginResponse login(LoginRequest request) {
        User user = findByUsername(request.username().trim());
        if (user == null || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw BusinessException.unauthorized("用户名或密码错误");
        }
        if (!Integer.valueOf(1).equals(user.getStatus())) {
            throw BusinessException.forbidden("用户已被禁用");
        }

        LocalDateTime now = LocalDateTime.now();
        User update = new User();
        update.setId(user.getId());
        update.setLastLoginAt(now);
        update.setUpdatedAt(now);
        userMapper.updateById(update);

        User latestUser = getRequiredUser(user.getId());
        long timeout = Boolean.TRUE.equals(request.rememberMe()) ? REMEMBER_ME_TIMEOUT : NORMAL_LOGIN_TIMEOUT;
        return createLogin(latestUser, timeout);
    }

    @Override
    public void logout() {
        tokenService.revoke(currentUser.token());
    }

    @Override
    @Transactional(readOnly = true)
    public UserInfoResponse getCurrentUser() {
        return UserInfoResponse.from(getRequiredUser(currentUserId()));
    }

    @Override
    @Transactional
    public UserInfoResponse updateCurrentUser(UpdateProfileRequest request) {
        long userId = currentUserId();
        String email = normalizeEmail(request.email());
        String phone = normalizeNullable(request.phone());
        ensureUnique(null, email, phone, userId);

        try {
            userMapper.update(null, Wrappers.<User>lambdaUpdate()
                    .eq(User::getId, userId)
                    .set(User::getNickname, request.nickname().trim())
                    .set(User::getEmail, email)
                    .set(User::getPhone, phone)
                    .set(User::getAvatarUrl, normalizeNullable(request.avatarUrl()))
                    .set(User::getUpdatedAt, LocalDateTime.now()));
        } catch (DataIntegrityViolationException exception) {
            throw BusinessException.conflict("邮箱或手机号已被使用");
        }
        return UserInfoResponse.from(getRequiredUser(userId));
    }

    @Override
    @Transactional
    public void changePassword(ChangePasswordRequest request) {
        long userId = currentUserId();
        User user = getRequiredUser(userId);
        if (!passwordEncoder.matches(request.oldPassword(), user.getPasswordHash())) {
            throw BusinessException.badRequest("原密码不正确");
        }
        if (passwordEncoder.matches(request.newPassword(), user.getPasswordHash())) {
            throw BusinessException.badRequest("新密码不能与原密码相同");
        }

        User update = new User();
        update.setId(userId);
        update.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        update.setUpdatedAt(LocalDateTime.now());
        userMapper.updateById(update);
        tokenService.revokeAll(userId);
    }

    private LoginResponse createLogin(User user, long timeout) {
        TokenService.IssuedToken token = tokenService.issue(user.getId(), timeout);
        return new LoginResponse(
                "Authorization",
                "Bearer",
                token.value(),
                token.expiresInSeconds(),
                UserInfoResponse.from(user));
    }

    private long currentUserId() {
        return currentUser.id();
    }

    private User getRequiredUser(long userId) {
        User user = userMapper.selectById(userId);
        if (user == null) {
            throw BusinessException.notFound("用户不存在");
        }
        return user;
    }

    private User findByUsername(String username) {
        return userMapper.selectOne(Wrappers.<User>lambdaQuery()
                .eq(User::getUsername, username));
    }

    private void ensureUnique(String username, String email, String phone, Long excludeUserId) {
        if (username != null && userMapper.selectCount(Wrappers.<User>lambdaQuery()
                .eq(User::getUsername, username)) > 0) {
            throw BusinessException.conflict("用户名已被使用");
        }
        if (email != null && userMapper.selectCount(Wrappers.<User>lambdaQuery()
                .apply("LOWER(email) = LOWER({0})", email)
                .ne(excludeUserId != null, User::getId, excludeUserId)) > 0) {
            throw BusinessException.conflict("邮箱已被使用");
        }
        if (phone != null && userMapper.selectCount(Wrappers.<User>lambdaQuery()
                .eq(User::getPhone, phone)
                .ne(excludeUserId != null, User::getId, excludeUserId)) > 0) {
            throw BusinessException.conflict("手机号已被使用");
        }
    }

    private String normalizeEmail(String value) {
        String normalized = normalizeNullable(value);
        return normalized == null ? null : normalized.toLowerCase(Locale.ROOT);
    }

    private String normalizeNullable(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
    }
}
