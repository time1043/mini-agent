"""Tool 领域抽象：能力由适配层实现，参数来自模型，输出回给模型。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class Tool(ABC):
    name: str
    description: str
    parameters: dict[str, Any]

    @abstractmethod
    def execute(self, arguments: dict[str, Any]) -> str:
        """执行工具；arguments 来自模型的 ToolCall，返回值成为 ToolResult.content。"""
