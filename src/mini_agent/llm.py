import json
import os
from pathlib import Path
from typing import Any

import requests

from mini_agent.tools import BASH_TOOL
from mini_agent.ui import GRAY, RESET

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-flash"


def load_api_key(provider, filename="~/.pi/agent/auth.json"):
    """优先读环境变量 <PROVIDER>_API_KEY，其次读本地 auth.json。"""
    if key := os.environ.get(f"{provider.upper()}_API_KEY"):
        return key

    path = Path(filename).expanduser()
    if path.exists():
        auth = json.loads(path.read_text(encoding="utf-8"))
        if entry := auth.get(provider.casefold()):
            return entry["key"]

    raise SystemExit(
        f"未找到 {provider} 的 API Key。\n"
        f"请设置环境变量 {provider.upper()}_API_KEY，或在 {path} 中配置。"
    )


def stream_deltas(messages, api_key):
    base_url = os.environ.get("MINI_AGENT_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    with requests.post(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": os.environ.get("MINI_AGENT_MODEL", DEFAULT_MODEL),
            "messages": messages,
            "tools": [BASH_TOOL],
            "thinking": {"type": "enabled"},
            "stream": True,
        },
        stream=True,
        timeout=180,
    ) as response:
        response.raise_for_status()
        for line in response.iter_lines(chunk_size=1):
            if not line.startswith(b"data:"):
                continue
            data = line[5:].strip()
            if data == b"[DONE]":
                return
            chunk = json.loads(data)
            if choices := chunk.get("choices"):
                yield choices[0]["delta"]


def read_reply(messages, api_key):
    reply: dict[str, Any] = {"role": "assistant", "content": "", "reasoning_content": ""}
    tool_calls = {}
    for delta in stream_deltas(messages, api_key):
        reasoning = delta.get("reasoning_content") or ""
        content = delta.get("content") or ""

        if reasoning:
            reply["reasoning_content"] += reasoning
            print(f"{GRAY}{reasoning}{RESET}", end="", flush=True)
        if content:
            if not reply["content"] and reply["reasoning_content"]:
                print("\n")
            reply["content"] += content
            print(content, end="", flush=True)

        for fragment in delta.get("tool_calls") or []:
            tool_call = tool_calls.setdefault(
                fragment["index"],
                {
                    "id": "",
                    "type": "function",
                    "function": {"name": "", "arguments": ""},
                },
            )
            tool_call["id"] += fragment.get("id") or ""
            function = fragment.get("function") or {}
            for field in ("name", "arguments"):
                tool_call["function"][field] += function.get(field) or ""

    if tool_calls:
        reply["tool_calls"] = list(tool_calls.values())
    print()
    return reply
