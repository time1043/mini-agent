"""bash 工具：在独立、非交互的进程中执行命令。"""

from __future__ import annotations

import subprocess
from typing import Any

from mini_agent.domain.tool import Tool


class BashTool(Tool):
    name = "bash"
    description = "在独立、非交互的 bash 进程中执行命令。返回退出码和输出。"
    parameters = {
        "type": "object",
        "properties": {"command": {"type": "string"}},
        "required": ["command"],
    }

    def __init__(self, timeout: int = 60):
        self.timeout = timeout

    def execute(self, arguments: dict[str, Any]) -> str:
        try:
            result = subprocess.run(
                ["bash", "-c", arguments["command"]],
                check=False,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                errors="replace",
                timeout=self.timeout,
            )
            return f"exit_code: {result.returncode}\n\n{result.stdout}"
        except subprocess.TimeoutExpired:
            return "命令超时。"
