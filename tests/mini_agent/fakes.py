"""测试用的替身（fakes），供多个测试模块共享。"""

from mini_agent.domain.tool import Tool


class FakeTool(Tool):
    name = "fake"
    description = "a fake tool"
    parameters: dict = {}

    def __init__(self, outputs: dict[str, str] | None = None):
        self.calls: list[dict] = []
        self._outputs = outputs or {}

    def execute(self, arguments):
        self.calls.append(arguments)
        return self._outputs.get(arguments.get("query", ""), "fake-output")
