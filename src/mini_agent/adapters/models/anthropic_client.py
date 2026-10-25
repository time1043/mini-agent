"""Anthropic Messages API 客户端。"""

from __future__ import annotations

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


class AnthropicClient(ModelClient):
    def __init__(
        self,
        base_url: str,
        api_key: str,
        max_tokens: int = 4096,
        timeout: int = 180,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.max_tokens = max_tokens
        self.timeout = timeout

    def generate[O](self, context: Context[O], model_settings: ModelSettings) -> O:
        payload: dict[str, Any] = {
            "model": model_settings.model_id,
            "max_tokens": self.max_tokens,
            "system": structured_system(context.instruction, context.output_type),
            "messages": self._messages(context.messages),
        }
        if context.tools:
            payload["tools"] = [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.parameters,
                }
                for tool in context.tools
            ]
        if model_settings.effort is not Effort.OFF:
            payload["output_config"] = {"effort": model_settings.effort.value}

        response = requests.post(
            f"{self.base_url}/v1/messages",
            headers={
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
            },
            json=payload,
            timeout=self.timeout,
        )
        response.raise_for_status()
        return self._output(context.output_type, response.json()["content"])

    def _messages(self, messages: tuple[Message, ...]) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for message in messages:
            match message:
                case UserMessage(text=text):
                    entries.append(
                        {"role": "user", "content": [{"type": "text", "text": text}]}
                    )
                case AssistantMessage(text=text, tool_calls=calls):
                    blocks: list[dict[str, Any]] = []
                    if text:
                        blocks.append({"type": "text", "text": text})
                    blocks += [
                        {
                            "type": "tool_use",
                            "id": call.id,
                            "name": call.tool_name,
                            "input": call.arguments,
                        }
                        for call in calls
                    ]
                    entries.append({"role": "assistant", "content": blocks})
                case ToolResult(tool_call_id=tool_call_id, content=content):
                    # Anthropic 要求角色交替；连续的工具结果合并进一条 user 消息
                    block = {
                        "type": "tool_result",
                        "tool_use_id": tool_call_id,
                        "content": content,
                    }
                    previous = entries[-1] if entries else None
                    if previous and previous["role"] == "user" and all(
                        part["type"] == "tool_result" for part in previous["content"]
                    ):
                        previous["content"].append(block)
                    else:
                        entries.append({"role": "user", "content": [block]})
        return entries

    def _output[O](self, output_type: type[O], content: list[dict[str, Any]]) -> O:
        text = "".join(
            block.get("text", "") for block in content if block["type"] == "text"
        )
        if output_type is AssistantMessage:
            calls = tuple(
                ToolCall(
                    id=block["id"],
                    tool_name=block["name"],
                    arguments=dict(block.get("input") or {}),
                )
                for block in content
                if block["type"] == "tool_use"
            )
            return AssistantMessage(text=text, tool_calls=calls)
        return parse_structured(text, output_type)
