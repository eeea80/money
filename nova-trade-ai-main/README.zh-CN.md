<div align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</div>

# Nova Trade AI

Nova Trade AI 是一个面向移动端的智能投研示例项目，包含真实金融数据驱动的 CANSLIM 股票分析、DeepSeek AI 研究建议、流式聊天、用户账号和聊天记录管理。

项目采用前后端分离架构，并提供 Docker Compose，可一次启动 H5 前端、Spring Boot 后端和 PostgreSQL 数据库。

## 功能

- 智能股票分析：股票检索、行情、财务数据、CANSLIM 七维评分和风险提示
- AI 研究建议：根据结构化分析结果生成谨慎的中文研究摘要
- AI 聊天机器人：支持 SSE 流式输出、创建会话和历史消息
- 用户系统：注册、登录、个人资料、修改密码和 Token 鉴权
- H5 工作台：首页聚合股票分析和 AI 聊天，个人信息集中在独立页面
- 容器化部署：Nginx、Spring Boot、PostgreSQL 一键编排

## 项目演示

<p align="center">
  <img src="docs/images/stock-analysis-demo.png" alt="Nova Trade AI 智能股票分析演示" width="390">
</p>

## 技术栈

- 后端：Java 21、Spring Boot 4.1、Spring AI 2.0、MyBatis-Plus
- 前端：Vue 3、Vue Router、Vite、Nginx
- 数据库：PostgreSQL 17
- 外部服务：DeepSeek API、同花顺金融数据（Fuyao）API

## Linux 一键启动

### 1. 环境要求

准备一台 Linux 主机，并安装：

- Git
- Docker Engine
- Docker Compose v2 插件（使用 `docker compose` 命令）

确认环境可用：

```bash
docker --version
docker compose version
git --version
```

如果当前用户没有 Docker 权限，可以使用 `sudo docker compose`，或者将用户加入 `docker` 用户组后重新登录：

```bash
sudo usermod -aG docker "$USER"
```

### 2. 准备配置

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env`，至少配置下面两个 Key：

```dotenv
DEEPSEEK_API_KEY=你的_DeepSeek_API_Key
FUYAO_API_KEY=你的_Fuyao_API_Key
```

未配置 Key 时容器仍可启动，但对应的 AI 或股票分析功能不可用。

建议同时修改默认数据库密码：

```dotenv
POSTGRES_PASSWORD=请替换为高强度密码
```

### 3. 启动全部服务

```bash
docker compose up --build -d
```

启动完成后访问：

- H5 前端：`http://<Linux服务器IP>:3100`
- 后端 API（仅服务器本机）：<http://127.0.0.1:18080>
- PostgreSQL（仅服务器本机）：`127.0.0.1:15432`

如果启用了 UFW，需要开放 H5 端口：

```bash
sudo ufw allow 3100/tcp
```

首次初始化会创建默认用户：

| 账号 | 密码 |
| --- | --- |
| `admin` | `admin123` |

登录后请立即修改默认密码。

### 4. 查看日志与停止服务

```bash
docker compose logs -f
docker compose down
```

如需同时删除数据库数据并重新执行 `sql/init.sql`：

```bash
docker compose down -v
docker compose up --build -d
```

> `docker compose down -v` 会永久删除当前 Compose 数据卷中的数据库数据，请先备份。

## 配置说明

所有敏感信息和可变参数均通过根目录 `.env` 注入。`.env` 已被 Git 忽略，不要将真实 Key 提交到仓库。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | `3100` | H5 对外端口 |
| `BACKEND_PORT` | `18080` | 后端本机调试端口 |
| `POSTGRES_EXPOSE_PORT` | `15432` | PostgreSQL 本机端口 |
| `POSTGRES_DB` | `nova_trade` | 数据库名 |
| `POSTGRES_USER` | `nova` | 数据库用户 |
| `POSTGRES_PASSWORD` | `nova_change_me` | 数据库密码，公开部署前必须修改 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek API 地址 |
| `DEEPSEEK_API_KEY` | `not-configured` | DeepSeek API Key |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | AI 聊天及股票建议使用的模型 |
| `DEEPSEEK_TIMEOUT` | `30s` | DeepSeek 请求超时 |
| `DEEPSEEK_TEMPERATURE` | `0.7` | 模型温度 |
| `DEEPSEEK_MAX_TOKENS` | `2048` | 单次生成 Token 上限 |
| `FUYAO_BASE_URL` | `https://fuyao.aicubes.cn` | Fuyao API 地址 |
| `FUYAO_API_KEY` | `not-configured` | Fuyao API Key |
| `FUYAO_TIMEOUT` | `15s` | Fuyao 请求超时 |

修改 `.env` 后重新创建容器使配置生效：

```bash
docker compose up --build -d --force-recreate
```

## 容器结构

```text
浏览器 :3100
    │
    ▼
Nginx / Vue H5 ── /api ──▶ Spring Boot :8080 ──▶ PostgreSQL :5432
                                      │
                                      ├──▶ DeepSeek API
                                      └──▶ Fuyao 金融数据 API
```

前端 Nginx 会把 `/api` 转发给后端，并关闭代理缓冲以支持 AI 聊天的 SSE 流式响应。数据库仅绑定本机端口，容器间使用 Compose 内部网络通信。

## 本地开发

下面的命令面向 Linux 开发环境。需要安装 JDK 21、Node.js 22、npm 和 PostgreSQL。

### 后端

准备 PostgreSQL，并设置 `POSTGRES_*`、`DEEPSEEK_*` 和 `FUYAO_*` 环境变量，然后执行：

```bash
chmod +x mvnw
./mvnw spring-boot:run
```

后端测试：

```bash
./mvnw test
```

### 前端

```bash
cd web
npm install
npm run dev
```

开发服务器默认运行在 <http://localhost:5173>，并将 `/api` 代理到 <http://localhost:8080>。

生产构建：

```bash
cd web
npm run build
```

## 项目结构

```text
.
├── src/                 Spring Boot 后端
├── web/                 Vue H5 前端与 Nginx 配置
├── sql/init.sql         PostgreSQL 初始化脚本
├── APIDoc/              接口与数据源文档
├── Dockerfile           后端镜像构建文件
├── compose.yaml         三服务编排
├── .env.example         环境变量模板
└── LICENSE              MIT 开源许可证
```

## API 文档

- [CANSLIM 股票分析接口](APIDoc/CANSLIM股票分析接口.md)
- [同花顺金融数据 API 参考](APIDoc/同花顺金融数据%20API%20文档.txt)

## 安全提示

- 不要提交 `.env`、真实 API Key、生产数据库密码或访问令牌。
- 开源前请轮换任何曾经写入 Git 历史的 Key；仅删除当前文件中的明文并不能清除 Git 历史。
- 默认管理员账号只用于首次体验，公开部署后应立即修改密码。
- 当前项目用于研究与技术演示，不构成投资建议。

## License

本项目采用宽松、社区使用广泛的 [MIT License](LICENSE)。你可以自由使用、修改和分发代码，但需要保留原始版权及许可声明。
