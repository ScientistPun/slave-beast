# Docker Hub 部署指南

本文档说明如何将奴隶兽系统部署到 Docker Hub 并进行自动化构建。

## 镜像信息

**仓库地址**: [Docker Hub 仓库地址]

**镜像版本**:
- `latest`: 最新稳定版
- `vx.x.x`: 版本标签

## 快速部署

### 拉取镜像

```bash
docker pull [username]/slave-beasts:latest
```

### 运行容器

```bash
docker run -d \
  --name slave-beasts \
  -p 3000:3000 \
  -v $(pwd)/workspace:/app/workspace \
  -v $(pwd)/logs:/app/logs \
  --restart unless-stopped \
  [username]/slave-beasts:latest
```

### Docker Compose 部署

```yaml
version: '3.8'

services:
  slave-beasts:
    image: [username]/slave-beasts:latest
    container_name: slave-beasts
    ports:
      - "3000:3000"
    volumes:
      - ./workspace:/app/workspace
      - ./logs:/app/logs
      - ./.env:/app/.env
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
      - REDIS_PORT=6379
```

## 本地构建并推送

### 构建镜像

```bash
# 构建镜像
docker build -t [username]/slave-beasts:latest .

# 测试运行
docker run -d -p 3000:3000 --name slave-beasts [username]/slave-beasts:latest
```

### 推送至 Docker Hub

```bash
# 登录 Docker Hub
docker login

# 推送 latest 标签
docker push [username]/slave-beasts:latest

# 推送版本标签
docker tag [username]/slave-beasts:latest [username]/slave-beasts:1.0.0
docker push [username]/slave-beasts:1.0.0
```

## 自动构建设置

### Docker Hub Automated Build

1. 登录 [Docker Hub](https://hub.docker.com/)
2. 创建 repository: `slave-beasts`
3. 关联 GitHub/GitLab 仓库
4. 设置构建规则:
   - Branch: `main` → `latest`
   - Tag: `vx.x.x` → `vx.x.x`

### GitHub Actions 自动构建

创建 `.github/workflows/docker.yml`:

```yaml
name: Build and Push Docker Image

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
        
      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
          
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            [username]/slave-beasts:latest
            [username]/slave-beasts:${{ github.ref_name }}
```

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | 3000 | 服务端口 |
| `REDIS_HOST` | localhost | Redis 地址 |
| `REDIS_PORT` | 6379 | Redis 端口 |
| `REDIS_PASSWORD` | - | Redis 密码 |
| `REDIS_DB` | 0 | Redis 数据库 |
| `ANTHROPIC_API_KEY` | - | Claude API 密钥 |

## 数据持久化

- `workspace/`: Agent 工作目录，存放生成的文件
- `logs/`: 日志文件目录
- `.env`: 环境配置文件

建议将这些目录挂载到宿主机实现数据持久化。

## 端口说明

| 端口 | 协议 | 说明 |
|------|------|------|
| 3000 | HTTP/WS | WebSocket 服务端口 |

## 健康检查

容器内置健康检查:

```bash
# 手动检查
docker inspect --format='{{.State.Health.Status}}' slave-beasts

# 查看健康状态
docker logs --since 30s slave-beasts | grep -i health
```

## 常见问题

### 容器内 Agent 无法连接 Claude

确保 `ANTHROPIC_API_KEY` 环境变量已正确设置，并且宿主机网络可以访问 Anthropic API。

### Redis 连接失败

检查 `REDIS_HOST` 是否正确指向可访问的 Redis 实例。Docker Compose 部署时会自动链接 redis 服务。

### 文件权限问题

确保挂载的 `workspace/` 和 `logs/` 目录有正确的读写权限:

```bash
chmod -R 777 workspace/ logs/
```

## 更新升级

```bash
# 拉取新版本
docker pull [username]/slave-beasts:latest

# 停止并删除旧容器
docker stop slave-beasts && docker rm slave-beasts

# 启动新容器
docker run -d \
  --name slave-beasts \
  -p 3000:3000 \
  -v $(pwd)/workspace:/app/workspace \
  -v $(pwd)/logs:/app/logs \
  --restart unless-stopped \
  [username]/slave-beasts:latest
```
