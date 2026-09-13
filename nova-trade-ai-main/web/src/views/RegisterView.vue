<script setup>
import { reactive, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import InlineNotice from '../components/InlineNotice.vue'
import PageHeader from '../components/PageHeader.vue'
import { saveSession } from '../services/session'
import { userApi } from '../services/userApi'

const router = useRouter()
const form = reactive({
  username: '',
  nickname: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
})
const loading = ref(false)
const error = ref('')
const showPassword = ref(false)

async function submit() {
  error.value = ''
  if (form.password !== form.confirmPassword) {
    error.value = '两次输入的密码不一致'
    return
  }

  loading.value = true
  try {
    const result = await userApi.register({
      username: form.username,
      nickname: form.nickname,
      email: form.email || null,
      phone: form.phone || null,
      password: form.password,
    })
    saveSession(result)
    await router.replace('/home')
  } catch (exception) {
    error.value = exception.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="screen register-screen">
    <PageHeader title="创建 Nova 账号" subtitle="只需一分钟，开启你的智能交易空间。" />
    <section class="content-card register-card">
      <div class="section-heading">
        <span>基础信息</span>
        <small>所有带 * 项均为必填</small>
      </div>

      <InlineNotice :message="error" />

      <form class="form-grid" @submit.prevent="submit">
        <label class="field">
          <span class="field__label">用户名 *</span>
          <span class="field__control">
            <input
              v-model.trim="form.username"
              name="username"
              autocomplete="username"
              pattern="[A-Za-z][A-Za-z0-9_]{3,49}"
              maxlength="50"
              placeholder="4-50 位字母、数字或下划线"
              required
            />
          </span>
        </label>

        <label class="field">
          <span class="field__label">昵称 *</span>
          <span class="field__control">
            <input v-model.trim="form.nickname" name="nickname" maxlength="50" placeholder="希望大家怎么称呼你" required />
          </span>
        </label>

        <label class="field">
          <span class="field__label">邮箱<span class="field__optional">选填</span></span>
          <span class="field__control">
            <input v-model.trim="form.email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="name@example.com" />
          </span>
        </label>

        <label class="field">
          <span class="field__label">手机号<span class="field__optional">选填</span></span>
          <span class="field__control">
            <input v-model.trim="form.phone" name="phone" type="tel" autocomplete="tel" pattern="\+?[0-9]{6,20}" maxlength="20" placeholder="请输入手机号" />
          </span>
        </label>

        <label class="field">
          <span class="field__label">登录密码 *</span>
          <span class="field__control field__control--action">
            <input
              v-model="form.password"
              name="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              minlength="7"
              maxlength="72"
              placeholder="至少 7 个字符"
              required
            />
            <button class="field__action" type="button" @click="showPassword = !showPassword">
              {{ showPassword ? '隐藏' : '显示' }}
            </button>
          </span>
        </label>

        <label class="field">
          <span class="field__label">确认密码 *</span>
          <span class="field__control">
            <input v-model="form.confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="7" maxlength="72" placeholder="再次输入密码" required />
          </span>
        </label>

        <div class="form-actions">
          <button class="button button--primary button--block" type="submit" :disabled="loading">
            <span v-if="loading" class="button__spinner"></span>
            {{ loading ? '正在创建...' : '创建并登录' }}
          </button>
        </div>
      </form>

      <p class="register-card__footer">已有账号？<RouterLink to="/login">返回登录</RouterLink></p>
    </section>
  </main>
</template>

<style scoped>
.register-screen {
  padding-bottom: 24px;
}

.register-card {
  border-radius: 24px;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22px;
  color: var(--ink);
  font-size: 16px;
  font-weight: 800;
}

.section-heading small {
  color: #9aa7b5;
  font-size: 10px;
  font-weight: 500;
}

.register-card__footer {
  margin: 22px 0 0;
  color: #8795a6;
  text-align: center;
  font-size: 13px;
}

.register-card__footer a {
  color: var(--brand);
  font-weight: 800;
}
</style>
