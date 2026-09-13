package com.novatrade.auth;

import com.novatrade.common.BusinessException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

@Component
public class CurrentUser {

    private final HttpServletRequest request;

    public CurrentUser(HttpServletRequest request) {
        this.request = request;
    }

    public long id() {
        Object userId = request.getAttribute(AuthAttributes.USER_ID);
        if (userId instanceof Long value) {
            return value;
        }
        throw BusinessException.unauthorized("请先登录");
    }

    public String token() {
        Object token = request.getAttribute(AuthAttributes.TOKEN);
        if (token instanceof String value && !value.isBlank()) {
            return value;
        }
        throw BusinessException.unauthorized("请先登录");
    }
}
