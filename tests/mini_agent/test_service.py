import pytest

from fakes import FakeTool, MockSessionStore, ScriptedModelClient
from mini_agent.app.ports import ModelSettings
from mini_agent.app.service import AgentService
from mini_agent.domain.roles import Assistant, Decision, ToolCallReviewer
from mini_agent.domain.session import (
    AssistantMessage,
    Session,
    ToolCall,
    ToolResult,
    UserMessage,
)

CALL = ToolCall(id="c1", tool_name="fake", arguments={"query": "x"})


def make_service(outputs, tool=None, max_iterations=8):
    tool = tool or FakeTool()
    client = ScriptedModelClient(outputs)
    store = MockSessionStore()
    store.save(Session(id="s1"))
    service = AgentService(
        model_client=client,
        session_store=store,
        assistant=Assistant(instruction="帮我做事", tools=[tool]),
        reviewer=ToolCallReviewer(instruction="审查工具调用"),
        assistant_model_settings=ModelSettings(model_id="assistant-model"),
        reviewer_model_settings=ModelSettings(model_id="reviewer-model"),
        max_iterations=max_iterations,
    )
    return service, client, store, tool


def test_chat_plain_reply_ends_loop():
    service, client, store, _ = make_service([AssistantMessage(text="你好")])

    fresh = service.chat("s1", "hi")

    assert fresh == [UserMessage(text="hi"), AssistantMessage(text="你好")]
    assert len(client.contexts) == 1
    assert client.contexts[0].messages == (UserMessage(text="hi"),)
    assert [type(m) for m in store.load("s1").messages] == [UserMessage, AssistantMessage]


def test_chat_runs_reviewed_tool_then_replies():
    outputs = [
        AssistantMessage(text="", tool_calls=(CALL,)),
        Decision(should_allow=True),
        AssistantMessage(text="完成"),
    ]
    service, client, _store, tool = make_service(outputs)

    fresh = service.chat("s1", "跑一下")

    assert tool.calls == [{"query": "x"}]
    assert [type(m) for m in fresh] == [
        UserMessage,
        AssistantMessage,
        ToolResult,
        AssistantMessage,
    ]
    assert fresh[2] == ToolResult(tool_call_id="c1", content="fake-output")
    # 第三次模型调用看到的快照 = 当时的完整历史（用户消息 + 助手调用 + 工具结果）
    assert client.contexts[2].messages == tuple(fresh[:3])
    # 审查调用收到了待审调用
    (pending,) = client.contexts[1].messages
    assert "fake" in pending.text and "x" in pending.text


def test_chat_rejected_tool_call_is_not_executed():
    outputs = [
        AssistantMessage(text="", tool_calls=(CALL,)),
        Decision(should_allow=False, reason="危险命令"),
        AssistantMessage(text="好的"),
    ]
    service, _, _, tool = make_service(outputs)

    fresh = service.chat("s1", "跑一下")

    assert tool.calls == []
    assert fresh[2] == ToolResult(tool_call_id="c1", content="已拒绝：危险命令")


def test_max_iterations_stops_after_last_tool_run():
    outputs = [
        AssistantMessage(text="", tool_calls=(CALL,)),
        Decision(should_allow=True),
    ]
    service, client, _, tool = make_service(outputs, max_iterations=1)

    fresh = service.chat("s1", "跑一下")

    assert [type(m) for m in fresh] == [UserMessage, AssistantMessage, ToolResult]
    assert len(client.contexts) == 2  # 一次助手调用 + 一次审查调用
    assert tool.calls == [{"query": "x"}]


def test_unknown_tool_returns_error_result():
    call = ToolCall(id="c2", tool_name="nope", arguments={})
    outputs = [
        AssistantMessage(text="", tool_calls=(call,)),
        Decision(should_allow=True),
        AssistantMessage(text="!"),
    ]
    service, _, _, _ = make_service(outputs)

    fresh = service.chat("s1", "hi")

    assert fresh[2].content == "未知工具：nope"


def test_tool_exception_becomes_error_result():
    class BoomTool(FakeTool):
        def execute(self, arguments):
            raise RuntimeError("boom")

    outputs = [
        AssistantMessage(text="", tool_calls=(CALL,)),
        Decision(should_allow=True),
        AssistantMessage(text="!"),
    ]
    service, _, _, _ = make_service(outputs, tool=BoomTool())

    fresh = service.chat("s1", "hi")

    assert "工具执行出错" in fresh[2].content
    assert "boom" in fresh[2].content


def test_on_message_callback_sees_every_append():
    outputs = [
        AssistantMessage(text="", tool_calls=(CALL,)),
        Decision(should_allow=True),
        AssistantMessage(text="完成"),
    ]
    service, _, _, _ = make_service(outputs)
    seen = []

    fresh = service.chat("s1", "hi", on_message=seen.append)

    assert seen == fresh


def test_new_session_persists_and_list_delegates():
    service, _, store, _ = make_service([])

    session = service.new_session()

    assert store.load(session.id) is session
    assert session in service.list_sessions()


def test_chat_unknown_session_raises():
    service, _, _, _ = make_service([])

    with pytest.raises(KeyError):
        service.chat("missing", "hi")
