<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AiChatWidget from '../components/AiChatWidget.vue'
import NovaLogo from '../components/NovaLogo.vue'
import { cacheUser, getCachedUser } from '../services/session'
import { userApi } from '../services/userApi'
import { avatarText } from '../utils/format'

const router = useRouter()
const user = ref(getCachedUser())
const imageFailed = ref(false)
const aiWidget = ref(null)
const displayAvatar = computed(() => user.value?.avatarUrl && !imageFailed.value)

async function loadUser() {
  try {
    user.value = await userApi.getProfile()
    cacheUser(user.value)
  } catch {
    // 首页仍可使用缓存头像，不让资料刷新失败阻断核心功能。
  }
}

function openAiChat() {
  aiWidget.value?.show()
}

onMounted(loadUser)
</script>

<template>
  <main class="screen home-screen">
    <header class="home-hero">
      <div class="home-topbar">
        <NovaLogo compact />
        <button class="user-entry" type="button" aria-label="查看个人信息" @click="router.push('/profile')">
          <span class="user-entry__avatar">
            <img v-if="displayAvatar" :src="user.avatarUrl" alt="" @error="imageFailed = true" />
            <span v-else>{{ avatarText(user) }}</span>
          </span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>

      <div class="home-hero__copy">
        <p class="eyebrow">NOVA AI WORKSPACE</p>
        <h1>智能投研，从这里开始</h1>
        <p>用真实市场数据分析股票，也可以随时向 Nova AI 提问。</p>
      </div>
    </header>

    <section class="home-tools" aria-label="智能工具">
      <button class="tool-card tool-card--stock" type="button" @click="router.push('/stock-analysis')">
        <span class="tool-card__decoration" aria-hidden="true"></span>
        <span class="tool-card__icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 19V9M10 19V5M16 19v-7M3 19h18M17 7l2-3 2 3" />
          </svg>
        </span>
        <span class="tool-card__copy">
          <small>CANSLIM · REAL DATA</small>
          <strong>智能股票分析</strong>
          <span>输入股票名称，查看七维评分、行情指标与 AI 研究建议。</span>
        </span>
        <span class="tool-card__action">
          开始分析
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5" /></svg>
        </span>
      </button>

      <button class="tool-card tool-card--chat" type="button" @click="openAiChat">
        <span class="tool-card__decoration" aria-hidden="true"></span>
        <span class="tool-card__icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3.5" y="5.5" width="17" height="14" rx="5" />
            <path d="M12 2.5v3M8 11h.01M16 11h.01M8 15h8M7 19.5l-2 2v-3" />
          </svg>
        </span>
        <span class="tool-card__copy">
          <small>DEEPSEEK · ONLINE</small>
          <strong>AI 聊天机器人</strong>
          <span>咨询交易研究或平台使用问题，并随时查看最近聊天。</span>
        </span>
        <span class="tool-card__action">
          开始对话
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5" /></svg>
        </span>
      </button>
    </section>

    <AiChatWidget ref="aiWidget" />
  </main>
</template>

<style scoped>
.home-screen {
  padding-bottom: calc(92px + env(safe-area-inset-bottom));
}

.home-hero {
  position: relative;
  min-height: 320px;
  overflow: hidden;
  padding: calc(17px + env(safe-area-inset-top)) 21px 76px;
  color: white;
  background:
    radial-gradient(circle at 88% 9%, rgba(45, 121, 245, 0.52), transparent 34%),
    radial-gradient(circle at 9% 92%, rgba(38, 200, 178, 0.2), transparent 34%),
    linear-gradient(145deg, #061321, #0b2b43);
}

.home-hero::after {
  position: absolute;
  right: -74px;
  bottom: -90px;
  width: 230px;
  height: 230px;
  border: 1px solid rgba(91, 229, 210, 0.15);
  border-radius: 50%;
  box-shadow: 0 0 0 38px rgba(91, 229, 210, 0.03), 0 0 0 76px rgba(91, 229, 210, 0.018);
  content: '';
}

.home-topbar {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.user-entry {
  display: flex;
  min-width: 57px;
  height: 43px;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  padding: 4px 7px 4px 4px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 15px;
  color: #a8bed0;
  background: rgba(255, 255, 255, 0.07);
  cursor: pointer;
}

.user-entry:active { transform: scale(0.97); }

.user-entry__avatar {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border-radius: 11px;
  color: white;
  background: linear-gradient(145deg, #2d79f5, #22aa96);
  font-size: 13px;
  font-weight: 900;
}

.user-entry__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-entry > svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.home-hero__copy {
  position: relative;
  z-index: 1;
  margin-top: 58px;
}

.home-hero__copy h1 {
  max-width: 330px;
  margin: 11px 0 12px;
  font-size: 31px;
  line-height: 1.18;
  letter-spacing: -0.035em;
}

.home-hero__copy > p:last-child {
  max-width: 330px;
  margin: 0;
  color: #a6bbcd;
  font-size: 13px;
  line-height: 1.7;
}

.home-tools {
  position: relative;
  z-index: 2;
  display: grid;
  gap: 15px;
  margin: -42px 14px 0;
}

.tool-card {
  position: relative;
  display: grid;
  width: 100%;
  min-height: 230px;
  align-content: start;
  overflow: hidden;
  padding: 21px 19px 18px;
  border-radius: 24px;
  color: white;
  text-align: left;
  box-shadow: 0 16px 36px rgba(17, 46, 78, 0.17);
  cursor: pointer;
}

.tool-card:active { transform: scale(0.99); }

.tool-card--stock {
  background: linear-gradient(145deg, #246bfd, #1748aa);
}

.tool-card--chat {
  background: linear-gradient(145deg, #0d7e76, #07504e);
}

.tool-card__decoration {
  position: absolute;
  top: -55px;
  right: -42px;
  width: 170px;
  height: 170px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 0 0 30px rgba(255, 255, 255, 0.025);
}

.tool-card__icon {
  position: relative;
  display: grid;
  width: 49px;
  height: 49px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.19);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.12);
}

.tool-card__icon svg,
.tool-card__action svg {
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.tool-card__copy {
  position: relative;
  display: grid;
  gap: 7px;
  margin-top: 19px;
}

.tool-card__copy small {
  color: rgba(207, 255, 246, 0.8);
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.14em;
}

.tool-card__copy strong {
  font-size: 22px;
  letter-spacing: -0.02em;
}

.tool-card__copy > span {
  max-width: 330px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  line-height: 1.65;
}

.tool-card__action {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 17px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.13);
  color: rgba(255, 255, 255, 0.9);
  font-size: 11px;
  font-weight: 800;
}

.tool-card__action svg {
  width: 19px;
  height: 19px;
}

@media (max-width: 359px) {
  .home-tools { margin-right: 10px; margin-left: 10px; }
  .home-hero__copy h1 { font-size: 28px; }
}
</style>
