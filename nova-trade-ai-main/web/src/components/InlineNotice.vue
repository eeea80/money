<script setup>
defineProps({
  type: {
    type: String,
    default: 'error',
  },
  message: {
    type: String,
    default: '',
  },
})
</script>

<template>
  <Transition name="notice">
    <div v-if="message" class="notice" :class="`notice--${type}`" role="alert">
      <span class="notice__dot"></span>
      <span>{{ message }}</span>
    </div>
  </Transition>
</template>

<style scoped>
.notice {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-bottom: 18px;
  padding: 12px 14px;
  border: 1px solid #ffd9d7;
  border-radius: 13px;
  color: #b83b36;
  background: #fff4f3;
  font-size: 13px;
  line-height: 1.5;
}

.notice--success {
  border-color: #c8eee5;
  color: #177660;
  background: #effbf7;
}

.notice__dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin-top: 6px;
  border-radius: 50%;
  background: currentColor;
}

.notice-enter-active,
.notice-leave-active {
  transition: 0.2s ease;
}

.notice-enter-from,
.notice-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}
</style>
