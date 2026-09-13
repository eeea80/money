<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { aiApi } from '../services/aiApi'

const greeting = () => ({
  id: 'greeting',
  role: 'assistant',
  content: '你好，我是 Nova AI。有什么交易或平台问题，可以直接问我。',
})

const open = ref(false)
const draft = ref('')
const streaming = ref(false)
const initialized = ref(false)
const loadingConversations = ref(false)
const loadingMessages = ref(false)
const creatingConversation = ref(false)
const showRecent = ref(false)
const error = ref('')
const messageList = ref(null)
const messages = ref([greeting()])
const conversations = ref([])
const activeConversation = ref(null)

let nextId = 1
let abortController = null

function localId() {
  return `local-${nextId++}`
}

function formatMessageTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

async function scrollToBottom() {
  await nextTick()
  if (messageList.value) {
    messageList.value.scrollTop = messageList.value.scrollHeight
  }
}

async function toggle() {
  open.value = !open.value
  if (open.value) {
    if (!initialized.value) await loadConversations()
    await scrollToBottom()
  }
}

async function show() {
  if (!open.value) await toggle()
}

defineExpose({ show })

async function loadConversations() {
  loadingConversations.value = true
  error.value = ''
  try {
    conversations.value = await aiApi.getConversations()
    initialized.value = true
    if (!activeConversation.value && conversations.value.length) {
      await selectConversation(conversations.value[0])
    }
  } catch (exception) {
    error.value = exception?.message || '最近聊天加载失败'
  } finally {
    loadingConversations.value = false
  }
}

async function refreshConversations() {
  try {
    conversations.value = await aiApi.getConversations()
    if (activeConversation.value) {
      activeConversation.value = conversations.value.find(
        (conversation) => conversation.id === activeConversation.value.id,
      ) || activeConversation.value
    }
  } catch {
    // 对话已正常完成时，不让列表刷新失败覆盖回答内容。
  }
}

async function selectConversation(conversation) {
  if (streaming.value) return
  activeConversation.value = conversation
  showRecent.value = false
  loadingMessages.value = true
  error.value = ''
  try {
    const history = await aiApi.getConversationMessages(conversation.id)
    messages.value = history.length
      ? history.map((message) => ({ ...message, id: `history-${message.id}`, persisted: true }))
      : [greeting()]
  } catch (exception) {
    error.value = exception?.message || '聊天消息加载失败'
  } finally {
    loadingMessages.value = false
    await scrollToBottom()
  }
}

async function createConversation() {
  if (streaming.value || creatingConversation.value) return null
  creatingConversation.value = true
  error.value = ''
  try {
    const conversation = await aiApi.createConversation()
    conversations.value = [conversation, ...conversations.value]
    activeConversation.value = conversation
    messages.value = [greeting()]
    showRecent.value = false
    return conversation
  } catch (exception) {
    error.value = exception?.message || '新建聊天失败'
    return null
  } finally {
    creatingConversation.value = false
    await scrollToBottom()
  }
}

async function removeConversation(conversation) {
  if (streaming.value || !window.confirm(`确定删除“${conversation.title}”吗？`)) return
  error.value = ''
  try {
    await aiApi.deleteConversation(conversation.id)
    conversations.value = conversations.value.filter((item) => item.id !== conversation.id)
    if (activeConversation.value?.id === conversation.id) {
      activeConversation.value = null
      messages.value = [greeting()]
    }
  } catch (exception) {
    error.value = exception?.message || '删除聊天失败'
  }
}

function toggleRecent() {
  if (streaming.value) return
  showRecent.value = !showRecent.value
}

function stop() {
  abortController?.abort()
  abortController = null
}

async function submit() {
  const content = draft.value.trim()
  if (!content || streaming.value) return

  if (!activeConversation.value) {
    const conversation = await createConversation()
    if (!conversation) return
  }

  draft.value = ''
  const createdAt = new Date().toISOString()
  const answer = { id: localId(), role: 'assistant', content: '', pending: true, createdAt }
  messages.value.push({ id: localId(), role: 'user', content, createdAt }, answer)
  streaming.value = true
  abortController = new AbortController()
  await scrollToBottom()

  try {
    await aiApi.streamChat(activeConversation.value.id, content, {
      signal: abortController.signal,
      onChunk(chunk) {
        answer.pending = false
        answer.content += chunk
        scrollToBottom()
      },
    })
    if (!answer.content) answer.content = 'AI 暂时没有返回内容，请稍后再试。'
  } catch (error) {
    answer.pending = false
    if (error?.name === 'AbortError') {
      answer.content ||= '已停止生成。'
    } else {
      answer.error = true
      answer.content ||= error?.message || 'AI 回复失败，请稍后再试。'
    }
  } finally {
    streaming.value = false
    abortController = null
    await refreshConversations()
    await scrollToBottom()
  }
}

function handleKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submit()
  }
}

onBeforeUnmount(stop)
</script>

<template>
  <div class="ai-widget">
    <Transition name="ai-panel">
      <section v-if="open" class="ai-panel" aria-label="Nova AI 对话框">
        <header class="ai-panel__header">
          <span class="ai-avatar ai-avatar--header">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="6" width="16" height="13" rx="5" />
              <path d="M12 3v3M8 12h.01M16 12h.01M8 16h8" />
            </svg>
          </span>
          <div class="ai-panel__identity">
            <strong>{{ showRecent ? '最近聊天' : (activeConversation?.title || 'Nova AI') }}</strong>
            <span v-if="showRecent">{{ conversations.length }} 个会话</span>
            <span v-else><i></i> DeepSeek 在线</span>
          </div>
          <div class="ai-panel__actions">
            <button
              class="ai-icon-button"
              :class="{ 'ai-icon-button--active': showRecent }"
              type="button"
              :disabled="streaming"
              aria-label="最近聊天"
              @click="toggleRecent"
            >
              <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
            </button>
            <button
              class="ai-icon-button"
              type="button"
              :disabled="streaming || creatingConversation"
              aria-label="创建新聊天"
              @click="createConversation"
            >
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button class="ai-icon-button" type="button" aria-label="关闭聊天框" @click="toggle">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </header>

        <section v-if="showRecent" class="ai-recents">
          <button class="ai-new-chat" type="button" :disabled="creatingConversation" @click="createConversation">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            {{ creatingConversation ? '正在创建...' : '创建新聊天' }}
          </button>

          <div v-if="loadingConversations" class="ai-history-state">
            <span class="ai-history-spinner"></span>
            正在加载最近聊天...
          </div>
          <div v-else-if="error" class="ai-history-state ai-history-state--error">
            <span>{{ error }}</span>
            <button type="button" @click="loadConversations">重新加载</button>
          </div>
          <div v-else-if="!conversations.length" class="ai-recents__empty">
            <span>还没有聊天记录</span>
            <small>创建一个新聊天，开始和 Nova AI 对话</small>
          </div>
          <div v-else class="ai-recents__list">
            <article
              v-for="conversation in conversations"
              :key="conversation.id"
              class="ai-recent-item"
              :class="{ 'ai-recent-item--active': activeConversation?.id === conversation.id }"
            >
              <button class="ai-recent-item__main" type="button" @click="selectConversation(conversation)">
                <span class="ai-recent-item__icon">
                  <svg viewBox="0 0 24 24"><path d="M5 5h14v11H9l-4 3V5z" /></svg>
                </span>
                <span>
                  <strong>{{ conversation.title }}</strong>
                  <small>{{ formatMessageTime(conversation.updatedAt) }}</small>
                </span>
              </button>
              <button class="ai-recent-item__delete" type="button" aria-label="删除聊天" @click="removeConversation(conversation)">
                <svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13" /></svg>
              </button>
            </article>
          </div>
        </section>

        <div v-else ref="messageList" class="ai-messages" aria-live="polite">
          <div v-if="loadingMessages" class="ai-history-state">
            <span class="ai-history-spinner"></span>
            正在加载聊天消息...
          </div>
          <div v-else-if="error" class="ai-history-state ai-history-state--error">
            <span>{{ error }}</span>
            <button type="button" @click="activeConversation ? selectConversation(activeConversation) : loadConversations()">重新加载</button>
          </div>
          <div v-for="message in messages" v-show="!loadingMessages" :key="message.id" class="ai-message" :class="`ai-message--${message.role}`">
            <span v-if="message.role === 'assistant'" class="ai-avatar">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="6" width="16" height="13" rx="5" />
                <path d="M12 3v3M8 12h.01M16 12h.01M8 16h8" />
              </svg>
            </span>
            <div class="ai-message__bubble" :class="{ 'ai-message__bubble--error': message.error }">
              <span v-if="message.pending" class="ai-typing" aria-label="AI 正在思考">
                <i></i><i></i><i></i>
              </span>
              <span v-else>{{ message.content }}</span>
              <time v-if="message.createdAt">{{ formatMessageTime(message.createdAt) }}</time>
            </div>
          </div>
        </div>

        <form v-if="!showRecent" class="ai-composer" @submit.prevent="submit">
          <textarea
            v-model="draft"
            rows="1"
            maxlength="2000"
            :disabled="streaming || loadingMessages || creatingConversation"
            placeholder="输入你的问题..."
            aria-label="输入问题"
            @keydown="handleKeydown"
          ></textarea>
          <button v-if="streaming" class="ai-send ai-send--stop" type="button" aria-label="停止生成" @click="stop">
            <span></span>
          </button>
          <button v-else class="ai-send" type="submit" :disabled="!draft.trim()" aria-label="发送消息">
            <svg viewBox="0 0 24 24"><path d="M4 12l16-8-5 16-3-6-8-2zM12 14l8-10" /></svg>
          </button>
        </form>
        <p v-if="!showRecent" class="ai-disclaimer">AI 内容仅供参考，请勿作为投资依据</p>
      </section>
    </Transition>

    <button class="ai-fab" type="button" :aria-label="open ? '关闭 AI 助手' : '打开 AI 助手'" :aria-expanded="open" @click="toggle">
      <svg v-if="!open" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="5.5" width="17" height="14" rx="5" />
        <path d="M12 2.5v3M8 11h.01M16 11h.01M8 15h8M7 19.5l-2 2v-3" />
      </svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      <span v-if="!open" class="ai-fab__status"></span>
    </button>
  </div>
</template>

<style scoped>
.ai-widget {
  position: fixed;
  z-index: 50;
  right: 18px;
  bottom: calc(18px + env(safe-area-inset-bottom));
}

.ai-fab {
  position: relative;
  display: grid;
  width: 58px;
  height: 58px;
  margin-left: auto;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 20px;
  color: white;
  background: linear-gradient(145deg, #256df1, #15a893);
  box-shadow: 0 13px 30px rgba(25, 78, 151, 0.32);
  cursor: pointer;
}

.ai-fab svg {
  width: 28px;
  height: 28px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.ai-fab__status {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 10px;
  height: 10px;
  border: 2px solid white;
  border-radius: 50%;
  background: #5be5d2;
}

.ai-panel {
  display: grid;
  width: min(410px, calc(100vw - 24px));
  height: min(620px, calc(100vh - 108px - env(safe-area-inset-top)));
  min-height: 390px;
  grid-template-rows: auto 1fr auto auto;
  overflow: hidden;
  margin-bottom: 12px;
  border: 1px solid rgba(24, 57, 91, 0.12);
  border-radius: 24px;
  background: #f5f8fb;
  box-shadow: 0 24px 60px rgba(11, 35, 61, 0.28);
  transform-origin: right bottom;
}

.ai-panel__header {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 15px 16px;
  color: white;
  background: linear-gradient(135deg, #081b2e, #123c55);
}

.ai-panel__identity {
  display: grid;
  flex: 1;
  gap: 4px;
}

.ai-panel__actions {
  display: flex;
  gap: 5px;
}

.ai-panel__header strong {
  font-size: 15px;
}

.ai-panel__header span:not(.ai-avatar) {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #9eb4c4;
  font-size: 9px;
}

.ai-panel__header span i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #5be5d2;
  box-shadow: 0 0 8px #5be5d2;
}

.ai-avatar {
  display: grid;
  flex: 0 0 auto;
  width: 29px;
  height: 29px;
  place-items: center;
  border-radius: 10px;
  color: #1b7a6c;
  background: #dff7f2;
}

.ai-avatar--header {
  width: 38px;
  height: 38px;
  color: white;
  background: linear-gradient(145deg, #2d79f5, #23a994);
}

.ai-avatar svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

.ai-icon-button {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 11px;
  color: #a8bcc9;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
}

.ai-icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.ai-icon-button--active {
  color: white;
  background: rgba(45, 121, 245, 0.45);
}

.ai-icon-button svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
}

.ai-messages {
  overflow-y: auto;
  padding: 17px 14px 8px;
  scroll-behavior: smooth;
}

.ai-recents {
  overflow-y: auto;
  padding: 14px;
}

.ai-new-chat {
  display: flex;
  width: 100%;
  min-height: 46px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px dashed #9ebde7;
  border-radius: 14px;
  color: #2467ca;
  background: #edf4ff;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.ai-new-chat:disabled { opacity: 0.55; cursor: default; }
.ai-new-chat svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; }

.ai-recents__list {
  display: grid;
  gap: 9px;
  margin-top: 13px;
}

.ai-recents__empty {
  display: grid;
  min-height: 230px;
  place-content: center;
  gap: 7px;
  color: #6f8193;
  text-align: center;
}

.ai-recents__empty span { font-size: 13px; font-weight: 800; }
.ai-recents__empty small { color: #a0adba; font-size: 10px; }

.ai-recent-item {
  display: flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid #e0e7ed;
  border-radius: 15px;
  background: white;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.ai-recent-item--active {
  border-color: #93b9ef;
  box-shadow: 0 5px 15px rgba(41, 103, 190, 0.09);
}

.ai-recent-item__main {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 10px;
  padding: 12px;
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.ai-recent-item__icon {
  display: grid;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 11px;
  color: #2670d7;
  background: #eaf2ff;
}

.ai-recent-item__icon svg,
.ai-recent-item__delete svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

.ai-recent-item__main > span:last-child {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.ai-recent-item__main strong {
  overflow: hidden;
  color: #263b50;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-recent-item__main small { color: #9ba8b5; font-size: 9px; }

.ai-recent-item__delete {
  display: grid;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  place-items: center;
  margin-right: 4px;
  border-radius: 11px;
  color: #a4afba;
  background: transparent;
  cursor: pointer;
}

.ai-recent-item__delete:hover { color: #d65757; background: #fff0f0; }

.ai-history-state {
  display: flex;
  min-height: 92px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #91a0ae;
  font-size: 11px;
}

.ai-history-state--error {
  flex-direction: column;
  color: #b25252;
  text-align: center;
}

.ai-history-state--error button {
  padding: 6px 10px;
  border-radius: 9px;
  color: #2b6edb;
  background: #e9f0fc;
  font-size: 10px;
  cursor: pointer;
}

.ai-history-spinner {
  width: 15px;
  height: 15px;
  border: 2px solid #d7e0e8;
  border-top-color: #2b75e5;
  border-radius: 50%;
  animation: ai-spin 0.8s linear infinite;
}

.ai-message {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: 14px;
}

.ai-message--user {
  justify-content: flex-end;
}

.ai-message__bubble {
  max-width: 80%;
  padding: 11px 13px;
  border: 1px solid #e1e7ed;
  border-radius: 7px 16px 16px 16px;
  color: #263b50;
  background: white;
  box-shadow: 0 5px 14px rgba(26, 49, 73, 0.05);
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.ai-message--user .ai-message__bubble {
  border-color: transparent;
  border-radius: 16px 7px 16px 16px;
  color: white;
  background: linear-gradient(135deg, #286fe7, #2161cd);
}

.ai-message__bubble--error {
  border-color: #f2c9c9;
  color: #b63d3d;
  background: #fff7f7;
}

.ai-message__bubble time {
  display: block;
  margin-top: 5px;
  color: #a2afbb;
  font-size: 8px;
  line-height: 1;
}

.ai-message--user .ai-message__bubble time {
  color: rgba(255, 255, 255, 0.65);
  text-align: right;
}

.ai-typing {
  display: flex;
  gap: 4px;
  padding: 4px 2px;
}

.ai-typing i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6da3d3;
  animation: ai-bounce 1.1s infinite ease-in-out;
}

.ai-typing i:nth-child(2) { animation-delay: 0.15s; }
.ai-typing i:nth-child(3) { animation-delay: 0.3s; }

.ai-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin: 8px 12px 0;
  padding: 8px 8px 8px 13px;
  border: 1px solid #dfe6ed;
  border-radius: 17px;
  background: white;
  box-shadow: 0 5px 16px rgba(24, 52, 82, 0.06);
}

.ai-composer textarea {
  width: 100%;
  min-height: 34px;
  max-height: 94px;
  padding: 7px 0;
  resize: none;
  border: 0;
  outline: 0;
  color: #20374d;
  background: transparent;
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
}

.ai-composer textarea::placeholder { color: #a0adba; }

.ai-send {
  display: grid;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 12px;
  color: white;
  background: linear-gradient(145deg, #2875ed, #1e63d1);
  cursor: pointer;
}

.ai-send:disabled {
  color: #aab5c0;
  background: #edf1f4;
  cursor: default;
}

.ai-send svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.ai-send--stop { background: #e85b5b; }
.ai-send--stop span { width: 11px; height: 11px; border-radius: 2px; background: white; }

.ai-disclaimer {
  margin: 8px 0 10px;
  color: #a1adba;
  font-size: 8px;
  text-align: center;
}

.ai-panel-enter-active,
.ai-panel-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.ai-panel-enter-from,
.ai-panel-leave-to { opacity: 0; transform: translateY(12px) scale(0.96); }

@keyframes ai-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
  30% { transform: translateY(-4px); opacity: 1; }
}

@keyframes ai-spin {
  to { transform: rotate(360deg); }
}

@media (min-width: 560px) {
  .ai-widget { right: calc((100vw - 480px) / 2 + 18px); }
}

@media (max-height: 560px) {
  .ai-panel { min-height: 0; height: calc(100vh - 92px); }
}
</style>
