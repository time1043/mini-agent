#!/usr/bin/env python3

import json
import subprocess
from pathlib import Path

import requests


def load_api_key(provider, filename="~/.pi/agent/auth.json"):
    auth = json.loads(Path(filename).expanduser().read_text(encoding="utf-8"))
    return auth[provider.casefold()]["key"]


GRAY = "\033[90m"
CYAN = "\033[36m"
RESET = "\033[0m"

SYSTEM_PROMPT = "使用 bash 完成当前目录下的任务。中文回复。"

BASH_TOOL = {
    "type": "function",
    "function": {
        "name": "bash",
        "description": "在独立、非交互的 bash 进程中执行命令。返回退出码和输出。",
        "parameters": {
            "type": "object",
            "properties": {"command": {"type": "string"}},
            "required": ["command"],
        },
    },
}


def run_bash(command):
    print(f"\n{CYAN}$ {command}{RESET}", flush=True)
    try:
        result = subprocess.run(
            ["bash", "-c", command],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            errors="replace",
            timeout=60,
        )
        output = f"exit_code: {result.returncode}\n\n{result.stdout}"
    except subprocess.TimeoutExpired:
        output = "命令超时。"
    print(output, flush=True)
    return output


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
    reply: dict = {"role": "assistant", "content": "", "reasoning_content": ""}
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


def main():
    try:
        subprocess.run(["toilet", "-f", "mono9", "Agent"])
    except FileNotFoundError:
        print("MiniAgent")

    api_key = load_api_key("DeepSeek")
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    while user_input := input(f"\n{CYAN}>>> {RESET}").strip():
        print()
        messages.append({"role": "user", "content": user_input})

        while True:
            reply = read_reply(messages, api_key)
            messages.append(reply)
            if not reply.get("tool_calls"):
                break
            for tool_call in reply["tool_calls"]:
                arguments = json.loads(tool_call["function"]["arguments"])
                output = run_bash(arguments["command"])
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call["id"],
                    "content": output,
                })

if __name__ == "__main__":
    try:
        main()
    except (EOFError, KeyboardInterrupt):
        print()
