# slave-beasts（奴隶兽多Agent调度系统）

多Agent智能任务调度系统，基于 Node.js + WebSocket + Redis + Claude Code CLI 构建。系统模拟真实团队协作流程，6个Agent角色各司其职，严格串行执行任务，配套实时看板与聊天持久化。

## 功能特性

- **多Agent串行调度**：6个独立Agent角色，每个同一时间仅执行一个任务，任务自动排队
- **WebSocket实时通讯**：聊天室实时收发消息，支持@指令发布任务，Agent间互相@通讯
- **实时任务看板**：展示每个Agent的状态（idle/processing/finish/reject）、当前任务、排队数量、执行进度
- **聊天持久化**：所有聊天记录存入Redis，页面刷新后自动加载历史
- **会话恢复**：Agent支持断线重连和会话恢复，基于Redis存储sessionId
- **独立日志系统**：每个Agent独立日志，同时输出到终端和文件
- **在线状态显示**：实时展示所有Agent在线/离线状态
- **多轮对话支持**：支持复杂任务多轮交互，自动执行工具调用、文件读写等操作
- **强制工作目录**：所有Agent生成的文件统一保存在`workspace/`目录，避免文件散落
- **一键启停**：提供`start.sh`/`stop.sh`脚本，快速部署管理后台运行的Agent集群

## 系统架构

```
用户（老细）
    ↓
WebSocket 聊天室（群聊 + @指令发布任务/Agent间通讯）
    ↓
server.js（WebSocket服务 + 消息广播 + Redis聊天记录 + 任务看板实时推送）
    ↓
agent-startup.js（统一加载所有Agent，为每个Agent启动独立进程，管理生命周期）
    ↓
┌─────────┬─────────┬─────────┐
│包工头(CEO)│ 桥王(CTO) │天文台(CRO)│
│ 独立队列  │ 独立队列   │ 独立队列   │
│ 串行执行  │ 串行执行   │ 串行执行   │
└─────────┴─────────┴─────────┘
    ↓           ↓
┌─────────┐ ┌─────────────┐
│ 蛇头(COO)│ │ 驴仔(PM)     │
│ 独立队列  │ │ 独立队列      │
│ 串行执行  │ │ 串行执行      │
└─────────┘ └─────────────┘
    ↓           ↓
┌───────────────────────┐
│    忍者神龟(QD)         │
│    独立队列 / 串行执行   │
└───────────────────────┘
    ↓
返回结果 → 推送前端 → 老细查看
```

**支撑层**：
- **WebSocket**：实时消息交互、任务推送、看板数据更新、Agent间@通讯
- **Redis**：存储Agent队列、Agent状态、聊天历史、全局任务记录、Agent会话ID、在线状态
- **Logger**：每个Agent独立日志，输出到终端+文件
- **Claude Code CLI**：以托管模式后台常驻执行Agent任务

## 技术栈

- **Runtime**: Node.js >= 18.0.0
- **WebSocket**: ws ^8.16.0
- **Redis Client**: ioredis ^5.3.2
- **日志**: winston ^3.13.0
- **会话管理**: Claude Code CLI
- **工具库**: uuid, dotenv

## 目录结构

```
slave-beasts/
├── package.json           # 项目依赖、脚本
├── server.js              # 核心服务：WebSocket、消息广播、Redis处理、看板推送
├── agent-startup.js       # Agent加载入口：支持单Agent/全部Agent启动，独立进程管理
├── start.sh               # 一键后台启动所有Agent脚本
├── stop.sh                # 一键停止所有后台Agent脚本
├── web/
│   ├── index.html         # 前端页面（聊天室 + 看板 + Agent在线状态）
│   └── index.js           # 前端逻辑（WS连接、消息渲染、看板刷新）
├── agents/
│   ├── base.js            # Agent基类：init、processLoop、processTask、CLI启动、会话恢复
│   ├── ceo.js             # 包工头（CEO）
│   ├── cto.js             # 桥王（CTO）
│   ├── cro.js             # 天文台（CRO）
│   ├── coo.js             # 蛇头（COO）
│   ├── pm.js              # 驴仔（PM）
│   └── qd.js              # 忍者神龟（QD）
├── .claude/agents/        # Claude Agent角色配置目录（各Agent的system prompt）
├── workspace/             # Agent工作目录，所有生成/保存的文件都会存在这里
├── utils/
│   ├── logger.js          # 日志工具（winston封装）
│   └── redis.js           # Redis工具类（队列、状态、聊天记录）
├── logs/                  # 日志文件存储目录（自动创建）
├── .env.example           # 环境变量示例
└── README.md              # 项目说明文档
```

## 安装部署

### 环境要求

- **Node.js**: >= 18.0.0
- **Redis**: 4.0+ (本地或远程可访问)
- **Claude Code CLI**: 已安装并配置好

### 依赖安装

```bash
cd /Users/koali/slaves
npm install
```

### 配置说明

复制 `.env.example` 为 `.env`，或直接创建 `.env` 文件：

```bash
cp .env.example .env
```

编辑 `.env` 配置项：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `REDIS_HOST` | localhost | Redis服务器地址 |
| `REDIS_PORT` | 6379 | Redis端口 |
| `REDIS_PASSWORD` | - | Redis密码（可选） |
| `REDIS_DB` | 0 | Redis数据库编号 |
| `PORT` | 3000 | WebSocket服务端口 |

### 启动命令

**1. 启动 WebSocket 服务**（必须先启动）：

```bash
npm start
# 或开发模式（热重载）
npm run dev
```

**2. 启动 Agent（推荐一键脚本）**：

```bash
# 一键后台启动所有Agent（关闭终端不退出）
./start.sh

# 一键停止所有后台Agent
./stop.sh
```

**手动启动方式**：
```bash
# 启动单个Agent
node agent-startup.js ceo      # 启动包工头
node agent-startup.js cto      # 启动桥王
node agent-startup.js cro      # 启动天文台
node agent-startup.js coo      # 启动蛇头
node agent-startup.js pm        # 启动驴仔
node agent-startup.js qd        # 启动忍者神龟

# 启动全部Agent（前台运行）
node agent-startup.js all
```

**3. 访问前端页面**：

打开浏览器访问 `http://localhost:3000`

### 清理Redis数据（如需重置）：

```bash
npm run redis:clear
# 或
redis-cli FLUSHDB
```

## 使用指南

### @指令格式

用户通过@指令向特定Agent分配任务：

```
@包工头 任务内容    → 分配给包工头
@桥王 任务内容      → 分配给桥王
@天文台 任务内容    → 分配给天文台
@蛇头 任务内容      → 分配给蛇头
@驴仔 任务内容      → 分配给驴仔
@忍者神龟 任务内容   → 分配给忍者神龟
```

> 也可直接在看板区域点击Agent卡片，自动填充@指令到输入框。

### 任务流程

```
老细 → 包工头 → 桥王 → 天文台 → 蛇头 → 驴仔 → 忍者神龟 → 蛇头 → 包工头 → 老细
```

1. 用户（老细）在聊天室发送`@ceo 任务描述`发布任务
2. 包工头（CEO）接收并解析任务
3. 任务按流程依次流转各个Agent
4. 每个Agent收到@消息后：
   - 空闲状态 → 回复"收到"，立即处理
   - 忙碌状态 → 回复"在忙"，任务自动进入排队队列
5. 任务完成后，结果逐级返回，最终由包工头汇报老细
6. 整个流程的消息实时展示在聊天室，状态更新推送至看板

### Agent响应规则

- **收到@消息**：立即回复"收到"（空闲）或"在忙"（执行中）
- **任务驳回**：审核不通过时回复"驳回"及理由，状态标记为reject
- **任务完成**：自动取下一条队列任务继续执行

## Agent角色说明

| Agent | 代号 | 职责 | 特点 |
|-------|------|------|------|
| **包工头** | CEO | 全局任务调度中心，接收老细任务，按流程分配，跟踪结果并汇总汇报 | 总指挥，连接老细与团队 |
| **桥王** | CTO | 方案设计、战略规划、技术路径制定 | 技术专家，架构设计 |
| **天文台** | CRO | 风险审核、合规校验、可行性判断 | 风控专家，审核决策 |
| **蛇头** | COO | 统筹分配、进度协调、成果汇总 | 运营统筹，进度管理 |
| **驴仔** | PM | 技术实现、文案撰写、具体执行落地 | 执行者，落地专家 |
| **忍者神龟** | QD | 质量把控、落地实施校验、结果审核 | 质量把关，最后防线 |

### 状态说明

- **idle（空闲）**：Agent处于空闲，可接收新任务
- **processing（执行中）**：Agent正在处理任务
- **finish（已完成）**：任务执行完成
- **reject（已驳回）**：任务被驳回
- **busy（忙碌）**：Agent忙碌中，新任务入队

### 工作目录说明
所有Agent生成、保存的文件都会统一存储在 `workspace/` 目录下，禁止写入其他目录。需要查看Agent输出的文档、生成的文件，直接到 `workspace/` 目录查找即可。

## Redis 数据结构

| 键名 | 类型 | 说明 |
|------|------|------|
| `slavebeasts:chat:history` | List | 全局聊天记录（最新1000条） |
| `slavebeasts:agent:<name>:queue` | List | 每个Agent的独立任务队列 |
| `slavebeasts:agent:<name>:status` | String | 每个Agent的状态JSON |
| `slavebeasts:tasks` | Hash | 全局任务列表 |
| `slavebeasts:agent:<name>:session` | String | Agent会话ID |
| `slavebeasts:agent:online` | Hash | Agent在线状态 |
