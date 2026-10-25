"""模型客户端共享逻辑：结构化输出的提示与解析。"""

from __future__ import annotations

import json
import re
from dataclasses import is_dataclass
from typing import Any, Union, get_args, get_origin, get_type_hints

from mini_agent.domain.session import AssistantMessage

_UNION_ORIGINS = {Union}
try:
    from types import UnionType

    _UNION_ORIGINS.add(UnionType)
except ImportError:  # pragma: no cover
    pass

_JSON_NAMES: dict[type, str] = {
    bool: "boolean",
    int: "number",
    float: "number",
    str: "string",
    list: "array",
    dict: "object",
}


def _describe(annotation: Any) -> str:
    if annotation in _JSON_NAMES:
        return _JSON_NAMES[annotation]
    origin = get_origin(annotation)
    if origin in _UNION_ORIGINS:
        args = [a for a in get_args(annotation) if a is not type(None)]
        return " | ".join([_describe(a) for a in args] + ["null"])
    return "unknown"


def structured_system(instruction: str, output_type: type) -> str:
    """AssistantMessage 是原生输出；其余输出类型要求模型只回 JSON。"""
    if output_type is AssistantMessage or not is_dataclass(output_type):
        return instruction
    hints = get_type_hints(output_type)
    shape = {
        name: _describe(hints[name]) for name in output_type.__dataclass_fields__
    }
    hint = json.dumps(shape, ensure_ascii=False)
    return f"{instruction}\n\n只输出一个 JSON 对象，不要包含其他文字，字段：{hint}"


def extract_json(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```[a-zA-Z]*\n?", "", stripped)
        stripped = re.sub(r"\n?```\s*$", "", stripped)
    start, end = stripped.find("{"), stripped.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"model output has no JSON object: {text!r}")
    return json.loads(stripped[start : end + 1])


def parse_structured[O](text: str, output_type: type[O]) -> O:
    data = extract_json(text)
    return output_type(**data)
