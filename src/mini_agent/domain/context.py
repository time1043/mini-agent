"""Context：一次模型调用所需的全部输入，O 是期望的输出类型。"""

from __future__ import annotations

from dataclasses import dataclass

from mini_agent.domain.session import Message
from mini_agent.domain.tool import Tool


@dataclass(frozen=True)
class Context[O]:
    instruction: str
    output_type: type[O]
    tools: tuple[Tool, ...] = ()
    messages: tuple[Message, ...] = ()
