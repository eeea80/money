# QuantDinger 云服务器部署指南

本文说明当前版本 QuantDinger 在云服务器上的 Docker 部署方式，覆盖推荐的 GHCR 预构建镜像部署、可选源码部署、Nginx、HTTPS、升级和常见排错。

首次安装时如果遇到 Docker 拉镜像或 Postgres 启动问题，也请参考 [安装排错指南](INSTALL_TROUBLESHOOTING.md)。

## 推荐架构

推荐使用一个公网域名加宿主机 Nginx 反向代理：

- Web 访问地址：`https://app.example.com`
- 可选移动 H5 地址：`https://m.example.com`
- 宿主机 Nginx 监听 `80/443`
- Docker `frontend` 绑定到 `127.0.0.1:8888`
- Docker `mobile` 绑定到 `127.0.0.1:8889`
- Docker `backend` 绑定到 `127.0.0.1:5000`
- Docker `postgres` 和 `redis` 只绑定本机地址

公网只开放 `80` 和 `443`。不要把 `5000`、`5432`、`6379` 暴露到公网。

## 1. 准备服务器

推荐配置：

- Ubuntu 22.04 / 24.04 或 Debian 12
- 最低 2 核 4 GB 内存；AI 使用较多时建议 4 核 8 GB
- 30 GB 以上磁盘空间
- 安全组或防火墙开放 `22`、`80`、`443`
- 一个域名，例如 `app.example.com`

配置 DNS：

```text
app.example.com -> 服务器公网 IP
m.example.com   -> 服务器公网 IP  # 可选移动 H5 域名
```

验证解析：

```bash
ping app.example.com
```

## 2. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

请使用 Compose v2 命令：`docker compose ...`。

## 3. 选择部署模式

### 推荐：GHCR 预构建镜像部署

普通云服务器部署建议使用这个模式。后端、Web 前端、移动 H5 都从 GHCR 拉取镜像，不需要在服务器上本地构建 Python 或 Node 项目。

```bash
mkdir -p ~/quantdinger
cd ~/quantdinger
curl -O https://raw.githubusercontent.com/OpenByteInc/QuantDinger/main/docker-compose.ghcr.yml
curl -o backend.env https://raw.githubusercontent.com/OpenByteInc/QuantDinger/main/backend_api_python/env.example
```

首次启动前编辑 `backend.env`：

```ini
ADMIN_USER=your_admin_user
ADMIN_PASSWORD=your_strong_password
FRONTEND_URL=https://app.example.com,https://m.example.com
ALLOW_LOCAL_DESKTOP_BROKERS=false
```

GHCR 后端入口脚本可以在首次启动时自动生成 `SECRET_KEY` 并写回 `backend.env`。你也可以手动设置一个足够长的随机字符串。

可选：创建项目根目录 `.env`，用于 Docker Compose 编排配置：

```ini
FRONTEND_HOST=127.0.0.1
FRONTEND_PORT=8888
MOBILE_HOST=127.0.0.1
MOBILE_PORT=8889
# 第一个地址是 OAuth 登录后的默认跳转目标
FRONTEND_URL=https://app.example.com,https://m.example.com
BACKEND_PORT=127.0.0.1:5000
DB_PORT=127.0.0.1:5432
REDIS_PORT=127.0.0.1:6379

# 固定版本，避免一直使用 latest，例如：
# IMAGE_TAG=5.0.18

# postgres/redis 拉取慢时可设置 Docker Hub 镜像前缀：
# IMAGE_PREFIX=docker.m.daocloud.io/library/
```

启动：

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
docker compose -f docker-compose.ghcr.yml ps
```

### 宝塔面板 Docker 插件与端口修改

宝塔面板导入 Compose 项目后，容器详情页通常不能可靠地修改由 Compose 管理的端口。不要直接编辑已经创建好的容器端口；修改项目根目录 `.env` 后重新创建对应容器：

```bash
docker compose -f docker-compose.ghcr.yml up -d --force-recreate frontend mobile backend
```

`backend` 容器内部监听 `5000` 是应用协议的一部分，保持不变是正常的。`BACKEND_PORT=127.0.0.1:5000` 修改的是宿主机绑定；前端容器通过 Docker 网络访问 `backend:5000`。如需调整用户访问端口，只修改 `FRONTEND_PORT` / `MOBILE_PORT`，然后重新创建容器。

生产环境不要把 `5000`、`5432`、`6379` 直接暴露到公网。宝塔或 1Panel 的 Nginx/OpenResty 应只对公网开放 `80/443`：页面请求转发到宿主机本地的 Web 前端端口（默认 `127.0.0.1:8888`），`/api/` 请求直接转发到同样只绑定本机的后端端口 `127.0.0.1:5000`。这样仍保持浏览器同源，同时避免前端容器二次代理覆盖真实客户端 IP。

### 可选：完整源码部署

只有需要在服务器上基于本地源码构建后端时，才建议使用这个模式。

```bash
git clone https://github.com/OpenByteInc/QuantDinger.git
cd QuantDinger
cp backend_api_python/env.example backend_api_python/.env
./scripts/generate-secret-key.sh
```

编辑 `backend_api_python/.env`：

```ini
ADMIN_USER=your_admin_user
ADMIN_PASSWORD=your_strong_password
FRONTEND_URL=https://app.example.com,https://m.example.com
ALLOW_LOCAL_DESKTOP_BROKERS=false
```

也可以按上面的示例创建项目根目录 `.env`。Compose 会从根目录 `.env` 展开并向后端容器注入 `FRONTEND_URL`；请在这里也设置生产前端域名，并与后端运行时 env 保持一致。否则 Compose 的 localhost 默认值会覆盖后端运行时 env 中的值。

启动：

```bash
docker compose pull
docker compose up -d --build
docker compose ps
```

## 4. 理解两个 env 文件

请区分这几类配置文件：

| 文件 | 使用方 | 用途 |
|------|--------|------|
| `backend.env` | `docker-compose.ghcr.yml` 的后端容器 | 应用运行时配置：管理员账号、`SECRET_KEY`、LLM key、OAuth、券商或交易所 key |
| `backend_api_python/.env` | 完整源码部署的后端容器 | 源码部署时的应用运行时配置 |
| 项目根目录 `.env` | Docker Compose | 公共前端域名、端口、镜像 tag、镜像地址、Postgres 镜像和数据目录、镜像源 |

除非 Compose 明确需要，不要把交易所 API key 这类业务密钥放到项目根目录 `.env`。当前 Compose 会显式注入 `FRONTEND_URL`，因此该项应写入根目录 `.env`；应用密钥仍写入 `backend.env` 或 `backend_api_python/.env`。

## 5. 配置 Nginx

安装 Nginx：

```bash
sudo apt update
sudo apt install -y nginx
```

创建 `/etc/nginx/sites-available/quantdinger.conf`：

宿主机代理应在同一公网域名下拆分页面与 API：`/api/` 直接进入只绑定本机的后端 `5000`，其余页面进入 Web `8888` 或移动 H5 `8889`。不要把全部请求先送入前端容器再二次代理 API；新版后端会安全地验证代理来源，而二次代理可能把 `X-Real-IP` 覆盖为 Docker 网关地址。

```nginx
server {
    listen 80;
    server_name app.example.com;

    client_max_body_size 20m;

    location = /api/ai/chat/message/stream {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_request_buffering off;
        proxy_connect_timeout 75s;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        send_timeout 600s;
        add_header X-Accel-Buffering "no" always;
        add_header Cache-Control "no-cache, no-transform" always;
    }

    location ^~ /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_connect_timeout 75s;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    location / {
        proxy_pass http://127.0.0.1:8888;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name m.example.com;

    client_max_body_size 20m;

    location = /api/ai/chat/message/stream {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_request_buffering off;
        proxy_connect_timeout 75s;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        send_timeout 600s;
        add_header X-Accel-Buffering "no" always;
        add_header Cache-Control "no-cache, no-transform" always;
    }

    location ^~ /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_connect_timeout 75s;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    location / {
        proxy_pass http://127.0.0.1:8889;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

如果不需要独立移动端域名，可以删除第二个 `server` 块。移动 H5 也可以通过你自己配置的端口、路径或域名访问。`5000` 仍只监听 `127.0.0.1`，由同机 Nginx/OpenResty 访问，不等于将后端端口暴露到公网。

启用站点：

```bash
sudo ln -s /etc/nginx/sites-available/quantdinger.conf /etc/nginx/sites-enabled/quantdinger.conf
sudo nginx -t
sudo systemctl reload nginx
```

如果使用 UFW：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 6. 开启 HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d app.example.com -d m.example.com
sudo certbot renew --dry-run
```

如果只配置了 `app.example.com`，证书申请命令里只保留这个域名即可。

访问：

```text
https://app.example.com
https://m.example.com
```

## 7. 可选 API 子域名

推荐部署方式是在宿主机反向代理处保持同源并拆分流量：

```text
Browser -> https://app.example.com -> 宿主机 Nginx -> /      -> frontend:8888
                                                    -> /api/ -> backend:5000
```

如果确实需要 `api.example.com`，只通过 Nginx 暴露宿主机本地后端端口：

```nginx
server {
    listen 80;
    server_name api.example.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

同时在后端运行时 env 中设置 `FRONTEND_URL`，包含所有用户实际访问的前端域名。

## 8. 常用运维

GHCR 部署：

```bash
docker compose -f docker-compose.ghcr.yml ps
docker compose -f docker-compose.ghcr.yml logs -f backend
docker compose -f docker-compose.ghcr.yml logs -f postgres
docker compose -f docker-compose.ghcr.yml restart backend
```

更新 GHCR 镜像：

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

完整源码部署更新：

```bash
git pull
docker compose pull
docker compose up -d --build
```

大版本升级前建议先备份 Postgres：

```bash
docker exec quantdinger-db pg_dump -U quantdinger quantdinger > quantdinger_backup.sql
```

## 9. Postgres 18 和已有数据

当前默认 Postgres 镜像是 `postgres:18.3-alpine`，`PGDATA=/var/lib/postgresql/18/docker`。

如果已有数据卷是 Postgres 16 初始化的，不要直接用 Postgres 18 启动。请选择：

- 继续使用匹配的 Postgres 16 镜像，直到完成迁移；
- 使用 `pg_dump` 和 `pg_restore` 导出导入；
- 使用正式的 `pg_upgrade` 大版本迁移流程。

只有开发环境且数据库数据可以丢弃时，按你的部署模式选择命令。

GHCR 部署：

```bash
docker compose -f docker-compose.ghcr.yml down -v
docker compose -f docker-compose.ghcr.yml up -d
```

完整源码部署：

```bash
docker compose down -v
docker compose up -d
```

生产数据不要使用 `down -v`。

## 10. 常见问题

### 镜像拉取失败

如果 `redis`、`postgres` 或 Docker Hub 镜像拉取失败，可在项目根目录 `.env` 设置镜像前缀：

```ini
IMAGE_PREFIX=docker.m.daocloud.io/library/
```

然后重试：

```bash
docker compose -f docker-compose.ghcr.yml pull
```

如果 GHCR 镜像拉取失败：

```bash
docker pull ghcr.io/openbyteinc/quantdinger-backend:latest
docker pull ghcr.io/openbyteinc/quantdinger-frontend:latest
docker pull ghcr.io/openbyteinc/quantdinger-mobile:latest
```

常见原因包括网络阻断、包可见性不是 public、或者固定的 tag 不存在。

### 后端启动后立刻退出

查看日志：

```bash
docker compose -f docker-compose.ghcr.yml logs --tail=100 backend
```

常见原因：

- 后端 env 文件语法错误；
- 完整源码部署时 `SECRET_KEY` 仍是默认占位值；
- 数据库没有健康启动；
- 手动覆盖了错误的 `DATABASE_URL`。

### Nginx 502 或页面空白

先检查本机服务：

```bash
curl http://127.0.0.1:8888/health
curl http://127.0.0.1:8889/health
curl http://127.0.0.1:5000/api/health
sudo nginx -t
```

再检查容器：

```bash
docker compose -f docker-compose.ghcr.yml ps
docker compose -f docker-compose.ghcr.yml logs --tail=100 frontend
docker compose -f docker-compose.ghcr.yml logs --tail=100 backend
```

### 注册或登录 IP 显示为 Docker 网关

如果审计记录中的客户端 IP 全部显示为 `172.17.0.1`、`172.18.0.1`、`172.19.0.1` 等私网地址，说明后端记录的是 Docker 网关，而不是真实访客地址。典型原因是宿主机代理先把全部请求送到 `8888` 或 `8889`，随后前端容器再次代理 `/api/` 并覆盖 `X-Real-IP`。

使用第 5 节的拆分配置：

- PC 和移动域名的 `/api/` 都直接转发到 `127.0.0.1:5000`；
- PC 页面 `/` 转发到 `127.0.0.1:8888`；
- 移动 H5 页面 `/` 转发到 `127.0.0.1:8889`；
- 每层受信代理都应覆盖 `X-Real-IP`，并使用 `$proxy_add_x_forwarded_for` 追加转发链；
- 不要为了修复显示结果而让后端无条件信任来自公网的 `X-Forwarded-For`，否则客户端可以伪造审计 IP。

1Panel/OpenResty 经常把通用 `location /` 放在单独的 `proxy/*.conf` 中。改成完整站点配置时，不要同时保留另一个定义相同 `location` 的 include，否则 Nginx 会因重复 location 无法加载。历史记录不会自动修改；请在重载代理后用新登录或测试账号验证。

如果域名前还有 Cloudflare 或其他 CDN，宿主机看到的 `$remote_addr` 默认可能是 CDN 节点。应按照 CDN 官方公布的最新出口 CIDR 配置 Nginx `real_ip` 模块，并限制只有受信 CDN 可以访问源站；不要直接信任任意请求传入的 `CF-Connecting-IP` 或类似请求头。

### AI 流式输出约 50～60 秒后中断

典型症状：

- `/api/ai/chat/message/stream` 已返回部分内容，约 50～60 秒后在浏览器网络面板中变为失败；
- 前端随后退回普通 `/api/ai/chat/message` 请求；
- 后端容器没有重启、没有 OOM，后端日志也不一定出现 `chat_message_stream failed`。

这通常发生在宿主机 Nginx、1Panel OpenResty 等外层反向代理继续使用默认超时和响应缓冲时。即使 Docker 内部的前端代理已经配置 600 秒，外层代理仍可能先中断 SSE 连接。

在每个对外提供 AI 聊天的域名配置中，为 SSE 路径增加独立的精确匹配，并直接转发到只绑定宿主机本地的后端端口 `5000`：

```nginx
location = /api/ai/chat/message/stream {
    proxy_pass http://127.0.0.1:5000;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";

    proxy_buffering off;
    proxy_cache off;
    proxy_request_buffering off;

    proxy_connect_timeout 75s;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    send_timeout 600s;

    add_header X-Accel-Buffering "no" always;
    add_header Cache-Control "no-cache, no-transform" always;
}
```

1Panel OpenResty 的站点配置和日志通常挂载在：

```text
/opt/1panel/www/sites/<域名>/proxy/
/opt/1panel/www/sites/<域名>/log/access.log
/opt/1panel/www/sites/<域名>/log/error.log
```

修改后先验证再重载；容器名以实际环境为准：

```bash
docker exec <openresty-container> /usr/local/openresty/nginx/sbin/nginx -t
docker exec <openresty-container> /usr/local/openresty/nginx/sbin/nginx -s reload
```

如果仍会中断，在错误日志中搜索 `upstream timed out`、`upstream prematurely closed connection`、`499`、`502` 和 `504`，同时检查后端容器的 `RestartCount` 与 `OOMKilled`。

### 交易所或 LLM 出网需要代理

后端运行时请求外网需要代理时，在 `backend.env` 或 `backend_api_python/.env` 设置 `PROXY_URL`。

在 Docker 容器内不要直接写宿主机的 `127.0.0.1`，除非代理就在同一个容器里。可以使用容器可访问的宿主机地址，例如：

```ini
PROXY_URL=socks5h://host.docker.internal:10808
```

Linux 服务器上可能需要把代理监听到内网地址，或配置 Docker host gateway。

### 公网端口

不要公开这些端口：

- `5000`
- `5432`
- `6379`

公网只开放：

- `80`
- `443`
