# mini-agent

领域驱动设计（DDD）分层的最小 coding agent：对话循环 + 工具调用 + 审查门。

设计说明见笔记《2610-mini-agent》：Procedure → Domain（定义）→ Application（编排）→ Adaptation（实现）→ Compose（装配）。

## 架构

```
src/agent/
├── domain/          # 领域层：纯类型与规则，不依赖任何 I/O
│   ├── json.ts      #   Json 值类型（模型契约与落盘的共同语言）
│   ├── session.ts   #   Session 聚合 + Message 判别联合 + JSON 校验
│   ├── tool.ts      #   Tool 抽象
│   ├── context.ts   #   Context[O] + OutputCodec（对笔记 output_type 的 TS 补齐）
│   └── roles.ts     #   Assistant / ToolCallReviewer / Decision
├── app/             # 应用层：端口（依赖倒置）+ 编排
│   ├── ports.ts     #   SessionStore、ModelClient、ModelSettings、错误类型
│   ├── service.ts   #   AgentService：chat 主循环 + 审查门
│   └── testing.ts   #   测试替身（fakes）
├── adapters/        # 适配层：只依赖端口，不反向依赖
│   ├── models/      #   OpenAI 兼容（DeepSeek）/ Anthropic / Google 客户端
│   ├── stores/      #   JSONL 会话存储（原子写、坏文件容错）
│   ├── tools/       #   Bash 工具（异步、进程组超时、输出截断）
│   ├── api/         #   Web API（node:http，零框架）
│   └── cli/         #   交互式命令行
└── main.ts          # 组合根：全仓库唯一知道具体实现的地方
```

依赖方向单向：`main → adapters → app(ports) → domain`。换存储（如 SQLite）、换模型客户端都不触碰领域与应用层。

## 运行

需要 Node ≥ 24.10（原生 TypeScript type stripping，无 tsx/loader）与 pnpm。

```sh
pnpm install
pnpm dev                      # CLI，provider 默认 deepseek
pnpm dev -- --web             # Web API，监听 127.0.0.1:3000
pnpm dev -- --provider anthropic --effort high
pnpm dev -- --session 20261025-171137-c1cd3d77   # 恢复会话
pnpm test                     # tsc 类型闸门 + node:test 全部用例
```

参数：`--web --provider deepseek|anthropic|google --model --reviewer-model
--effort off|low|medium|high|xhigh|max --reviewer-effort --session --store`。

API key 读自 `~/.pi/agent/auth.json`，形如 `{"DeepSeek": {"key": "..."}}`；
provider 名精确匹配失败后会按小写再试一次。会话默认落在 `~/.mini-agent/sessions/`，
每会话一个 JSONL 文件（首行 `{"version":1,"id":...}`，其后每行一条消息）。

## 关键语义

- **一轮（turn）** = 一次 assistant 调用 + 对其全部 toolCalls 的逐个审查与执行；
  回复不含工具调用即结束；`maxTurns`（默认 8）封顶。
- **审查门 fail-closed**：reviewer 的生成、解析、网络任何失败都按「拒绝」处理；
  `Decision.should_allow` 强校验为 boolean（字符串 `"false"` 不会放行）。
  审查员看得到用户最近的请求与待审调用；可用 `--reviewer-model/--reviewer-effort`
  配置不同的审查模型（安全敏感场景建议与 assistant 分开）。
- **工具错误是文本不是异常**：未知工具、执行异常、参数不合法都变成
  `error: ...` / `审查未通过：...` 的 ToolResult 回给模型，由模型决定下一步。
- **逐条落盘**：每 append 一条消息即原子重写会话文件，模型调用中途失败不丢已产生消息。
- **OutputCodec**：TS 没有运行时反射，笔记里 `Context[O].output_type` 由 codec 补齐——
  `assistant`（原生工具调用）或 `json`（模型只回 JSON，decode 强校验）。

## 已知边界（刻意保持 mini）

- Web 模式假定同一会话串行使用（load→改→save 无并发保护）。
- Bash 工具 stdout/stderr 顺序拼接而非真交错；进程组击杀对脱离进程组的
  daemon 孙进程无效；输出上限 1MB，超出保留头尾各 5KB。
- `Effort` 宽容透传给各家 API，取值域不匹配由上游 4xx 报错，不做本地校验。
- 会话 save 是全量重写（O(n²) 写放大）、`GET /sessions` 全量加载——mini 规模可忍，
  代码中已标注扩展点。
- provider 默认模型沿用 ts/base 的选择（如 deepseek 的 `deepseek-flash`），
  可用 `--model` 覆盖。
