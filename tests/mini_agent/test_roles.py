from fakes import FakeTool
from mini_agent.domain.roles import Assistant, Decision, ToolCallReviewer
from mini_agent.domain.session import Session, ToolCall, UserMessage


def test_assistant_context_is_session_history_with_tools():
    assistant = Assistant(instruction="使用 bash 完成任务", tools=[FakeTool()])
    session = Session(id="s1")
    session.append(UserMessage(text="hi"))

    context = assistant.context(session)

    assert context.instruction == "使用 bash 完成任务"
    assert context.output_type.__name__ == "AssistantMessage"
    assert [tool.name for tool in context.tools] == ["fake"]
    assert context.messages == (UserMessage(text="hi"),)


def test_reviewer_context_describes_the_pending_call():
    reviewer = ToolCallReviewer(instruction="审查工具调用")
    call = ToolCall(id="c1", tool_name="bash", arguments={"command": "ls"})

    context = reviewer.context(Session(id="s1"), call)

    assert context.output_type is Decision
    assert context.tools == ()
    (message,) = context.messages
    assert isinstance(message, UserMessage)
    assert "bash" in message.text
    assert "ls" in message.text
