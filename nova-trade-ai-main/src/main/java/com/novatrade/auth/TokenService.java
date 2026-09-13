package com.novatrade.auth;

import com.novatrade.common.BusinessException;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class TokenService {

    private static final int TOKEN_BYTES = 32;

    private final SecureRandom secureRandom = new SecureRandom();
    private final Map<String, TokenSession> sessions = new ConcurrentHashMap<>();

    public IssuedToken issue(long userId, long expiresInSeconds) {
        TokenSession session = new TokenSession(userId, Instant.now().plusSeconds(expiresInSeconds));
        String token;
        do {
            byte[] randomBytes = new byte[TOKEN_BYTES];
            secureRandom.nextBytes(randomBytes);
            token = Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
        } while (sessions.putIfAbsent(token, session) != null);

        return new IssuedToken(token, expiresInSeconds);
    }

    public long authenticate(String token) {
        if (token == null || token.isBlank()) {
            throw BusinessException.unauthorized("请先登录");
        }

        TokenSession session = sessions.get(token);
        if (session == null) {
            throw BusinessException.unauthorized("登录状态已失效，请重新登录");
        }
        if (!session.expiresAt().isAfter(Instant.now())) {
            sessions.remove(token, session);
            throw BusinessException.unauthorized("登录状态已过期，请重新登录");
        }
        return session.userId();
    }

    public void revoke(String token) {
        if (token != null) {
            sessions.remove(token);
        }
    }

    public void revokeAll(long userId) {
        sessions.entrySet().removeIf(entry -> entry.getValue().userId() == userId);
    }

    public record IssuedToken(String value, long expiresInSeconds) {
    }

    private record TokenSession(long userId, Instant expiresAt) {
    }
}
