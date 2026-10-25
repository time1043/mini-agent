#!/usr/bin/env python3

import json
import subprocess
from pathlib import Path

from anthropic import Anthropic


def load_api_key(provider, filename="~/.pi/agent/auth.json"):
    auth = json.loads(Path(filename).expanduser().read_text(encoding="utf-8"))
    return auth[provider.casefold()]["key"]


GRAY = "\033[90m"
CYAN = "\033[36m"
RESET = "\033[0m"

SYSTEM_PROMPT = "使用 bash 完成当前目录下的任务。中文回复。"

MODEL = "deepseek-flash"

BASE_URL = "https://api.deepseek.com/anthropic"

MAX_TOKENS = 8192

BASH_TOOL = {
    "name": "bash",
    "description": "在独立、非交互的 bash 进程中执行命令。返回退出码和输出。",
    "input_schema": {
        "type": "object",
        "properties": {"command": {"type": "string"}},
        "required": ["command"],
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


def read_reply(client, messages):
    printing_thinking = False
    with client.messages.stream(
        model=MODEL,
        system=SYSTEM_PROMPT,
        messages=messages,
        tools=[BASH_TOOL],
        max_tokens=MAX_TOKENS,
        thinking={"type": "enabled", "budget_tokens": 4096},
    ) as stream:
        for event in stream:
            if event.type != "content_block_delta":
                continue
            delta = event.delta
            if delta.type == "thinking_delta":
                printing_thinking = True
                print(f"{GRAY}{delta.thinking}{RESET}", end="", flush=True)
            elif delta.type == "text_delta":
                if printing_thinking:
                    print("\n")
                    printing_thinking = False
                print(delta.text, end="", flush=True)
        reply = stream.get_final_message()
    print()
    return reply


def main():
    try:
        subprocess.run(["toilet", "-f", "mono9", "Agent"])
    except FileNotFoundError:
        print("MiniAgent")

    client = Anthropic(
        auth_token=load_api_key("DeepSeek"),
        base_url=BASE_URL,
        timeout=180,
    )
    messages = []

    while user_input := input(f"\n{CYAN}>>> {RESET}").strip():
        print()
        messages.append({"role": "user", "content": user_input})

        while True:
            reply = read_reply(client, messages)
            messages.append({"role": "assistant", "content": reply.content})
            if reply.stop_reason != "tool_use":
                break
            tool_results = []
            for block in reply.content:
                if block.type == "tool_use":
                    output = run_bash(block.input["command"])
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": output,
                        }
                    )
            messages.append({"role": "user", "content": tool_results})


if __name__ == "__main__":
    try:
        main()
    except (EOFError, KeyboardInterrupt):
        print()
