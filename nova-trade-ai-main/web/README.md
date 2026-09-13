# Nova Trade H5

基于 Vue 3、Vue Router 和 Vite 的移动端智能投研工作台，包含股票分析、AI 聊天和独立个人中心。

完整的 Docker Compose 启动与配置说明见项目根目录 [`README.zh-CN.md`](../README.zh-CN.md)。

## 本地开发

```bash
npm install
npm run dev
```

开发服务器默认运行在 `http://localhost:5173`，并将 `/api` 代理到 `http://localhost:8080`。可复制 `.env.example` 为 `.env.local` 修改后端地址。

## 生产构建

```bash
npm run build
```

同域部署时无需设置 `VITE_API_BASE_URL`；前后端分离部署时，将它设置为后端完整地址。

## 已接入接口

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/users/me`
- `PUT /api/users/me`
- `PUT /api/users/me/password`
- `POST /api/ai/chat`（SSE 流式响应）
- `GET /api/ai/conversations`（最近聊天）
- `POST /api/ai/conversations`（创建新聊天）
- `GET /api/ai/conversations/{id}/messages`（会话消息）
- `DELETE /api/ai/conversations/{id}`（删除会话）
- `GET /api/ai/chat/history`（查询聊天记录）
- `DELETE /api/ai/chat/history`（清空聊天记录）
- `POST /api/ai/stocks/canslim`（真实金融数据 CANSLIM 评分与 AI 建议）
