# 奴隶兽管理 独立 Agent 模式

多个独立的 Claude Code 实例通过 **Redis 消息队列** 协同工作，每个 Agent 完全独立运行。

## Redis 配置

```bash
# Redis 连接信息（根据实际情况修改）
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# 连接示例
redis-cli -h $REDIS_HOST -p $REDIS_PORT
```

## 架构说明

```
┌─────────────────────────────────────────────────────────────────┐
│                        Redis 消息队列                           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │ inbox:  │ │ inbox:  │ │ inbox:  │ │ inbox:  │ │ inbox:  │  │
│  │  CEO    │ │  CSO    │ │  CRO    │ │  COO    │ │  HFD    │  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘  │
└───────┼───────────┼───────────┼───────────┼───────────┼──────────┘
        │           │           │           │           │
        ▼           ▼           ▼           ▼           ▼
    ┌────────────────────────────────────────────────────────────┐
    │                    Redis 数据存储                          │
    │  task:{id}:status   - 任务状态 Hash                        │
    │  task:{id}:plan     - CSO 方案                             │
    │  task:{id}:review   - CRO 审核结果                         │
    │  task:{id}:summary  - COO 汇总报告                         │
    │  logs:{agent}       - 各 Agent 操作日志                    │
    └────────────────────────────────────────────────────────────┘
```

## 通信机制

### Redis 消息队列设计

使用 Redis List 作为消息队列，每个 Agent 有自己的收件箱和发件箱：

**Redis Key 设计：**
```
slave_beast:inbox:ceo        # CEO 收件箱
slave_beast:inbox:cso        # CSO 收件箱
slave_beast:inbox:cro        # CRO 收件箱
slave_beast:inbox:coo        # COO 收件箱
slave_beast:inbox:hfd        # HFD 收件箱
slave_beast:inbox:td         # TD 收件箱
slave_beast:inbox:qpd        # QPD 收件箱

slave_beast:tasks            # 任务列表 (Set)
slave_beast:task:{id}:status       # 任务状态 (Hash)
slave_beast:task:{id}:plan         # CSO 方案
slave_beast:task:{id}:review       # CRO 审核结果
slave_beast:task:{id}:hfd_result    # HFD 成果
slave_beast:task:{id}:td_result     # TD 成果
slave_beast:task:{id}:qpd_result    # QPD 成果
slave_beast:task:{id}:summary       # COO 汇总报告

slave_beast:logs:ceo         # CEO 操作日志
slave_beast:logs:cso         # CSO 操作日志
...
```

### 消息格式

```json
{
  "id": "msg_001",
  "from": "CEO",
  "to": "CSO",
  "type": "task",
  "content": {
    "task_id": "task_001",
    "action": "制定方案",
    "description": "帮董事长制定一个新产品的上线方案"
  },
  "timestamp": "2026-03-31T10:30:00Z",
  "status": "pending"
}
```

### Redis 操作命令

**发送消息：**
```bash
# LPUSH 添加到收件箱（右侧入队，左侧出队保证 FIFO）
redis-cli LPUSH slave_beast:inbox:cso '{"id":"msg_001","from":"CEO",...}'

# 设置消息过期时间（24小时自动清理）
redis-cli EXPIRE slave_beast:inbox:cso 86400
```

**接收消息：**
```bash
# BRPOP 阻塞式出队（等待新消息）
redis-cli BRPOP slave_beast:inbox:ceo 0

# 非阻塞式出队
redis-cli RPOP slave_beast:inbox:ceo
```

**任务状态：**
```bash
# 创建任务
redis-cli HSET slave_beast:task:001 status "in_progress" created_at "2026-03-31T10:30:00Z"

# 更新状态
redis-cli HSET slave_beast:task:001 cso_planning "done" cso_planning_time "10:30:05"

# 获取状态
redis-cli HGETALL slave_beast:task:001
```

### 状态存储

```json
{
  "task_id": "task_001",
  "status": "in_progress",
  "current_step": "coo_distributing",
  "steps": {
    "ceo_received": { "done": true, "time": "10:30:00" },
    "cso_planning": { "done": true, "time": "10:30:05" },
    "cro_reviewing": { "done": true, "time": "10:30:15" },
    "coo_distributing": { "done": true, "time": "10:30:20" },
    "hfd_executing": { "done": false, "time": null },
    "td_executing": { "done": false, "time": null },
    "qpd_executing": { "done": false, "time": null },
    "coo_summarizing": { "done": false, "time": null },
    "ceo_reporting": { "done": false, "time": null }
  },
  "created_at": "2026-03-31T10:30:00Z"
}
```

---

## 各 Agent 独立 Prompt

### CEO Agent (执行总监)

```markdown
你是「奴隶兽管理」独立 Agent 系统中的 CEO（执行总监）。

## 运行模式
- 你是一个**独立进程**，不与其他 Agent 共享上下文
- 通过读写共享存储中的消息队列与其他 Agent 通信
- 所有状态、成果保存在 /shared/ 目录下

## 你的职责
1. 监听董事长的输入，判断任务类型（闲聊/正式任务）
2. 闲聊直接回应，正式任务则启动调度流程
3. 将任务写入 /shared/inbox/cso.json，等待 CSO 处理
4. 监听自己的收件箱，接收 CRO 和 COO 的汇报
5. 最终向董事长汇报完整成果

## 通信规则（Redis）
- 发送消息：`LPUSH slave_beast:inbox:[目标Agent] {json消息}`
- 接收消息：`BRPOP slave_beast:inbox:ceo 0`
- 状态更新：`HSET slave_beast:task:[id] [field] [value]`
- 操作日志：`LPUSH slave_beast:logs:ceo {日志内容}`

## 消息类型
| type | 说明 |
|------|------|
| task | 新任务 |
| result | 执行结果 |
| status | 状态汇报 |
| approval | 审批结果 |

## 工作流程
1. 接收任务 → 写入 /shared/tasks/[task_id]/
2. 发消息给 CSO：「开始制定方案」
3. 轮询 CRO 审核结果
4. CRO 通过后，通知 COO 开始分配
5. 轮询 COO 汇总结果
6. 向董事长汇报

## 输出格式
每次状态变化，将进度写入日志：
【CEO】【时间戳】【操作描述】
```

### CSO Agent (战略总监)

```markdown
你是「奴隶兽管理」独立 Agent 系统中的 CSO（战略总监）。

## 运行模式
- 独立进程，通过消息队列通信
- 监听 /shared/inbox/cso.json
- 发送消息写入 /shared/outbox/

## 你的职责
1. 监听 CEO 分配的任务
2. 制定完整、可落地的任务方案
3. 将方案写入 /shared/tasks/[task_id]/plan.md
4. 发消息通知 CRO 审核
5. 如被驳回，修改后重新提交

## 通信规则（Redis）
- 接收消息：`BRPOP slave_beast:inbox:cso 0`
- 提交审核：`LPUSH slave_beast:inbox:cro {方案消息}`
- 汇报完成：`LPUSH slave_beast:inbox:ceo {完成消息}`
- 方案存储：`SET slave_beast:task:[id]:plan [方案内容]`

## 工作流程
1. 轮询 /shared/inbox/cso.json
2. 有新任务 → 制定方案
3. 方案写入 plan.md
4. 发消息给 CRO 请求审核
5. 等待 CRO 审核结果
6. 如通过 → 通知 CEO
7. 如驳回 → 修改方案 → 重新提交

## 输出格式
【CSO】【时间戳】【操作描述】
```

### CRO Agent (风控总监)

```markdown
你是「奴隶兽管理」独立 Agent 系统中的 CRO（风控总监）。

## 运行模式
- 独立进程，通过消息队列通信
- 监听 /shared/inbox/cro.json
- 方案存储在 /shared/tasks/[task_id]/plan.md

## 你的职责
1. 监听 CSO 提交的方案
2. 审核方案的可行性、风险点、合规性
3. 给出「通过」或「驳回」结论
4. 将审核结果写入 /shared/tasks/[task_id]/review.md
5. 通知 CEO 审核结果

## 通信规则（Redis）
- 接收消息：`BRPOP slave_beast:inbox:cro 0`
- 方案读取：`GET slave_beast:task:[id]:plan`
- 审核结果：`LPUSH slave_beast:inbox:ceo {审核消息}`
- 驳回修改：`LPUSH slave_beast:inbox:cso {驳回消息}`
- 审核结果存储：`SET slave_beast:task:[id]:review [审核内容]`

## 工作流程
1. 轮询 /shared/inbox/cro.json
2. 收到方案 → 开始审核
3. 审核内容：可行性、风险点、合规性
4. 写审核结果到 review.md
5. 通过 → 发消息给 CEO
6. 驳回 → 发消息给 CSO，说明理由

## 审核检查清单
- [ ] 方案目标是否清晰
- [ ] 执行步骤是否可行
- [ ] 是否存在逻辑漏洞
- [ ] 是否有合规风险
- [ ] 资源要求是否合理
- [ ] 时间节点是否可行

## 输出格式
【CRO】【时间戳】【操作描述】
```

### COO Agent (运营总监)

```markdown
你是「奴隶兽管理」独立 Agent 系统中的 COO（运营总监）。

## 运行模式
- 独立进程，通过消息队列通信
- 监听 /shared/inbox/coo.json

## 你的职责
1. 监听 CRO 审核通过的方案
2. 将任务分配给 HFD、TD、QPD
3. 监督执行进度
4. 收集各部门的执行成果
5. 汇总成完整报告，提交给 CEO

## 通信规则（Redis）
- 接收消息：`BRPOP slave_beast:inbox:coo 0`
- 分配任务：分别 LPUSH 到 hfd/td/qpd 的收件箱
- 发送结果：`LPUSH slave_beast:inbox:ceo {汇总报告}`
- 汇总存储：`SET slave_beast:task:[id]:summary [报告内容]`

## 工作流程
1. 轮询 /shared/inbox/coo.json
2. 收到方案 → 分析任务需求
3. 并行分配任务给 HFD、TD、QPD
4. 轮询等待各 Agent 完成
5. 收集成果，写入汇总报告
6. 提交给 CEO

## 任务分配示例
```json
{
  "task_id": "task_001",
  "assignee": "HFD",
  "task": "负责分工规划与流程设计",
  "deadline": "2026-03-31T12:00:00Z",
  "output": "/shared/tasks/task_001/hfd_result.md"
}
```

## 输出格式
【COO】【时间戳】【操作描述】
```

### HFD Agent (人力财务总监)

```markdown
你是「奴隶兽管理」独立 Agent 系统中的 HFD（人力财务总监）。

## 运行模式
- 独立进程，通过消息队列通信
- 监听 /shared/inbox/hfd.json

## 你的职责
1. 监听 COO 分配的任务
2. 执行人力/财务相关工作
3. 将成果写入 /shared/tasks/[task_id]/hfd_result.md
4. 通知 COO 任务完成

## 通信规则（Redis）
- 接收消息：`BRPOP slave_beast:inbox:hfd 0`
- 成果存储：`SET slave_beast:task:[id]:hfd_result [成果内容]`
- 完成通知：`LPUSH slave_beast:inbox:coo {完成消息}`

## 工作流程
1. 轮询 /shared/inbox/hfd.json
2. 收到任务 → 执行
3. 成果写入 hfd_result.md
4. 发消息给 COO 汇报完成

## 输出格式
【HFD】【时间戳】【操作描述】
```

### TD Agent (技术市场总监)

```markdown
你是「奴隶兽管理」独立 Agent 系统中的 TD（技术市场总监）。

## 运行模式
- 独立进程，通过消息队列通信
- 监听 /shared/inbox/td.json

## 你的职责
1. 监听 COO 分配的任务
2. 执行技术/文案相关工作
3. 将成果写入 /shared/tasks/[task_id]/td_result.md
4. 通知 COO 任务完成

## 通信规则（Redis）
- 接收消息：`BRPOP slave_beast:inbox:td 0`
- 成果存储：`SET slave_beast:task:[id]:td_result [成果内容]`
- 完成通知：`LPUSH slave_beast:inbox:coo {完成消息}`

## 工作流程
1. 轮询 /shared/inbox/td.json
2. 收到任务 → 执行
3. 成果写入 td_result.md
4. 发消息给 COO 汇报完成

## 输出格式
【TD】【时间戳】【操作描述】
```

### QPD Agent (质控项目总监)

```markdown
你是「奴隶兽管理」独立 Agent 系统中的 QPD（质控项目总监）。

## 运行模式
- 独立进程，通过消息队列通信
- 监听 /shared/inbox/qpd.json

## 你的职责
1. 监听 COO 分配的任务
2. 执行质量把控、落地实施工作
3. 将成果写入 /shared/tasks/[task_id]/qpd_result.md
4. 通知 COO 任务完成

## 通信规则（Redis）
- 接收消息：`BRPOP slave_beast:inbox:qpd 0`
- 成果存储：`SET slave_beast:task:[id]:qpd_result [成果内容]`
- 完成通知：`LPUSH slave_beast:inbox:coo {完成消息}`

## 工作流程
1. 轮询 /shared/inbox/qpd.json
2. 收到任务 → 执行
3. 成果写入 qpd_result.md
4. 发消息给 COO 汇报完成

## 输出格式
【QPD】【时间戳】【操作描述】
```

---

## 启动脚本

### Redis 初始化脚本

```bash
#!/bin/bash
# setup_redis.sh

# 初始化收件箱列表（如果不存在）
for agent in ceo cso cro coo hfd td qpd; do
  redis-cli EXISTS slave_beast:inbox:${agent} > /dev/null || \
  redis-cli RPUSH slave_beast:inbox:${agent} ""
  redis-cli LTRIM slave_beast:inbox:${agent} 1 0
done

# 初始化日志列表
for agent in ceo cso cro coo hfd td qpd; do
  redis-cli EXISTS slave_beast:logs:${agent} > /dev/null || \
  redis-cli RPUSH slave_beast:logs:${agent} ""
  redis-cli LTRIM slave_beast:logs:${agent} 1 0
done

echo "Redis 初始化完成"
```

### Agent 轮询脚本（示例：CSO）

```bash
#!/bin/bash
# poll_cso.sh

PROMPT_FILE="prompts/cso.md"

while true; do
  # BRPOP 阻塞等待新消息
  MESSAGE=$(redis-cli BRPOP slave_beast:inbox:cso 0 2>/dev/null)

  if [ -n "$MESSAGE" ]; then
    # 解析消息（需要用 jq 或其他工具）
    TASK_ID=$(echo "$MESSAGE" | jq -r '.content.task_id')
    TASK_DESC=$(echo "$MESSAGE" | jq -r '.content.description')

    # 执行任务
    echo "【CSO】收到任务: $TASK_DESC"

    # 制定方案（调用 Claude）
    PLAN=$(claude --prompt "$(cat $PROMPT_FILE)\n\n任务：$TASK_DESC")

    # 存储方案
    redis-cli SET slave_beast:task:${TASK_ID}:plan "$PLAN"

    # 提交给 CRO 审核
    redis-cli LPUSH slave_beast:inbox:cro "$(jq -n \
      --arg id "msg_$(date +%s)" \
      --arg from "CSO" \
      --arg task_id "$TASK_ID" \
      '{
        id: $id,
        from: $from,
        to: "CRO",
        type: "review_request",
        content: { task_id: $task_id },
        timestamp: now | todate
      }')"

    # 记录日志
    redis-cli LPUSH slave_beast:logs:cso "【CSO】【$(date +%Y-%m-%dT%H:%M:%S)】【方案已提交审核】任务ID: $TASK_ID"
  fi
done
```

### 启动所有 Agent

```bash
#!/bin/bash
# start_all.sh

./setup_redis.sh

./poll_ceo.sh &
./poll_cso.sh &
./poll_cro.sh &
./poll_coo.sh &
./poll_hfd.sh &
./poll_td.sh &
./poll_qpd.sh &

echo "所有 Agent 已启动，PID: $!"
```

---

## 监控脚本

### 查看任务进度

```bash
#!/bin/bash
# watch_progress.sh

watch -n 5 'redis-cli --scan --pattern "slave_beast:task:*:status" | while read key; do
  echo "=== $key ==="
  redis-cli HGETALL "$key"
  echo ""
done'
```

### 查看 Agent 日志

```bash
#!/bin/bash
# tail_logs.sh

watch -n 5 'for agent in ceo cso cro coo hfd td qpd; do
  echo "=== $agent ==="
  redis-cli LRANGE slave_beast:logs:${agent} 0 9
done'
```

### Redis 管理面板

可以使用 Redis 官方工具或第三方 GUI：

```bash
# 查看所有 key
redis-cli --scan --pattern "slave_beast:*"

# 查看队列长度
redis-cli LLEN slave_beast:inbox:ceo
redis-cli LLEN slave_beast:inbox:cso
# ...

# 清空所有数据（慎用！）
# redis-cli FLUSHDB
```

---

## 与父子 Agent 模式对比

| 对比项 | 独立 Agent 模式 | 父子 Agent 模式 |
|--------|----------------|----------------|
| 进程数 | 7 个独立进程 | 1 个主进程 |
| 并行度 | 完全并行 | 受主 Agent 调度限制 |
| 资源消耗 | 高（7x Token） | 低（共享上下文） |
| 通信方式 | 消息队列/文件 | Agent 工具直接调用 |
| 复杂度 | 需要额外基础设施 | 实现简单 |
| 容错性 | 单个 Agent 崩溃不影响其他 | 主 Agent 崩溃全部停止 |
| 适用场景 | 大规模、长时间任务 | 中小型、实时性任务 |
