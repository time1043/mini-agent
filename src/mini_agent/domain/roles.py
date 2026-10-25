"""角色：向用户回复的 Assistant，与审查工具调用的 ToolCallReviewer。"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass

from mini_agent.domain.context import Context
from mini_agent.domain.session import AssistantMessage, Session, ToolCall, UserMessage
from mini_agent.domain.tool import Tool


@dataclass(frozen=True)
class Decision:
    should_allow: bool
    reason: str | None = None


class Assistant:
    def __init__(self, instruction: str, tools: Sequence[Tool] = ()):
        self.instruction = instruction
        self.tools = tuple(tools)

    def context(self, session: Session) -> Context[AssistantMessage]:
        return Context(
            instruction=self.instruction,
            output_type=AssistantMessage,
            tools=self.tools,
            messages=tuple(session.messages),
        )


class ToolCallReviewer:
    def __init__(self, instruction: str):
        self.instruction = instruction

    def context(self, session: Session, call: ToolCall) -> Context[Decision]:
        del session  # 审查只看调用本身；需要历史时可扩展
        pending = json.dumps(
            {"tool": call.tool_name, "arguments": call.arguments}, ensure_ascii=False
        )
        return Context(
            instruction=self.instruction,
            output_type=Decision,
            messages=(UserMessage(text=pending),),
        )
