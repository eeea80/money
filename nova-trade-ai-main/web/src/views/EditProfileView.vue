<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import InlineNotice from '../components/InlineNotice.vue'
import PageHeader from '../components/PageHeader.vue'
import { cacheUser } from '../services/session'
import { userApi } from '../services/userApi'

const router = useRouter()
const form = reactive({
  username: '',
  nickname: '',
  email: '',
  phone: '',
  avatarUrl: '',
})
const loading = ref(true)
const saving = ref(false)
const error = ref('')

async function loadProfile() {
  try {
    const user = await userApi.getProfile()
    form.username = user.username || ''
    form.nickname = user.nickname || ''
    form.email = user.email || ''
    form.phone = user.phone || ''
    form.avatarUrl = user.avatarUrl || ''
  } catch (exception) {
    error.value = exception.message
  } finally {
    loading.value = false
  }
}

async function submit() {
  error.value = ''
  saving.value = true
  try {
    const user = await userApi.updateProfile({
      nickname: form.nickname,
      email: form.email || null,
      phone: form.phone || null,
      avatarUrl: form.avatarUrl || null,
    })
    cacheUser(user)
    await router.replace('/profile')
  } catch (exception) {
    error.value = exception.message
  } finally {
    saving.value = false
  }
}

onMounted(loadProfile)
</script>

<template>
  <main class="screen edit-screen">
    <PageHeader title="编辑个人资料" subtitle="保持资料准确，构建属于你的 Nova 身份。" />
    <section class="content-card edit-card">
      <InlineNotice :message="error" />

      <div v-if="loading" class="edit-loading">
        <div v-for="item in 5" :key="item">
          <span class="skeleton"></span>
          <span class="skeleton"></span>
        </div>
      </div>

      <form v-else class="form-grid" @submit.prevent="submit">
        <label class="field">
          <span class="field__label">用户名</span>
          <span class="field__control">
            <input :value="form.username" disabled />
          </span>
        </label>

        <label class="field">
          <span class="field__label">昵称 *</span>
          <span class="field__control">
            <input v-model.trim="form.nickname" maxlength="50" placeholder="请输入昵称" required />
          </span>
        </label>

        <label class="field">
          <span class="field__label">邮箱<span class="field__optional">选填</span></span>
          <span class="field__control">
            <input v-model.trim="form.email" type="email" autocomplete="email" maxlength="254" placeholder="name@example.com" />
          </span>
        </label>

        <label class="field">
          <span class="field__label">手机号<span class="field__optional">选填</span></span>
          <span class="field__control">
            <input v-model.trim="form.phone" type="tel" autocomplete="tel" pattern="\+?[0-9]{6,20}" maxlength="20" placeholder="请输入手机号" />
          </span>
        </label>

        <label class="field">
          <span class="field__label">头像地址<span class="field__optional">选填</span></span>
          <span class="field__control">
            <input v-model.trim="form.avatarUrl" type="url" maxlength="500" placeholder="https://example.com/avatar.png" />
          </span>
        </label>

        <div class="form-actions">
          <button class="button button--primary button--block" type="submit" :disabled="saving">
            <span v-if="saving" class="button__spinner"></span>
            {{ saving ? '正在保存...' : '保存资料' }}
          </button>
          <button class="button button--secondary button--block" type="button" @click="router.back()">取消</button>
        </div>
      </form>
    </section>
  </main>
</template>

<style scoped>
.edit-screen {
  padding-bottom: 24px;
}

.edit-card {
  border-radius: 24px;
}

.edit-loading {
  display: grid;
  gap: 20px;
}

.edit-loading div {
  display: grid;
  gap: 9px;
}

.edit-loading span:first-child {
  width: 76px;
  height: 13px;
}

.edit-loading span:last-child {
  width: 100%;
  height: 50px;
  border-radius: 14px;
}
</style>
