<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import InlineNotice from '../components/InlineNotice.vue'
import PageHeader from '../components/PageHeader.vue'
import { clearSession } from '../services/session'
import { userApi } from '../services/userApi'

const router = useRouter()
const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})
const saving = ref(false)
const error = ref('')
const showPassword = ref(false)

async function submit() {
  error.value = ''
  if (form.newPassword !== form.confirmPassword) {
    error.value = '两次输入的新密码不一致'
    return
  }
  if (form.oldPassword === form.newPassword) {
    error.value = '新密码不能与原密码相同'
    return
  }

  saving.value = true
  try {
    await userApi.changePassword({
      oldPassword: form.oldPassword,
      newPassword: form.newPassword,
    })
    clearSession()
    await router.replace({ name: 'login', query: { changed: '1' } })
  } catch (exception) {
    error.value = exception.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="screen password-screen">
    <PageHeader title="修改登录密码" subtitle="修改后所有设备将退出登录，请妥善保管新密码。" />
    <section class="content-card password-card">
      <div class="security-tip">
        <span>
          <svg viewBox="0 0 24 24"><path d="M12 3l8 3v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3zM9 12l2 2 4-5" /></svg>
        </span>
        <div><strong>安全建议</strong><p>建议使用字母、数字和符号的组合，且不要与其他网站共用。</p></div>
      </div>

      <InlineNotice :message="error" />

      <form class="form-grid" @submit.prevent="submit">
        <label class="field">
          <span class="field__label">原密码</span>
          <span class="field__control">
            <input v-model="form.oldPassword" type="password" autocomplete="current-password" maxlength="72" placeholder="请输入当前密码" required />
          </span>
        </label>

        <label class="field">
          <span class="field__label">新密码</span>
          <span class="field__control field__control--action">
            <input
              v-model="form.newPassword"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              minlength="8"
              maxlength="72"
              placeholder="8-72 个字符"
              required
            />
            <button class="field__action" type="button" @click="showPassword = !showPassword">
              {{ showPassword ? '隐藏' : '显示' }}
            </button>
          </span>
        </label>

        <label class="field">
          <span class="field__label">确认新密码</span>
          <span class="field__control">
            <input v-model="form.confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="72" placeholder="再次输入新密码" required />
          </span>
        </label>

        <div class="form-actions">
          <button class="button button--primary button--block" type="submit" :disabled="saving">
            <span v-if="saving" class="button__spinner"></span>
            {{ saving ? '正在更新...' : '确认修改' }}
          </button>
          <button class="button button--secondary button--block" type="button" @click="router.back()">暂不修改</button>
        </div>
      </form>
    </section>
  </main>
</template>

<style scoped>
.password-screen {
  padding-bottom: 24px;
}

.password-card {
  border-radius: 24px;
}

.security-tip {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 22px;
  padding: 14px;
  border: 1px solid #d9e6ff;
  border-radius: 15px;
  background: #f3f7ff;
}

.security-tip > span {
  display: grid;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 11px;
  color: #2365e6;
  background: white;
}

.security-tip svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.security-tip strong {
  color: #29446b;
  font-size: 13px;
}

.security-tip p {
  margin: 4px 0 0;
  color: #7083a0;
  font-size: 11px;
  line-height: 1.55;
}
</style>
