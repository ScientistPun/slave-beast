FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Shanghai

# Agent 配置
ENV LOCATION=广东广州
ENV THINK_MODE=false

# 安装基础依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    wget \
    tar \
    gzip \
    redis-server \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# 复制安装脚本
COPY setup.sh /usr/local/bin/setup.sh
RUN chmod +x /usr/local/bin/setup.sh

# 执行安装（Claude Code + cc-switch）
RUN /usr/local/bin/setup.sh && rm -f /usr/local/bin/setup.sh

# 确保 bash 加载 PATH（采用 bash -lc 启动）
SHELL ["/bin/bash", "-lc"]

# 复制项目文件
COPY . /app
WORKDIR /app

# 安装 npm 依赖
RUN npm install

# 启动 Redis（后台运行）
RUN mkdir -p /var/run/redis && chown redis:redis /var/run/redis

# 启动脚本
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

CMD ["/usr/local/bin/start.sh"]
