import json
from pathlib import Path
from typing import Any

import requests

from tools import BASH_TOOL
from ui import GRAY, RESET


def load_api_key(provider, filename="~/.pi/agent/auth.json"):
    auth = json.loads(Path(filename).expanduser().read_text(encoding="utf-8"))
    return auth[provider.casefold()]["key"]


def stream_deltas(messages, api_key):
    with requests.post(
        "https://api.deepseek.com/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": "deepseek-flash",
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
            tool_call = tool_calls.setdefault(fragment["index"], {
                "id": "",
                "type": "function",
                "function": {"name": "", "arguments": ""},
            })
            tool_call["id"] += fragment.get("id") or ""
            function = fragment.get("function") or {}
            for field in ("name", "arguments"):
                tool_call["function"][field] += function.get(field) or ""

    if tool_calls:
        reply["tool_calls"] = list(tool_calls.values())
    print()
    return reply
