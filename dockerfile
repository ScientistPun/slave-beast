FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Shanghai
ENV PORT=3000

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

# 复制项目文件
COPY . /app
WORKDIR /app

# 安装 npm 依赖
RUN npm install

# 确保 bash 加载 PATH
SHELL ["/bin/bash", "-lc"]

# 启动脚本
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

CMD ["/usr/local/bin/start.sh"]
