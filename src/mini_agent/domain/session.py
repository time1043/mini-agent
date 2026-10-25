"""Session 聚合：一次对话的消息序列。"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import uuid4


@dataclass(frozen=True)
class ToolCall:
    """模型发起的一次工具调用。"""

    id: str
    tool_name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class UserMessage:
    text: str


@dataclass(frozen=True)
class AssistantMessage:
    text: str
    tool_calls: tuple[ToolCall, ...] = ()


@dataclass(frozen=True)
class ToolResult:
    tool_call_id: str
    content: str


Message = UserMessage | AssistantMessage | ToolResult


@dataclass
class Session:
    id: str
    messages: list[Message] = field(default_factory=list)

    def append(self, message: Message) -> None:
        self.messages.append(message)

    @classmethod
    def new(cls) -> Session:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        return cls(id=f"{stamp}-{uuid4().hex[:4]}")


def message_to_dict(message: Message) -> dict[str, Any]:
    match message:
        case UserMessage(text=text):
            return {"type": "user", "text": text}
        case AssistantMessage(text=text, tool_calls=calls):
            return {
                "type": "assistant",
                "text": text,
                "tool_calls": [
                    {
                        "id": call.id,
                        "tool_name": call.tool_name,
                        "arguments": call.arguments,
                    }
                    for call in calls
                ],
            }
        case ToolResult(tool_call_id=tool_call_id, content=content):
            return {
                "type": "tool_result",
                "tool_call_id": tool_call_id,
                "content": content,
            }
    raise TypeError(f"unknown message: {message!r}")


def message_from_dict(data: dict[str, Any]) -> Message:
    match data["type"]:
        case "user":
            return UserMessage(text=data["text"])
        case "assistant":
            return AssistantMessage(
                text=data["text"],
                tool_calls=tuple(
                    ToolCall(
                        id=call["id"],
                        tool_name=call["tool_name"],
                        arguments=call["arguments"],
                    )
                    for call in data["tool_calls"]
                ),
            )
        case "tool_result":
            return ToolResult(tool_call_id=data["tool_call_id"], content=data["content"])
    raise ValueError(f"unknown message type: {data['type']!r}")
