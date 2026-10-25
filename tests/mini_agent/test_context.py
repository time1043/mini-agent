import dataclasses

import pytest

from mini_agent.domain.context import Context
from mini_agent.domain.session import (
    AssistantMessage,
    Session,
    ToolCall,
    UserMessage,
)
from mini_agent.domain.tool import Tool


class FakeTool(Tool):
    name = "fake"
    description = "a fake tool"
    parameters: dict = {}

    def execute(self, arguments):
        return ""


def test_assistant_context_carries_instruction_tools_and_history():
    session = Session(id="s1")
    session.append(UserMessage(text="hi"))
    session.append(
        AssistantMessage(
            text="",
            tool_calls=(ToolCall(id="c1", tool_name="fake", arguments={}),),
        )
    )
    tool = FakeTool()

    context: Context[AssistantMessage] = Context(
        instruction="reply as assistant",
        output_type=AssistantMessage,
        tools=(tool,),
        messages=tuple(session.messages),
    )

    assert context.instruction == "reply as assistant"
    assert context.output_type is AssistantMessage
    assert context.tools == (tool,)
    assert context.messages == tuple(session.messages)


def test_context_is_immutable():
    context: Context[str] = Context(instruction="i", output_type=str)
    with pytest.raises(dataclasses.FrozenInstanceError):
        context.instruction = "other"  # type: ignore[misc]
