package com.novatrade.user.controller;

import com.novatrade.common.ApiResponse;
import com.novatrade.user.dto.ChangePasswordRequest;
import com.novatrade.user.dto.UpdateProfileRequest;
import com.novatrade.user.dto.UserInfoResponse;
import com.novatrade.user.service.UserService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users/me")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping
    public ApiResponse<UserInfoResponse> getCurrentUser() {
        return ApiResponse.success(userService.getCurrentUser());
    }

    @PutMapping
    public ApiResponse<UserInfoResponse> updateCurrentUser(@Valid @RequestBody UpdateProfileRequest request) {
        return ApiResponse.success(userService.updateCurrentUser(request));
    }

    @PutMapping("/password")
    public ApiResponse<Void> changePassword(@Valid @RequestBody ChangePasswordRequest request) {
        userService.changePassword(request);
        return ApiResponse.success();
    }
}
