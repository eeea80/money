package com.novatrade.auth;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.novatrade.common.BusinessException;
import com.novatrade.user.entity.User;
import com.novatrade.user.mapper.UserMapper;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class TokenAuthInterceptor implements HandlerInterceptor {

    private static final String BEARER_PREFIX = "Bearer ";

    private final TokenService tokenService;
    private final UserMapper userMapper;

    public TokenAuthInterceptor(TokenService tokenService, UserMapper userMapper) {
        this.tokenService = tokenService;
        this.userMapper = userMapper;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        // SSE 在 Servlet 容器中会产生 ASYNC 二次派发，首次 REQUEST 已完成鉴权，无需重复校验。
        if (request.getDispatcherType() != DispatcherType.REQUEST) {
            return true;
        }

        String token = bearerToken(request.getHeader("Authorization"));
        long userId = tokenService.authenticate(token);
        if (!isEnabled(userId)) {
            tokenService.revokeAll(userId);
            throw BusinessException.forbidden("用户不存在或已被禁用");
        }

        request.setAttribute(AuthAttributes.USER_ID, userId);
        request.setAttribute(AuthAttributes.TOKEN, token);
        return true;
    }

    private String bearerToken(String authorization) {
        if (authorization == null || authorization.length() <= BEARER_PREFIX.length()
                || !authorization.regionMatches(true, 0, BEARER_PREFIX, 0, BEARER_PREFIX.length())) {
            throw BusinessException.unauthorized("请提供有效的 Bearer Token");
        }
        String token = authorization.substring(BEARER_PREFIX.length()).trim();
        if (token.isEmpty()) {
            throw BusinessException.unauthorized("请提供有效的 Bearer Token");
        }
        return token;
    }

    private boolean isEnabled(long userId) {
        return userMapper.selectCount(Wrappers.<User>lambdaQuery()
                .eq(User::getId, userId)
                .eq(User::getStatus, 1)) > 0;
    }
}
