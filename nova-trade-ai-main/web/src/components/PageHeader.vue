<script setup>
import { useRouter } from 'vue-router'
import NovaLogo from './NovaLogo.vue'

defineProps({
  eyebrow: {
    type: String,
    default: 'ACCOUNT CENTER',
  },
  title: {
    type: String,
    required: true,
  },
  subtitle: {
    type: String,
    default: '',
  },
})

const router = useRouter()
</script>

<template>
  <header class="page-header">
    <div class="page-header__bar">
      <button class="icon-button icon-button--light" type="button" aria-label="返回" @click="router.back()">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <NovaLogo compact />
      <span class="page-header__spacer"></span>
    </div>
    <div class="page-header__copy">
      <p class="eyebrow">{{ eyebrow }}</p>
      <h1>{{ title }}</h1>
      <p v-if="subtitle">{{ subtitle }}</p>
    </div>
  </header>
</template>

<style scoped>
.page-header {
  position: relative;
  overflow: hidden;
  padding: calc(14px + env(safe-area-inset-top)) 20px 72px;
  color: white;
  background:
    radial-gradient(circle at 85% 20%, rgba(50, 117, 255, 0.38), transparent 36%),
    linear-gradient(145deg, #071423, #0d2941);
}

.page-header::after {
  position: absolute;
  right: -54px;
  bottom: -82px;
  width: 190px;
  height: 190px;
  border: 1px solid rgba(91, 229, 210, 0.18);
  border-radius: 50%;
  box-shadow: 0 0 0 26px rgba(91, 229, 210, 0.04), 0 0 0 52px rgba(91, 229, 210, 0.025);
  content: '';
}

.page-header__bar {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 40px 1fr 40px;
  align-items: center;
}

.page-header__bar :deep(.brand) {
  justify-self: center;
}

.page-header__copy {
  position: relative;
  z-index: 1;
  margin-top: 38px;
}

.page-header__copy h1 {
  margin: 8px 0 10px;
  font-size: 28px;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.page-header__copy > p:last-child {
  margin: 0;
  color: #a9bdd0;
  font-size: 14px;
  line-height: 1.6;
}

.page-header__spacer {
  width: 40px;
}
</style>
