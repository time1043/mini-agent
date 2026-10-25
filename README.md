# mini-agent

一个迷你 coding agent：模型循环调用 bash 工具完成任务，工具调用先经审查员把关。
按 DDD 分层组织 —— 领域定义概念，应用编排流程，适配器对接世界。

## 主循环

```python
session = store.load(session_id)
session.append(UserMessage(text))
while turns < MAX_TURNS:
    reply = model.generate(assistant.context(session))   # 询问模型
    session.append(reply)
    if not reply.tool_calls:
        break                                            # 纯文本回复，结束
    for call in reply.tool_calls:
        decision = model.generate(reviewer.context(session, call))  # 审查
        result = run_tool(call) if decision.should_allow else reject(decision)
        session.append(result)                           # 结果回给模型
```

## 结构

```
src/mini_agent/
├── domain/            # 领域层：定义概念，无 IO
│   ├── session.py     #   Session / Message（User | Assistant | ToolResult）/ ToolCall
│   ├── tool.py        #   Tool 抽象
│   ├── context.py     #   Context[O]：一次模型调用的输入
│   └── roles.py       #   Assistant / ToolCallReviewer / Decision
├── app/               # 应用层：端口与编排（依赖倒置）
│   ├── ports.py       #   SessionStore / ModelClient / ModelSettings / Effort
│   └── service.py     #   AgentService：主循环 + 审查门
├── adapters/          # 适配层：具体实现
│   ├── models/        #   OpenAI 兼容（DeepSeek）/ Anthropic / Google 客户端
│   ├── stores/        #   JsonlSessionStore（每会话一个文件）
│   ├── tools/         #   BashTool
│   ├── api/           #   FastAPI WebApi
│   └── cli.py         #   交互式 CliApp
└── main.py            # 组合根：装配依赖、解析参数
```

依赖方向：`adapters → app → domain`， domain 不依赖任何外层。

## 用法

```bash
uv run mini-agent                     # CLI，默认 deepseek
uv run mini-agent --provider anthropic --effort high
uv run mini-agent --session <id>      # 恢复会话
uv run mini-agent --web               # 启动 Web API (127.0.0.1:8000)
```

Web API：

```bash
curl -X POST localhost:8000/sessions
curl localhost:8000/sessions
curl -X POST localhost:8000/sessions/<id>/messages -H 'content-type: application/json' -d '{"text": "hi"}'
```

API key 从 `~/.pi/agent/auth.json` 读取（按 provider 小写名）。

## 测试

```bash
uv run pytest
```

"More Feature"（tree/branch 会话、compact、retry）尚未实现，见方案笔记。
