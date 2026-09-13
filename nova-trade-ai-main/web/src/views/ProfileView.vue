<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import InlineNotice from '../components/InlineNotice.vue'
import NovaLogo from '../components/NovaLogo.vue'
import { avatarText, formatDateTime } from '../utils/format'
import { cacheUser, clearSession, getCachedUser } from '../services/session'
import { userApi } from '../services/userApi'

const router = useRouter()
const user = ref(getCachedUser())
const loading = ref(!user.value)
const loggingOut = ref(false)
const error = ref('')
const imageFailed = ref(false)
const displayAvatar = computed(() => user.value?.avatarUrl && !imageFailed.value)

async function loadProfile() {
  error.value = ''
  try {
    user.value = await userApi.getProfile()
    cacheUser(user.value)
  } catch (exception) {
    error.value = exception.message
  } finally {
    loading.value = false
  }
}

async function logout() {
  loggingOut.value = true
  try {
    await userApi.logout()
  } catch {
    // 即使服务端暂时不可用，也清理本地登录状态。
  } finally {
    clearSession()
    await router.replace('/login')
  }
}

onMounted(loadProfile)
</script>

<template>
  <main class="screen profile-screen">
    <section class="profile-hero">
      <div class="profile-hero__top">
        <NovaLogo compact />
        <button class="profile-hero__home" type="button" aria-label="返回首页" @click="router.push('/home')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7v9h-6v-6h-4v6H4v-9z" /></svg>
        </button>
      </div>

      <div v-if="loading && !user" class="profile-identity profile-identity--loading">
        <span class="skeleton profile-identity__avatar"></span>
        <div>
          <div class="skeleton profile-identity__name"></div>
          <div class="skeleton profile-identity__username-skeleton"></div>
        </div>
      </div>
      <div v-else class="profile-identity">
        <div class="profile-avatar">
          <img v-if="displayAvatar" :src="user.avatarUrl" alt="用户头像" @error="imageFailed = true" />
          <span v-else>{{ avatarText(user) }}</span>
          <i aria-hidden="true"></i>
        </div>
        <div>
          <p class="eyebrow">NOVA MEMBER</p>
          <h1>{{ user?.nickname || 'Nova 用户' }}</h1>
          <p class="profile-identity__username">@{{ user?.username }}</p>
        </div>
      </div>
    </section>

    <section class="profile-content">
      <InlineNotice :message="error" />

      <div class="profile-summary">
        <div>
          <span>账号 ID</span>
          <strong>#{{ user?.id || '—' }}</strong>
        </div>
        <div class="profile-summary__divider"></div>
        <div>
          <span>登录状态</span>
          <strong class="profile-summary__active">已验证</strong>
        </div>
        <div class="profile-summary__divider"></div>
        <div>
          <span>加入时间</span>
          <strong>{{ user?.createdAt?.slice(0, 10) || '—' }}</strong>
        </div>
      </div>

      <div class="section-title">
        <div>
          <p class="eyebrow">PERSONAL DATA</p>
          <h2>个人资料</h2>
        </div>
        <button class="text-button" type="button" @click="router.push('/profile/edit')">编辑资料</button>
      </div>

      <div class="info-card">
        <div class="info-row">
          <span class="info-row__icon">
            <svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM4 7l8 6 8-6" /></svg>
          </span>
          <div><small>邮箱</small><strong>{{ user?.email || '未设置' }}</strong></div>
        </div>
        <div class="info-row">
          <span class="info-row__icon">
            <svg viewBox="0 0 24 24"><path d="M7 3h10v18H7zM11 18h2" /></svg>
          </span>
          <div><small>手机号</small><strong>{{ user?.phone || '未设置' }}</strong></div>
        </div>
        <div class="info-row">
          <span class="info-row__icon">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          </span>
          <div><small>最近登录</small><strong>{{ formatDateTime(user?.lastLoginAt) }}</strong></div>
        </div>
      </div>

      <div class="section-title section-title--security">
        <div>
          <p class="eyebrow">SECURITY</p>
          <h2>账号安全</h2>
        </div>
      </div>

      <button class="action-row" type="button" @click="router.push('/profile/password')">
        <span class="action-row__icon action-row__icon--blue">
          <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 018 0v3M12 14v3" /></svg>
        </span>
        <span><strong>修改登录密码</strong><small>定期更新密码以保护账号安全</small></span>
        <svg class="action-row__arrow" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
      </button>

      <button class="button button--danger button--block logout-button" type="button" :disabled="loggingOut" @click="logout">
        {{ loggingOut ? '正在退出...' : '退出当前账号' }}
      </button>
    </section>
  </main>
</template>

<style scoped>
.profile-screen {
  padding-bottom: calc(28px + env(safe-area-inset-bottom));
}

.profile-hero {
  position: relative;
  overflow: hidden;
  min-height: 310px;
  padding: calc(18px + env(safe-area-inset-top)) 22px 74px;
  color: white;
  background:
    radial-gradient(circle at 84% 18%, rgba(36, 107, 253, 0.5), transparent 35%),
    linear-gradient(145deg, #061321, #0b2a41);
}

.profile-hero::after {
  position: absolute;
  right: -65px;
  bottom: -78px;
  width: 210px;
  height: 210px;
  border: 1px solid rgba(91, 229, 210, 0.13);
  border-radius: 50%;
  box-shadow: 0 0 0 35px rgba(91, 229, 210, 0.025), 0 0 0 70px rgba(91, 229, 210, 0.015);
  content: '';
}

.profile-hero__top {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.profile-hero__home {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 13px;
  color: white;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
}

.profile-hero__home svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.profile-identity {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 56px;
}

.profile-avatar,
.profile-identity__avatar {
  position: relative;
  display: grid;
  flex: 0 0 auto;
  width: 76px;
  height: 76px;
  place-items: center;
  overflow: visible;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-radius: 25px;
  color: white;
  background: linear-gradient(145deg, #2c78ff, #1cbba7);
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.22);
  font-size: 29px;
  font-weight: 900;
}

.profile-avatar img {
  width: 100%;
  height: 100%;
  border-radius: 23px;
  object-fit: cover;
}

.profile-avatar i {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 16px;
  height: 16px;
  border: 3px solid #0a263b;
  border-radius: 50%;
  background: #5be5d2;
}

.profile-identity h1 {
  margin: 7px 0 5px;
  font-size: 26px;
  letter-spacing: -0.02em;
}

.profile-identity__username {
  margin: 0;
  color: #8fa5b9;
  font-size: 13px;
}

.profile-identity--loading .profile-identity__avatar {
  border: 0;
  background-color: rgba(255, 255, 255, 0.12);
}

.profile-identity__name {
  width: 130px;
  height: 24px;
  background-color: rgba(255, 255, 255, 0.12);
}

.profile-identity__username-skeleton {
  width: 80px;
  height: 14px;
  margin-top: 10px;
}

.profile-content {
  position: relative;
  z-index: 2;
  margin: -38px 14px 0;
  padding: 0 5px;
}

.profile-summary {
  display: grid;
  grid-template-columns: 1fr 1px 1fr 1px 1fr;
  align-items: center;
  padding: 19px 12px;
  border: 1px solid #e4e9ef;
  border-radius: 20px;
  background: white;
  box-shadow: var(--shadow);
}

.profile-summary > div:not(.profile-summary__divider) {
  display: grid;
  gap: 6px;
  text-align: center;
}

.profile-summary span {
  color: #98a5b3;
  font-size: 9px;
}

.profile-summary strong {
  color: #25394f;
  font-size: 11px;
}

.profile-summary .profile-summary__active {
  color: #159479;
}

.profile-summary__divider {
  width: 1px;
  height: 28px;
  background: #edf0f3;
}

.section-title {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin: 32px 4px 15px;
}

.section-title .eyebrow {
  color: #2aa996;
  font-size: 8px;
}

.section-title h2 {
  margin: 5px 0 0;
  font-size: 18px;
}

.text-button {
  padding: 8px 0;
  color: var(--brand);
  background: transparent;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.info-card {
  overflow: hidden;
  border: 1px solid #e5eaf0;
  border-radius: 19px;
  background: white;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 13px;
  min-height: 70px;
  padding: 12px 16px;
}

.info-row + .info-row {
  border-top: 1px solid #edf1f4;
}

.info-row__icon,
.action-row__icon {
  display: grid;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 12px;
  color: #24725f;
  background: #eaf9f5;
}

.info-row svg,
.action-row svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.info-row div,
.action-row > span:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.info-row small,
.action-row small {
  color: #98a5b3;
  font-size: 10px;
}

.info-row strong,
.action-row strong {
  overflow: hidden;
  color: #2b3d52;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-title--security {
  margin-top: 29px;
}

.action-row {
  display: grid;
  width: 100%;
  grid-template-columns: 42px 1fr 20px;
  align-items: center;
  gap: 11px;
  padding: 15px;
  border: 1px solid #e5eaf0;
  border-radius: 17px;
  text-align: left;
  background: white;
  cursor: pointer;
}

.action-row__icon--blue {
  color: #2769e7;
  background: #edf3ff;
}

.action-row__arrow {
  color: #9dabb9;
}

.logout-button {
  margin-top: 26px;
}
</style>
