package com.novatrade.user.service;

import com.baomidou.mybatisplus.spring.service.IService;
import com.novatrade.user.dto.ChangePasswordRequest;
import com.novatrade.user.dto.LoginRequest;
import com.novatrade.user.dto.LoginResponse;
import com.novatrade.user.dto.RegisterRequest;
import com.novatrade.user.dto.UpdateProfileRequest;
import com.novatrade.user.dto.UserInfoResponse;
import com.novatrade.user.entity.User;

public interface UserService extends IService<User> {

    LoginResponse register(RegisterRequest request);

    LoginResponse login(LoginRequest request);

    void logout();

    UserInfoResponse getCurrentUser();

    UserInfoResponse updateCurrentUser(UpdateProfileRequest request);

    void changePassword(ChangePasswordRequest request);
}
