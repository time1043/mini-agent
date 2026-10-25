"""Google Gemini API 客户端。"""

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


class GoogleClient(ModelClient):
    def __init__(self, base_url: str, api_key: str, timeout: int = 180):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def generate[O](self, context: Context[O], model_settings: ModelSettings) -> O:
        payload: dict[str, Any] = {
            "systemInstruction": {
                "parts": [
                    {"text": structured_system(context.instruction, context.output_type)}
                ]
            },
            "contents": self._contents(context.messages),
        }
        if context.tools:
            payload["tools"] = [
                {
                    "functionDeclarations": [
                        {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.parameters,
                        }
                        for tool in context.tools
                    ]
                }
            ]
        if model_settings.effort is not Effort.OFF:
            payload["generationConfig"] = {
                "thinkingConfig": {"thinkingLevel": model_settings.effort.value}
            }

        url = f"{self.base_url}/v1beta/models/{model_settings.model_id}:generateContent"
        response = requests.post(
            url,
            headers={"x-goog-api-key": self.api_key},
            json=payload,
            timeout=self.timeout,
        )
        response.raise_for_status()
        parts = response.json()["candidates"][0]["content"]["parts"]
        return self._output(context.output_type, parts)

    def _contents(self, messages: tuple[Message, ...]) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        tool_names: dict[str, str] = {}  # tool_call_id -> tool_name
        for message in messages:
            match message:
                case UserMessage(text=text):
                    entries.append({"role": "user", "parts": [{"text": text}]})
                case AssistantMessage(text=text, tool_calls=calls):
                    tool_names |= {call.id: call.tool_name for call in calls}
                    parts: list[dict[str, Any]] = []
                    if text:
                        parts.append({"text": text})
                    parts += [
                        {"functionCall": {"name": call.tool_name, "args": call.arguments}}
                        for call in calls
                    ]
                    entries.append({"role": "model", "parts": parts})
                case ToolResult(tool_call_id=tool_call_id, content=content):
                    part = {
                        "functionResponse": {
                            "name": tool_names[tool_call_id],
                            "response": {"result": content},
                        }
                    }
                    # 连续的工具结果合并进一条 user 记录
                    previous = entries[-1] if entries else None
                    if previous and previous["role"] == "user" and all(
                        "functionResponse" in part_ for part_ in previous["parts"]
                    ):
                        previous["parts"].append(part)
                    else:
                        entries.append({"role": "user", "parts": [part]})
        return entries

    def _output[O](self, output_type: type[O], parts: list[dict[str, Any]]) -> O:
        text = "".join(part.get("text", "") for part in parts if "text" in part)
        if output_type is AssistantMessage:
            # Gemini 的 functionCall 不带 id，按出现顺序合成稳定 id
            call_parts = [part for part in parts if "functionCall" in part]
            calls = tuple(
                ToolCall(
                    id=f"call_{index}",
                    tool_name=part["functionCall"]["name"],
                    arguments=dict(part["functionCall"].get("args") or {}),
                )
                for index, part in enumerate(call_parts)
            )
            return AssistantMessage(text=text, tool_calls=calls)
        return parse_structured(text, output_type)
