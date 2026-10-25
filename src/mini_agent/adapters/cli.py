"""CLI 适配器：交互式命令行入口。"""

from __future__ import annotations

import json

from mini_agent.app.service import AgentService
from mini_agent.domain.session import AssistantMessage, Message, ToolResult
from mini_agent.ui import CYAN, GRAY, RESET, banner, prompt


class CliApp:
    def __init__(self, service: AgentService):
        self.service = service

    def run(self, session_id: str | None = None) -> None:
        banner()
        session = (
            self.service.session_store.load(session_id)
            if session_id
            else self.service.new_session()
        )
        print(f"会话：{session.id}")
        try:
            while text := prompt():
                print()
                self.service.chat(session.id, text, on_message=self._show)
        except (EOFError, KeyboardInterrupt):
            print()

    def _show(self, message: Message) -> None:
        match message:
            case AssistantMessage(text=text, tool_calls=calls):
                if text:
                    print(text)
                for call in calls:
                    arguments = json.dumps(call.arguments, ensure_ascii=False)
                    print(f"{CYAN}$ {call.tool_name} {arguments}{RESET}", flush=True)
            case ToolResult(content=content):
                print(f"{GRAY}{content}{RESET}", flush=True)
            case _:
                pass
