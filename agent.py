#!/usr/bin/env python3
import json

from llm import load_api_key, read_reply
from tools import run_bash
from ui import banner, prompt

SYSTEM_PROMPT = "使用 bash 完成当前目录下的任务。中文回复。"


def main():
    banner()

    api_key = load_api_key("DeepSeek")
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    while user_input := prompt():
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
