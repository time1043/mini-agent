import pytest

from mini_agent.domain.session import (
    AssistantMessage,
    Session,
    ToolCall,
    ToolResult,
    UserMessage,
    message_from_dict,
    message_to_dict,
)


def test_session_appends_messages_in_order():
    session = Session(id="s1")

    session.append(UserMessage(text="hi"))
    session.append(
        AssistantMessage(
            text="",
            tool_calls=(ToolCall(id="c1", tool_name="bash", arguments={"command": "ls"}),),
        )
    )
    session.append(ToolResult(tool_call_id="c1", content="exit_code: 0\n\n."))

    assert [type(m) for m in session.messages] == [UserMessage, AssistantMessage, ToolResult]


def test_new_session_ids_are_unique_and_named():
    assert Session.new().id != Session.new().id


def test_message_round_trips_through_dict():
    messages: list = [
        UserMessage(text="hi"),
        AssistantMessage(text="thinking"),
        AssistantMessage(
            text="",
            tool_calls=(ToolCall(id="c1", tool_name="bash", arguments={"command": "ls"}),),
        ),
        ToolResult(tool_call_id="c1", content="out"),
    ]
    for message in messages:
        assert message_from_dict(message_to_dict(message)) == message


def test_message_from_dict_rejects_unknown_type():
    with pytest.raises(ValueError):
        message_from_dict({"type": "nope"})
