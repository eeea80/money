<script setup>
import { computed, reactive, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import InlineNotice from '../components/InlineNotice.vue'
import NovaLogo from '../components/NovaLogo.vue'
import { saveSession } from '../services/session'
import { userApi } from '../services/userApi'

const router = useRouter()
const route = useRoute()
const form = reactive({
  username: '',
  password: '',
  rememberMe: true,
})
const loading = ref(false)
const error = ref('')
const showPassword = ref(false)
const successMessage = computed(() => route.query.changed === '1' ? '密码修改成功，请使用新密码登录' : '')

async function submit() {
  error.value = ''
  loading.value = true
  try {
    const result = await userApi.login(form)
    saveSession(result, form.rememberMe)
    const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/home'
    await router.replace(target)
  } catch (exception) {
    error.value = exception.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="auth-screen">
    <section class="auth-hero">
      <div class="auth-hero__top">
        <NovaLogo />
        <span class="auth-hero__status"><i></i> SECURE</span>
      </div>
      <div class="auth-hero__copy">
        <p class="eyebrow">WELCOME BACK</p>
        <h1>让每一次决策<br /><span>更有远见</span></h1>
        <p>登录 Nova Trade AI，进入你的智能交易空间。</p>
      </div>
      <div class="auth-hero__chart" aria-hidden="true">
        <span v-for="height in [24, 36, 30, 52, 45, 68, 58, 82, 72, 92]" :key="height" :style="{ height: `${height}%` }"></span>
      </div>
    </section>

    <section class="auth-panel">
      <div class="auth-panel__heading">
        <div>
          <h2>账号登录</h2>
          <p>欢迎回来，请输入你的账号信息</p>
        </div>
        <span class="auth-panel__number">01</span>
      </div>

      <InlineNotice type="success" :message="successMessage" />
      <InlineNotice :message="error" />

      <form class="form-grid" @submit.prevent="submit">
        <label class="field">
          <span class="field__label">用户名</span>
          <span class="field__control">
            <input v-model.trim="form.username" name="username" autocomplete="username" maxlength="50" placeholder="请输入用户名" required />
          </span>
        </label>

        <label class="field">
          <span class="field__label">密码</span>
          <span class="field__control field__control--action">
            <input
              v-model="form.password"
              name="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              maxlength="72"
              placeholder="请输入密码"
              required
            />
            <button class="field__action" type="button" @click="showPassword = !showPassword">
              {{ showPassword ? '隐藏' : '显示' }}
            </button>
          </span>
        </label>

        <label class="remember-row">
          <input v-model="form.rememberMe" type="checkbox" />
          <span class="remember-row__check">✓</span>
          <span>保持登录状态</span>
          <small>30 天</small>
        </label>

        <button class="button button--primary button--block" type="submit" :disabled="loading">
          <span v-if="loading" class="button__spinner"></span>
          {{ loading ? '登录中...' : '进入 Nova' }}
          <svg v-if="!loading" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>

      <p class="auth-panel__footer">
        还没有账号？<RouterLink to="/register">立即创建</RouterLink>
      </p>
    </section>
  </main>
</template>

<style scoped>
.auth-screen {
  min-height: 100vh;
  padding-bottom: calc(22px + env(safe-area-inset-bottom));
  background: #f5f7fa;
}

.auth-hero {
  position: relative;
  min-height: 362px;
  overflow: hidden;
  padding: calc(22px + env(safe-area-inset-top)) 24px 88px;
  color: white;
  background:
    radial-gradient(circle at 85% 12%, rgba(44, 113, 255, 0.42), transparent 34%),
    radial-gradient(circle at 12% 72%, rgba(38, 200, 178, 0.13), transparent 28%),
    linear-gradient(150deg, #061321, #0a253a 72%, #0d3046);
}

.auth-hero::before {
  position: absolute;
  top: 80px;
  right: -80px;
  width: 230px;
  height: 230px;
  border: 1px solid rgba(91, 229, 210, 0.13);
  border-radius: 50%;
  box-shadow: 0 0 0 38px rgba(91, 229, 210, 0.025), 0 0 0 76px rgba(91, 229, 210, 0.015);
  content: '';
}

.auth-hero__top {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.auth-hero__status {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #8ba3b8;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.15em;
}

.auth-hero__status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #5be5d2;
  box-shadow: 0 0 10px #5be5d2;
}

.auth-hero__copy {
  position: relative;
  z-index: 2;
  margin-top: 54px;
}

.auth-hero__copy h1 {
  margin: 10px 0 14px;
  font-size: 35px;
  line-height: 1.27;
  letter-spacing: -0.04em;
}

.auth-hero__copy h1 span {
  color: #5be5d2;
}

.auth-hero__copy > p:last-child {
  max-width: 295px;
  margin: 0;
  color: #9db0c2;
  font-size: 13px;
  line-height: 1.7;
}

.auth-hero__chart {
  position: absolute;
  right: 22px;
  bottom: 58px;
  display: flex;
  width: 92px;
  height: 52px;
  align-items: flex-end;
  gap: 4px;
  opacity: 0.44;
  transform: skewY(-10deg);
}

.auth-hero__chart span {
  flex: 1;
  min-height: 5px;
  border-radius: 2px 2px 0 0;
  background: linear-gradient(#5be5d2, rgba(91, 229, 210, 0.08));
}

.auth-panel {
  position: relative;
  z-index: 3;
  margin: -44px 16px 0;
  padding: 25px 21px;
  border: 1px solid rgba(224, 231, 238, 0.9);
  border-radius: 24px;
  background: white;
  box-shadow: var(--shadow);
}

.auth-panel__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
}

.auth-panel__heading h2 {
  margin: 0 0 7px;
  color: var(--ink);
  font-size: 23px;
}

.auth-panel__heading p {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.auth-panel__number {
  color: #e7ebf0;
  font-size: 28px;
  font-weight: 800;
}

.remember-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #5e6f82;
  font-size: 12px;
  cursor: pointer;
}

.remember-row input {
  position: absolute;
  opacity: 0;
}

.remember-row__check {
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border: 1px solid #d8e0e8;
  border-radius: 6px;
  color: transparent;
  background: #f7f9fb;
  font-size: 11px;
}

.remember-row input:checked + .remember-row__check {
  border-color: var(--brand);
  color: white;
  background: var(--brand);
}

.remember-row small {
  margin-left: auto;
  color: #a3afbc;
}

.button svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.auth-panel__footer {
  margin: 22px 0 0;
  color: #8795a6;
  text-align: center;
  font-size: 13px;
}

.auth-panel__footer a {
  color: var(--brand);
  font-weight: 800;
}
</style>
