<script setup>
import { computed, nextTick, ref } from 'vue'
import InlineNotice from '../components/InlineNotice.vue'
import PageHeader from '../components/PageHeader.vue'
import { stockAnalysisApi } from '../services/stockAnalysisApi'

const stockName = ref('')
const loading = ref(false)
const error = ref('')
const analysis = ref(null)
const resultSection = ref(null)
const samples = ['贵州茅台', '同花顺', '宁德时代']

const normalizedScore = computed(() => Math.max(0, Math.min(100, Number(analysis.value?.normalizedScore || 0))))
const scoreTone = computed(() => {
  if (normalizedScore.value >= 75) return 'strong'
  if (normalizedScore.value >= 60) return 'watch'
  return 'weak'
})

async function submit() {
  const query = stockName.value.trim()
  if (!query) {
    error.value = '请输入股票名称或代码'
    return
  }

  loading.value = true
  error.value = ''
  analysis.value = null
  try {
    analysis.value = await stockAnalysisApi.analyze(query)
    await nextTick()
    resultSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (exception) {
    error.value = exception.message || '分析失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function analyzeSample(name) {
  stockName.value = name
  submit()
}

function number(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '—'
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(Number(value))
}

function amount(value) {
  if (value === null || value === undefined || value === '') return '—'
  const numeric = Number(value)
  if (Math.abs(numeric) >= 100000000) return `${number(numeric / 100000000, 2)} 亿`
  if (Math.abs(numeric) >= 10000) return `${number(numeric / 10000, 2)} 万`
  return number(numeric, 2)
}

function percent(value, signed = false) {
  if (value === null || value === undefined || value === '') return '—'
  const numeric = Number(value)
  const prefix = signed && numeric > 0 ? '+' : ''
  return `${prefix}${number(numeric, 2)}%`
}

function statusLabel(status) {
  return {
    PASS: '通过',
    WATCH: '观察',
    FAIL: '偏弱',
    INSUFFICIENT: '数据不足',
  }[status] || status
}

function formatTime(timestamp) {
  if (!timestamp) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}
</script>

<template>
  <main class="screen analysis-screen">
    <PageHeader
      eyebrow="AI EQUITY RESEARCH"
      title="CANSLIM 智能分析"
      subtitle="用真实行情与财务数据，拆解一只股票的成长、强度和市场环境"
    />

    <section class="analysis-content">
      <form class="search-card" @submit.prevent="submit">
        <div class="search-card__heading">
          <div>
            <p class="eyebrow">START RESEARCH</p>
            <h2>你想分析哪只股票？</h2>
          </div>
          <span class="live-badge"><i></i> REAL DATA</span>
        </div>

        <label class="stock-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M16 16l4 4" /></svg>
          <input
            v-model="stockName"
            maxlength="50"
            autocomplete="off"
            placeholder="股票名称或代码，如 贵州茅台"
            :disabled="loading"
          />
          <button type="submit" :disabled="loading || !stockName.trim()">
            <span v-if="loading" class="mini-spinner"></span>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5" /></svg>
          </button>
        </label>

        <div class="sample-list">
          <span>快速体验</span>
          <button v-for="sample in samples" :key="sample" type="button" :disabled="loading" @click="analyzeSample(sample)">
            {{ sample }}
          </button>
        </div>
      </form>

      <InlineNotice :message="error" />

      <div v-if="loading" class="loading-card" aria-live="polite">
        <div class="loading-orbit"><i></i><span>AI</span></div>
        <div>
          <strong>正在读取真实市场数据</strong>
          <p>解析代码、拉取财报和行情，再生成 CANSLIM 评分与 AI 建议…</p>
        </div>
        <div class="loading-lines"><i></i><i></i><i></i></div>
      </div>

      <div v-if="analysis" ref="resultSection" class="result-stack">
        <section class="result-hero">
          <div class="result-hero__top">
            <div>
              <span class="result-hero__code">{{ analysis.target?.thscode }}</span>
              <h2>{{ analysis.target?.name }}</h2>
              <p>{{ analysis.target?.exchange }} · {{ analysis.target?.currency }}</p>
            </div>
            <div class="score-ring" :class="`score-ring--${scoreTone}`" :style="{ '--score': `${normalizedScore}%` }">
              <div><strong>{{ number(normalizedScore, 0) }}</strong><small>综合分</small></div>
            </div>
          </div>

          <div class="quote-row">
            <div>
              <span>最新价</span>
              <strong>{{ number(analysis.market?.lastPrice, 2) }}</strong>
            </div>
            <div :class="Number(analysis.market?.priceChangeRatioPct || 0) >= 0 ? 'up' : 'down'">
              <span>当日涨跌</span>
              <strong>{{ percent(analysis.market?.priceChangeRatioPct, true) }}</strong>
            </div>
            <div>
              <span>数据覆盖</span>
              <strong>{{ analysis.coveredMaxScore }}/100</strong>
            </div>
          </div>

          <div class="verdict-card">
            <span>规则化结论</span>
            <strong>{{ analysis.verdict }}</strong>
            <p>{{ analysis.summary }}</p>
          </div>
          <p class="data-time">分析生成于 {{ formatTime(analysis.generatedAtMs) }}</p>
        </section>

        <section class="ai-advice-card">
          <div class="section-heading section-heading--light">
            <span class="section-heading__icon">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.3 4.2L17.5 9l-4.2 1.3L12 14.5l-1.3-4.2L6.5 9l4.2-1.8L12 3zM18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" /></svg>
            </span>
            <div><small>DEEPSEEK INSIGHT</small><h3>AI 研究建议</h3></div>
          </div>
          <p class="ai-advice-card__content">{{ analysis.aiAdvice || 'AI 建议暂不可用' }}</p>
          <div class="ai-advice-card__foot"><i></i> AI 仅依据本页真实数据生成，未使用未验证外部事实</div>
        </section>

        <section class="panel">
          <div class="section-heading">
            <span class="section-heading__icon section-heading__icon--blue">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17l5-5 4 3 7-8M17 7h3v3" /></svg>
            </span>
            <div><small>7-FACTOR SCORE</small><h3>CANSLIM 七维拆解</h3></div>
          </div>

          <div class="dimension-list">
            <article v-for="dimension in analysis.dimensions" :key="dimension.code" class="dimension-card">
              <div class="dimension-card__score" :class="`is-${dimension.status.toLowerCase()}`">
                <strong>{{ dimension.code }}</strong>
                <span>{{ dimension.score }}/{{ dimension.maxScore }}</span>
              </div>
              <div class="dimension-card__body">
                <div><strong>{{ dimension.name }}</strong><span :class="`status-${dimension.status.toLowerCase()}`">{{ statusLabel(dimension.status) }}</span></div>
                <p>{{ dimension.summary }}</p>
              </div>
            </article>
          </div>
        </section>

        <section class="panel">
          <div class="section-heading">
            <span class="section-heading__icon section-heading__icon--teal">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7" /></svg>
            </span>
            <div><small>MARKET SIGNALS</small><h3>关键行情指标</h3></div>
          </div>

          <div class="metric-grid">
            <div><span>52 周高点</span><strong>{{ number(analysis.technicals?.high52Week) }}</strong></div>
            <div><span>距 52 周高点</span><strong>{{ percent(analysis.technicals?.distanceFromHighPct, true) }}</strong></div>
            <div><span>近 20 日收益</span><strong>{{ percent(analysis.technicals?.stockReturn20DayPct, true) }}</strong></div>
            <div><span>近 120 日收益</span><strong>{{ percent(analysis.technicals?.stockReturn120DayPct, true) }}</strong></div>
            <div><span>相对沪深 300</span><strong>{{ percent(analysis.technicals?.relativeStrengthPctPoints, true) }}</strong></div>
            <div><span>近期量能比</span><strong>{{ number(analysis.technicals?.recentToPriorVolumeRatio) }}×</strong></div>
          </div>
        </section>

        <section class="panel">
          <div class="section-heading">
            <span class="section-heading__icon section-heading__icon--amber">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M6 17V8h12v9M9 8V5h6v3M9 12h2M13 12h2" /></svg>
            </span>
            <div><small>FUNDAMENTALS</small><h3>核心财务数据</h3></div>
          </div>

          <div class="fundamental-summary">
            <div><span>最新报告期</span><strong>{{ analysis.fundamentals?.latestQuarterReport || '—' }}</strong></div>
            <div><span>每股收益</span><strong>{{ number(analysis.fundamentals?.latestQuarterEps, 4) }}</strong></div>
            <div><span>营业收入</span><strong>{{ amount(analysis.fundamentals?.latestQuarterRevenue) }}</strong></div>
            <div><span>归母净利润</span><strong>{{ amount(analysis.fundamentals?.latestQuarterNetProfit) }}</strong></div>
          </div>

          <div v-if="analysis.fundamentals?.annualEarnings?.length" class="annual-table-wrap">
            <table class="annual-table">
              <thead><tr><th>年度</th><th>EPS</th><th>营收</th><th>净利润</th></tr></thead>
              <tbody>
                <tr v-for="item in analysis.fundamentals.annualEarnings" :key="item.fiscalYear">
                  <td>{{ item.fiscalYear }}</td>
                  <td>{{ number(item.eps, 4) }}</td>
                  <td>{{ amount(item.revenue) }}</td>
                  <td>{{ amount(item.netProfit) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="analysis.warnings?.length" class="warning-panel">
          <div class="warning-panel__title">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3L2.8 20h18.4L12 3zM12 9v5M12 17h.01" /></svg>
            <strong>数据与方法边界</strong>
          </div>
          <ul><li v-for="warning in analysis.warnings" :key="warning">{{ warning }}</li></ul>
        </section>

        <p class="disclaimer">{{ analysis.disclaimer }}</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.analysis-screen {
  padding-bottom: calc(34px + env(safe-area-inset-bottom));
}

.analysis-content {
  position: relative;
  z-index: 2;
  margin: -38px 14px 0;
}

.search-card,
.panel,
.result-hero,
.loading-card {
  border: 1px solid #e4e9ef;
  border-radius: 22px;
  background: white;
  box-shadow: 0 12px 34px rgba(18, 44, 69, 0.08);
}

.search-card {
  margin-bottom: 16px;
  padding: 20px 17px 17px;
}

.search-card__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.search-card__heading .eyebrow {
  color: #279c8b;
  font-size: 8px;
}

.search-card__heading h2 {
  margin: 7px 0 16px;
  color: #172b42;
  font-size: 17px;
}

.live-badge {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  padding: 6px 8px;
  border-radius: 99px;
  color: #228371;
  background: #eaf9f5;
  font-size: 7px;
  font-weight: 900;
  letter-spacing: 0.09em;
}

.live-badge i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #2ac8ac;
  box-shadow: 0 0 7px #2ac8ac;
}

.stock-search {
  display: grid;
  grid-template-columns: 22px 1fr 43px;
  align-items: center;
  gap: 8px;
  height: 54px;
  padding: 0 6px 0 14px;
  border: 1px solid #dae3eb;
  border-radius: 16px;
  background: #f7f9fb;
  transition: 0.2s ease;
}

.stock-search:focus-within {
  border-color: #3979ef;
  background: white;
  box-shadow: 0 0 0 4px rgba(36, 107, 253, 0.07);
}

.stock-search > svg,
.stock-search button svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.9;
}

.stock-search > svg { color: #8495a8; }

.stock-search input {
  min-width: 0;
  height: 50px;
  border: 0;
  outline: 0;
  color: #172b42;
  background: transparent;
  font-size: 14px;
}

.stock-search input::placeholder { color: #a2afbc; }

.stock-search button {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 13px;
  color: white;
  background: linear-gradient(135deg, #347bff, #1c59cf);
  box-shadow: 0 7px 14px rgba(36, 107, 253, 0.23);
  cursor: pointer;
}

.stock-search button:disabled { opacity: 0.5; }

.mini-spinner {
  width: 17px;
  height: 17px;
  border: 2px solid rgba(255, 255, 255, 0.42);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.sample-list {
  display: flex;
  align-items: center;
  gap: 7px;
  overflow-x: auto;
  margin-top: 13px;
  scrollbar-width: none;
}

.sample-list::-webkit-scrollbar { display: none; }
.sample-list > span { flex: 0 0 auto; color: #9aa7b5; font-size: 9px; }

.sample-list button {
  flex: 0 0 auto;
  padding: 6px 10px;
  border: 1px solid #e5eaf0;
  border-radius: 99px;
  color: #556a80;
  background: white;
  font-size: 10px;
  cursor: pointer;
}

.loading-card {
  display: grid;
  grid-template-columns: 58px 1fr;
  align-items: center;
  gap: 14px;
  overflow: hidden;
  padding: 20px 17px;
}

.loading-orbit {
  position: relative;
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border: 1px solid #dbe5f4;
  border-radius: 50%;
  color: #246bfd;
  font-size: 11px;
  font-weight: 900;
}

.loading-orbit i {
  position: absolute;
  inset: -3px;
  border: 2px solid transparent;
  border-top-color: #27c9b1;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.loading-card strong { color: #22384f; font-size: 14px; }
.loading-card p { margin: 6px 0 0; color: #8190a0; font-size: 11px; line-height: 1.55; }

.loading-lines {
  display: grid;
  grid-column: 1 / -1;
  gap: 6px;
}

.loading-lines i {
  height: 6px;
  border-radius: 99px;
  background: linear-gradient(90deg, #eaf0f6 25%, #f7fafd 50%, #eaf0f6 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite;
}

.loading-lines i:nth-child(2) { width: 83%; }
.loading-lines i:nth-child(3) { width: 61%; }

.result-stack { display: grid; gap: 14px; scroll-margin-top: 14px; }

.result-hero {
  overflow: hidden;
  padding: 20px 18px 14px;
  color: white;
  border-color: #183751;
  background:
    radial-gradient(circle at 88% 5%, rgba(58, 125, 255, 0.38), transparent 34%),
    linear-gradient(145deg, #071625, #0d2b43);
}

.result-hero__top { display: flex; align-items: center; justify-content: space-between; gap: 15px; }
.result-hero__code { color: #6ee8d5; font-size: 9px; font-weight: 800; letter-spacing: 0.12em; }
.result-hero h2 { margin: 5px 0 4px; font-size: 23px; }
.result-hero__top p { margin: 0; color: #8ea6ba; font-size: 10px; }

.score-ring {
  --ring-color: #6ee8d5;
  display: grid;
  width: 84px;
  height: 84px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: conic-gradient(var(--ring-color) var(--score), rgba(255, 255, 255, 0.1) 0);
}

.score-ring::before {
  position: absolute;
  width: 67px;
  height: 67px;
  border-radius: 50%;
  background: #0d2940;
  content: '';
}

.score-ring > div { position: relative; display: grid; text-align: center; }
.score-ring strong { font-size: 24px; line-height: 1; }
.score-ring small { margin-top: 4px; color: #8fa8bb; font-size: 8px; }
.score-ring--watch { --ring-color: #ffbd5b; }
.score-ring--weak { --ring-color: #ff7e79; }

.quote-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  margin-top: 20px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
}

.quote-row > div { display: grid; gap: 5px; padding: 12px 8px; text-align: center; background: rgba(3, 18, 31, 0.52); }
.quote-row span { color: #829caf; font-size: 8px; }
.quote-row strong { font-size: 13px; }
.up strong { color: #60e0c2; }
.down strong { color: #ff8c88; }

.verdict-card { margin-top: 12px; padding: 13px 14px; border: 1px solid rgba(91, 229, 210, 0.12); border-radius: 14px; background: rgba(91, 229, 210, 0.055); }
.verdict-card span { color: #78a698; font-size: 8px; }
.verdict-card strong { display: block; margin-top: 5px; color: #dffcf7; font-size: 12px; }
.verdict-card p { margin: 6px 0 0; color: #8fa6b9; font-size: 10px; line-height: 1.55; }
.data-time { margin: 11px 2px 0; color: #647e92; font-size: 8px; text-align: right; }

.ai-advice-card {
  position: relative;
  overflow: hidden;
  padding: 19px 17px 16px;
  border: 1px solid rgba(36, 107, 253, 0.18);
  border-radius: 22px;
  color: white;
  background: linear-gradient(145deg, #235fdb, #174195);
  box-shadow: 0 15px 32px rgba(28, 83, 194, 0.2);
}

.ai-advice-card::after { position: absolute; top: -55px; right: -45px; width: 140px; height: 140px; border-radius: 50%; background: rgba(91, 229, 210, 0.09); content: ''; }

.section-heading { display: flex; align-items: center; gap: 11px; margin-bottom: 16px; }
.section-heading__icon { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border-radius: 12px; color: #9cf8e8; background: rgba(255, 255, 255, 0.11); }
.section-heading__icon svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.section-heading small { color: #8d9dad; font-size: 7px; font-weight: 900; letter-spacing: 0.14em; }
.section-heading h3 { margin: 3px 0 0; color: #21364d; font-size: 15px; }
.section-heading--light { position: relative; z-index: 1; }
.section-heading--light small { color: #a7cbff; }
.section-heading--light h3 { color: white; }
.section-heading__icon--blue { color: #2b6fe8; background: #edf3ff; }
.section-heading__icon--teal { color: #169a85; background: #e9f8f5; }
.section-heading__icon--amber { color: #bd7717; background: #fff4df; }

.ai-advice-card__content { position: relative; z-index: 1; margin: 0; color: #e4edff; font-size: 12px; line-height: 1.85; white-space: pre-wrap; }
.ai-advice-card__foot { position: relative; z-index: 1; display: flex; align-items: flex-start; gap: 6px; margin-top: 14px; padding-top: 11px; border-top: 1px solid rgba(255, 255, 255, 0.12); color: #9fbced; font-size: 8px; line-height: 1.5; }
.ai-advice-card__foot i { width: 5px; height: 5px; flex: 0 0 auto; margin-top: 4px; border-radius: 50%; background: #6ee8d5; }

.panel { padding: 19px 16px; }
.dimension-list { display: grid; gap: 9px; }
.dimension-card { display: grid; grid-template-columns: 49px 1fr; gap: 11px; align-items: center; padding: 11px; border: 1px solid #e8edf2; border-radius: 15px; background: #fbfcfd; }
.dimension-card__score { display: grid; width: 48px; height: 48px; place-items: center; border-radius: 13px; color: #177e6b; background: #e7f8f4; }
.dimension-card__score strong { font-size: 17px; line-height: 1; }
.dimension-card__score span { font-size: 7px; }
.dimension-card__score.is-watch { color: #9b691c; background: #fff3dd; }
.dimension-card__score.is-fail { color: #b34a46; background: #fff0ef; }
.dimension-card__score.is-insufficient { color: #7f8b98; background: #edf1f4; }
.dimension-card__body > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dimension-card__body strong { color: #2b3e54; font-size: 12px; }
.dimension-card__body span { padding: 3px 6px; border-radius: 99px; font-size: 7px; font-weight: 800; }
.status-pass { color: #177e6b; background: #e8f8f4; }
.status-watch { color: #966416; background: #fff3dd; }
.status-fail { color: #ad4641; background: #fff0ef; }
.status-insufficient { color: #73808d; background: #edf1f4; }
.dimension-card__body p { margin: 5px 0 0; color: #8190a0; font-size: 9px; line-height: 1.5; }

.metric-grid,
.fundamental-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 9px; }
.metric-grid > div,
.fundamental-summary > div { display: grid; min-height: 62px; align-content: center; gap: 6px; padding: 11px 12px; border: 1px solid #e9edf2; border-radius: 13px; background: #fafbfd; }
.metric-grid span,
.fundamental-summary span { color: #8a98a7; font-size: 8px; }
.metric-grid strong,
.fundamental-summary strong { color: #263a50; font-size: 13px; }

.annual-table-wrap { overflow-x: auto; margin-top: 13px; border: 1px solid #e9edf2; border-radius: 13px; }
.annual-table { width: 100%; min-width: 390px; border-collapse: collapse; font-size: 9px; }
.annual-table th { padding: 9px 10px; color: #8896a5; text-align: right; background: #f5f7f9; font-weight: 700; }
.annual-table th:first-child,
.annual-table td:first-child { text-align: left; }
.annual-table td { padding: 10px; border-top: 1px solid #edf1f4; color: #465a70; text-align: right; }

.warning-panel { padding: 16px; border: 1px solid #f0dfbd; border-radius: 18px; background: #fffaf0; }
.warning-panel__title { display: flex; align-items: center; gap: 8px; color: #94621b; }
.warning-panel__title svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.warning-panel__title strong { font-size: 12px; }
.warning-panel ul { display: grid; gap: 7px; margin: 11px 0 0; padding-left: 18px; color: #8c7654; font-size: 9px; line-height: 1.6; }
.disclaimer { margin: 2px 8px 0; color: #9aa6b2; font-size: 8px; line-height: 1.6; text-align: center; }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes shimmer { to { background-position: -200% 0; } }

@media (max-width: 359px) {
  .analysis-content { margin-right: 10px; margin-left: 10px; }
  .result-hero { padding-right: 14px; padding-left: 14px; }
  .score-ring { width: 76px; height: 76px; }
  .score-ring::before { width: 60px; height: 60px; }
  .sample-list > span { display: none; }
}
</style>
