"""OpenAI 兼容客户端（DeepSeek 等同款协议）。"""

from __future__ import annotations

import json
from typing import Any

import requests

from mini_agent.adapters.models.common import parse_structured, structured_system
from mini_agent.app.ports import Effort, ModelClient, ModelSettings
from mini_agent.domain.context import Context
from mini_agent.domain.session import (
    AssistantMessage,
    Message,
    ToolCall,
    ToolResult,
    UserMessage,
)


class OpenAIClient(ModelClient):
    def __init__(self, base_url: str, api_key: str, timeout: int = 180):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def generate[O](self, context: Context[O], model_settings: ModelSettings) -> O:
        payload: dict[str, Any] = {
            "model": model_settings.model_id,
            "messages": self._messages(context),
        }
        if context.tools:
            payload["tools"] = [self._tool_spec(tool) for tool in context.tools]
        if model_settings.effort is not Effort.OFF:
            payload["reasoning_effort"] = model_settings.effort.value

        response = requests.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json=payload,
            timeout=self.timeout,
        )
        response.raise_for_status()
        message = response.json()["choices"][0]["message"]
        return self._output(context.output_type, message)

    def _messages(self, context: Context) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = [
            {
                "role": "system",
                "content": structured_system(context.instruction, context.output_type),
            }
        ]
        entries += [self._entry(message) for message in context.messages]
        return entries

    def _entry(self, message: Message) -> dict[str, Any]:
        match message:
            case UserMessage(text=text):
                return {"role": "user", "content": text}
            case AssistantMessage(text=text, tool_calls=calls):
                entry: dict[str, Any] = {"role": "assistant", "content": text}
                if calls:
                    entry["tool_calls"] = [
                        {
                            "id": call.id,
                            "type": "function",
                            "function": {
                                "name": call.tool_name,
                                "arguments": json.dumps(
                                    call.arguments, ensure_ascii=False
                                ),
                            },
                        }
                        for call in calls
                    ]
                return entry
            case ToolResult(tool_call_id=tool_call_id, content=content):
                return {
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": content,
                }
        raise TypeError(f"unknown message: {message!r}")

    def _tool_spec(self, tool) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        }

    def _output[O](self, output_type: type[O], message: dict[str, Any]) -> O:
        if output_type is AssistantMessage:
            calls = tuple(
                ToolCall(
                    id=fragment["id"],
                    tool_name=fragment["function"]["name"],
                    arguments=json.loads(fragment["function"]["arguments"] or "{}"),
                )
                for fragment in message.get("tool_calls") or []
            )
            return AssistantMessage(
                text=message.get("content") or "", tool_calls=calls
            )
        return parse_structured(message.get("content") or "", output_type)
