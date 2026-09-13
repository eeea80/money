package com.novatrade.user.controller;

import com.novatrade.common.ApiResponse;
import com.novatrade.user.dto.LoginRequest;
import com.novatrade.user.dto.LoginResponse;
import com.novatrade.user.dto.RegisterRequest;
import com.novatrade.user.service.UserService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserService userService;

    public AuthController(UserService userService) {
        this.userService = userService;
    }

    @PostMapping("/register")
    public ApiResponse<LoginResponse> register(@Valid @RequestBody RegisterRequest request) {
        return ApiResponse.success(userService.register(request));
    }

    @PostMapping("/login")
    public ApiResponse<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        return ApiResponse.success(userService.login(request));
    }

    @PostMapping("/logout")
    public ApiResponse<Void> logout() {
        userService.logout();
        return ApiResponse.success();
    }
}
