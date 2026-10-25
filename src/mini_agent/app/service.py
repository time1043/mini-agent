"""应用服务：编排会话、模型与工具，实现 agent 主循环。"""

from __future__ import annotations

from collections.abc import Callable

from mini_agent.app.ports import ModelClient, ModelSettings, SessionStore
from mini_agent.domain.roles import Assistant, ToolCallReviewer
from mini_agent.domain.session import Message, Session, ToolCall, ToolResult, UserMessage


class AgentService:
    def __init__(
        self,
        model_client: ModelClient,
        session_store: SessionStore,
        assistant: Assistant,
        reviewer: ToolCallReviewer,
        assistant_model_settings: ModelSettings,
        reviewer_model_settings: ModelSettings,
        max_iterations: int = 8,
    ):
        self.model_client = model_client
        self.session_store = session_store
        self.assistant = assistant
        self.reviewer = reviewer
        self.assistant_model_settings = assistant_model_settings
        self.reviewer_model_settings = reviewer_model_settings
        self.max_iterations = max_iterations

    def new_session(self) -> Session:
        session = Session.new()
        self.session_store.save(session)
        return session

    def list_sessions(self) -> list[Session]:
        return self.session_store.list()

    def chat(
        self,
        session_id: str,
        user_message: str,
        on_message: Callable[[Message], None] | None = None,
    ) -> list[Message]:
        session = self.session_store.load(session_id)
        fresh: list[Message] = []

        def add(message: Message) -> None:
            session.append(message)
            fresh.append(message)
            if on_message:
                on_message(message)

        add(UserMessage(text=user_message))
        for _turn in range(self.max_iterations):
            reply = self.model_client.generate(
                self.assistant.context(session), self.assistant_model_settings
            )
            add(reply)
            if not reply.tool_calls:
                break
            for call in reply.tool_calls:
                add(self._run_reviewed(session, call))
        self.session_store.save(session)
        return fresh

    def _run_reviewed(self, session: Session, call: ToolCall) -> ToolResult:
        decision = self.model_client.generate(
            self.reviewer.context(session, call), self.reviewer_model_settings
        )
        if decision.should_allow:
            content = self._execute(call)
        else:
            content = f"已拒绝：{decision.reason}"
        return ToolResult(tool_call_id=call.id, content=content)

    def _execute(self, call: ToolCall) -> str:
        tool = next((t for t in self.assistant.tools if t.name == call.tool_name), None)
        if tool is None:
            return f"未知工具：{call.tool_name}"
        try:
            return tool.execute(call.arguments)
        except Exception as error:  # noqa: BLE001 -- 工具异常要作为结果回给模型
            return f"工具执行出错：{error}"
