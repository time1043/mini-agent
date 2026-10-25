
#!/usr/bin/env python3

import json
import subprocess
from pathlib import Path

from openai import OpenAI


def load_api_key(provider, filename="~/.pi/agent/auth.json"):
    auth = json.loads(Path(filename).expanduser().read_text(encoding="utf-8"))
    return auth[provider.casefold()]["key"]


GRAY = "\033[90m"
CYAN = "\033[36m"
RESET = "\033[0m"

SYSTEM_PROMPT = "使用 bash 完成当前目录下的任务。中文回复。"

MODEL = "deepseek-flash"

BASE_URL = "https://api.deepseek.com"

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


def stream_deltas(client, messages):
    stream = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        tools=[BASH_TOOL],
        extra_body={"thinking": {"type": "enabled"}},
        stream=True,
    )
    for chunk in stream:
        if chunk.choices:
            yield chunk.choices[0].delta


def read_reply(client, messages):
    reply: dict = {"role": "assistant", "content": "", "reasoning_content": ""}
    tool_calls: dict = {}
    for delta in stream_deltas(client, messages):
        reasoning = getattr(delta, "reasoning_content", None) or ""
        content = delta.content or ""

        if reasoning:
            reply["reasoning_content"] += reasoning
            print(f"{GRAY}{reasoning}{RESET}", end="", flush=True)
        if content:
            if not reply["content"] and reply["reasoning_content"]:
                print("\n")
            reply["content"] += content
            print(content, end="", flush=True)

        for fragment in delta.tool_calls or []:
            tool_call = tool_calls.setdefault(fragment.index, {
                "id": "",
                "type": "function",
                "function": {"name": "", "arguments": ""},
            })
            tool_call["id"] += fragment.id or ""
            if fragment.function:
                tool_call["function"]["name"] += fragment.function.name or ""
                tool_call["function"]["arguments"] += fragment.function.arguments or ""

    if tool_calls:
        reply["tool_calls"] = list(tool_calls.values())
    print()
    return reply


def main():
    try:
        subprocess.run(["toilet", "-f", "mono9", "Agent"])
    except FileNotFoundError:
        print("MiniAgent")

    client = OpenAI(
        api_key=load_api_key("DeepSeek"),
        base_url=BASE_URL,
        timeout=180,
    )
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    while user_input := input(f"\n{CYAN}>>> {RESET}").strip():
        print()
        messages.append({"role": "user", "content": user_input})

        while True:
            reply = read_reply(client, messages)
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
