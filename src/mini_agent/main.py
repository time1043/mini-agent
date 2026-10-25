"""组合根：选择适配器并装配 AgentService。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from mini_agent.adapters.cli import CliApp
from mini_agent.adapters.models.anthropic_client import AnthropicClient
from mini_agent.adapters.models.google_client import GoogleClient
from mini_agent.adapters.models.openai_client import OpenAIClient
from mini_agent.adapters.stores.jsonl import JsonlSessionStore
from mini_agent.adapters.tools.bash import BashTool
from mini_agent.app.ports import Effort, ModelSettings
from mini_agent.app.service import AgentService
from mini_agent.domain.roles import Assistant, ToolCallReviewer

ASSISTANT_INSTRUCTION = "使用 bash 完成当前目录下的任务。中文回复。"
REVIEWER_INSTRUCTION = "你是工具调用审查员。判断待执行的工具调用是否应该允许执行。"

PROVIDERS = {
    "deepseek": (OpenAIClient, "https://api.deepseek.com", "deepseek-flash"),
    "anthropic": (AnthropicClient, "https://api.anthropic.com", "claude-sonnet-4-5"),
    "google": (GoogleClient, "https://generativelanguage.googleapis.com", "gemini-3-flash"),
}

DEFAULT_STORE = Path("~/.mini-agent/sessions").expanduser()


def load_api_key(provider: str, filename: str = "~/.pi/agent/auth.json") -> str:
    auth = json.loads(Path(filename).expanduser().read_text(encoding="utf-8"))
    return auth[provider.casefold()]["key"]


def build_service(
    provider: str,
    model: str | None = None,
    effort: Effort = Effort.OFF,
    store_root: Path | None = None,
) -> AgentService:
    client_cls, base_url, default_model = PROVIDERS[provider]
    return AgentService(
        model_client=client_cls(base_url=base_url, api_key=load_api_key(provider)),
        session_store=JsonlSessionStore(store_root or DEFAULT_STORE),
        assistant=Assistant(instruction=ASSISTANT_INSTRUCTION, tools=[BashTool()]),
        reviewer=ToolCallReviewer(instruction=REVIEWER_INSTRUCTION),
        assistant_model_settings=ModelSettings(
            model_id=model or default_model, effort=effort
        ),
        reviewer_model_settings=ModelSettings(model_id=model or default_model),
    )


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="mini-agent")
    parser.add_argument("--web", action="store_true", help="启动 Web API 而非 CLI")
    parser.add_argument("--provider", choices=sorted(PROVIDERS), default="deepseek")
    parser.add_argument("--model", help="覆盖该 provider 的默认模型")
    parser.add_argument("--effort", choices=[e.value for e in Effort], default="off")
    parser.add_argument("--session", help="恢复已有会话；缺省时新建")
    parser.add_argument("--store", type=Path, default=DEFAULT_STORE)
    return parser.parse_args(argv)


def run(argv=None) -> None:
    args = parse_args(argv)
    service = build_service(args.provider, args.model, Effort(args.effort), args.store)
    if args.web:
        from mini_agent.adapters.api.web import WebApi

        WebApi(service).run()
    else:
        CliApp(service).run(session_id=args.session)
