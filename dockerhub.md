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
docker pull [username]/slave-beast:latest
```

### 运行容器

```bash
docker run -d \
  --name slave-beast \
  -p 3000:3000 \
  -v $(pwd)/workspace:/app/workspace \
  -v $(pwd)/logs:/app/logs \
  --restart unless-stopped \
  [username]/slave-beast:latest
```

## 本地构建并推送

### 构建镜像

```bash
# 构建镜像
docker build -t [username]/slave-beast:latest .

# 测试运行
docker run -d -p 3000:3000 --name slave-beast [username]/slave-beast:latest
```

## 自动构建设置

### Docker Hub Automated Build

1. 登录 [Docker Hub](https://hub.docker.com/)
2. 创建 repository: `slave-beast`
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
            [username]/slave-beast:latest
            [username]/slave-beast:${{ github.ref_name }}
```

## 数据持久化

- `workspace/`: Agent 工作目录，存放生成的文件
- `logs/`: 日志文件目录

建议将这些目录挂载到宿主机实现数据持久化。

## 端口说明

| 端口 | 协议 | 说明 |
|------|------|------|
| 3000 | HTTP/WS | WebSocket 服务端口 |

## 健康检查

容器内置健康检查:

```bash
# 手动检查
docker inspect --format='{{.State.Health.Status}}' slave-beast

# 查看健康状态
docker logs --since 30s slave-beast | grep -i health
```

## 常见问题

### 文件权限问题

确保挂载的 `workspace/` 和 `logs/` 目录有正确的读写权限:

```bash
chmod -R 777 workspace/ logs/
```

## 更新升级

```bash
# 拉取新版本
docker pull [username]/slave-beast:latest

# 停止并删除旧容器
docker stop slave-beast && docker rm slave-beast

# 启动新容器
docker run -d \
  --name slave-beast \
  -p 3000:3000 \
  -v $(pwd)/workspace:/app/workspace \
  -v $(pwd)/logs:/app/logs \
  --restart unless-stopped \
  [username]/slave-beast:latest
```
