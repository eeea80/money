<script setup>
defineProps({
  compact: {
    type: Boolean,
    default: false,
  },
})
</script>

<template>
  <div class="brand" :class="{ 'brand--compact': compact }">
    <span class="brand__mark" aria-hidden="true">
      <span class="brand__core"></span>
    </span>
    <span class="brand__copy">
      <strong>NOVA</strong>
      <small>TRADE AI</small>
    </span>
  </div>
</template>

<style scoped>
.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: white;
}

.brand__mark {
  position: relative;
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.34);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 0 20px rgba(91, 229, 210, 0.12);
  transform: rotate(45deg);
}

.brand__mark::before,
.brand__mark::after {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #5be5d2;
  content: '';
}

.brand__mark::before {
  top: 7px;
  right: 7px;
}

.brand__mark::after {
  bottom: 7px;
  left: 7px;
  opacity: 0.55;
}

.brand__core {
  width: 13px;
  height: 13px;
  border-radius: 4px;
  background: linear-gradient(135deg, #fff, #5be5d2);
  box-shadow: 0 0 18px rgba(91, 229, 210, 0.8);
}

.brand__copy {
  display: grid;
  line-height: 1;
}

.brand__copy strong {
  font-size: 20px;
  letter-spacing: 0.18em;
}

.brand__copy small {
  margin-top: 5px;
  color: #8ba3bd;
  font-size: 9px;
  letter-spacing: 0.32em;
}

.brand--compact {
  gap: 9px;
}

.brand--compact .brand__mark {
  width: 34px;
  height: 34px;
  border-radius: 11px;
}

.brand--compact .brand__copy strong {
  font-size: 16px;
}
</style>
