"""测试用的替身（fakes），供多个测试模块共享。"""

from mini_agent.app.ports import ModelClient, ModelSettings, SessionStore
from mini_agent.domain.context import Context
from mini_agent.domain.session import Session
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


class MockSessionStore(SessionStore):
    """内存中的会话表。"""

    def __init__(self):
        self.sessions: dict[str, Session] = {}

    def list(self):
        return list(self.sessions.values())

    def save(self, session):
        self.sessions[session.id] = session

    def load(self, session_id):
        return self.sessions[session_id]


class ScriptedModelClient(ModelClient):
    """按顺序吐出预设输出的模型客户端，并记录收到的 context。"""

    def __init__(self, outputs):
        self._outputs = list(outputs)
        self.contexts: list[Context] = []
        self.settings: list[ModelSettings] = []

    def generate[O](self, context: Context[O], model_settings: ModelSettings) -> O:
        self.contexts.append(context)
        self.settings.append(model_settings)
        return self._outputs.pop(0)
