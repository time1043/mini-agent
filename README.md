# mini-agent

跑在终端里的极简 AI 编程助手。你用自然语言提需求，它调用 `bash` 在**当前目录**执行命令来完成。

```
$ mini-agent
>>> 统计一下这个项目有多少行 Python 代码

$ find . -name '*.py' -not -path './.venv/*' | xargs wc -l
exit_code: 0
...
```

## 安装

需要 Python 3.12+。

方式一：直接从 whl 安装（把文件发对方，执行）

```bash
uv tool install ./mini_agent-0.1.0-py3-none-any.whl
# 或
pipx install ./mini_agent-0.1.0-py3-none-any.whl
# 或
pip install ./mini_agent-0.1.0-py3-none-any.whl
```

方式二：从源码安装（需要 uv）

```bash
git clone <repo-url> && cd mini-agent
uv tool install .
```

方式三：不安装，直接从 Git 仓库临时运行

```bash
uvx --from git+<repo-url> mini-agent
```

## 配置

必须提供 DeepSeek API Key，二选一：

```bash
export DEEPSEEK_API_KEY=sk-xxxx          # 推荐
```

或写入 `~/.pi/agent/auth.json`：

```json
{ "deepseek": { "key": "sk-xxxx" } }
```

可选环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MINI_AGENT_MODEL` | `deepseek-flash` | 使用的模型 |
| `MINI_AGENT_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容的接口地址 |

`toilet` 命令是可选的，装了会打印 ASCII 大字 Banner，没装就显示 `MiniAgent`。

## 使用

在任意项目目录下运行：

```bash
cd /path/to/project
mini-agent
# 或：python -m mini_agent
```

- `Ctrl-C` 或 `Ctrl-D` 退出。
- 每条 bash 命令超时 60 秒，标准错误会合并进输出一起回给模型。

> ⚠️ 注意：agent 会直接在你的 shell 中执行模型生成的命令，没有沙箱、没有确认步骤。只在你信任的项目目录里用，最好放在容器或虚拟机里跑。

## 开发

```bash
uv sync
uv run pytest -q
uv run ruff check .
uv build          # 产物在 dist/
```

## License

MIT
