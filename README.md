# slave-beasts 多Agent调度系统

基于 Node.js + WebSocket + Redis + Claude CLI 的多Agent任务调度系统。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Web 浏览器                              │
│              聊天室 + 任务看板 + 历史记录                      │
└─────────────────────────────────────────────────────────────┘
                              ↕ WebSocket
┌─────────────────────────────────────────────────────────────┐
│                    WebSocket 服务器 (server.js)              │
│         任务排队 + 状态管理 + 聊天记录（Redis）               │
└─────────────────────────────────────────────────────────────┘
                              ↕
        ┌──────────────────────────────────────────┐
        │              包工头 (CEO)                  │
        │         总调度 + 闲聊判断 + 任务分发         │
        └──────────────────────────────────────────┘
                              ↕
        ┌──────────┬──────────┬──────────┐
        │  桥王    │  天文台   │   蛇头   │
        │  (CTO)   │  (CRO)   │  (COO)   │
        └──────────┴──────────┴──────────┘
                              ↕
        ┌──────────┬──────────┐
        │   驴仔   │ 忍者神龟 │
        │   (PM)   │   (QD)   │
        └──────────┴──────────┘
```

## Agent 角色

| 角色 | 名称 | 职责 | 队列规则 |
|------|------|------|----------|
| CEO | 包工头 | 总调度，闲聊判断，任务分发 | 闲聊无限制，任务排队 |
| CTO | 桥王 | 方案设计，战略规划 | 同时1个任务 |
| CRO | 天文台 | 风险审核，合规校验 | 同时1个任务 |
| COO | 蛇头 | 统筹分配，成果汇总 | 同时1个任务 |
| PM | 驴仔 | 技术实现，文案撰写 | 同时1个任务 |
| QD | 忍者神龟 | 质量把控，结果校验 | 同时1个任务 |

## Agent 状态

| 状态 | 含义 |
|------|------|
| `idle` | 空闲，可接收新任务 |
| `processing` | 执行中，不接收新任务 |
| `finish` | 任务完成 |
| `reject` | 审核驳回 |

## 任务流程

```
老细 → 包工头 → 桥王 → 天文台 → 包工头 → 蛇头 → 驴仔 → 忍者神龟 → 蛇头 → 包工头 → 老细
```

## 前置要求

### 1. Claude CLI

每个Agent需要使用Claude CLI与AI交互：

```bash
# 验证 Claude CLI 已安装
claude --version

# 登录 Claude
claude auth
```

### 2. Redis

```bash
# 启动 Redis
redis-server
```

### 3. Agent 系统提示词

创建 `.claude/agent/` 目录并放入各Agent的提示词文件：

```bash
mkdir -p .claude/agent
```

文件列表：
- `.claude/agent/slave-ceo.md` - 包工头
- `.claude/agent/slave-cto.md` - 桥王
- `.claude/agent/slave-cro.md` - 天文台
- `.claude/agent/slave-coo.md` - 蛇头
- `.claude/agent/slave-pm.md` - 驴仔
- `.claude/agent/slave-qd.md` - 忍者神龟

每个文件包含对应Agent的角色定义和职责说明。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.sample .env
# 编辑 .env 填写配置
```

### 3. 启动服务器

```bash
node server.js
```

### 4. 启动 Agent

有两种方式启动 Agent：

**方式一：一键启动所有 Agent**
```bash
node slave-all.js
```

**方式二：单独启动每个 Agent**
```bash
# 终端1：启动包工头
node agents/slave-ceo.js

# 终端2：启动桥王
node agents/slave-cto.js

# 终端3：启动天文台
node agents/slave-cro.js

# 终端4：启动蛇头
node agents/slave-coo.js

# 终端5：启动驴仔
node agents/slave-pm.js

# 终端6：启动忍者神龟
node agents/slave-qd.js
```

### 5. 访问

打开浏览器: http://localhost:8080

## 项目结构

```
slave-beasts/
├── server.js             # WebSocket服务器（后端+前端）
├── slave-all.js          # 一键启动所有Agent
├── .env                  # 环境变量配置
├── config.js             # 配置
├── agents/
│   ├── slave-base.js     # Agent基类
│   ├── slave-ceo.js      # 包工头
│   ├── slave-cto.js      # 桥王
│   ├── slave-cro.js      # 天文台
│   ├── slave-coo.js      # 蛇头
│   ├── slave-pm.js       # 驴仔
│   └── slave-qd.js       # 忍者神龟
├── .claude/agent/        # Agent系统提示词
├── utils/
│   └── logger.js         # 日志系统
└── web/
    ├── index.html        # 前端页面
    ├── index.js          # 前端逻辑
    └── face/             # 头像目录
```

## Redis 结构

| Key | 说明 |
|-----|------|
| `slavebeasts:chat:history` | 聊天记录列表 |
| `slavebeasts:agent:{role}:queue` | Agent任务队列 |
| `slavebeasts:agent:{role}:status` | Agent状态 |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务器端口 | 8080 |
| `WS_URL` | Agent连接的WS地址 | ws://localhost:8080 |
| `REDIS_HOST` | Redis地址 | 127.0.0.1 |
| `REDIS_PORT` | Redis端口 | 6379 |
| `CLAUDE_CLI_PATH` | claude命令路径 | claude |
| `CLAUDE_TIMEOUT` | CLI响应超时(ms) | 60000 |

## 许可证

MIT
