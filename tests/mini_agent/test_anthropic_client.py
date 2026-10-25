from fakes import FakeTool, capture_post
from mini_agent.adapters.models.anthropic_client import AnthropicClient
from mini_agent.app.ports import Effort, ModelSettings
from mini_agent.domain.context import Context
from mini_agent.domain.roles import Decision
from mini_agent.domain.session import (
    AssistantMessage,
    ToolCall,
    ToolResult,
    UserMessage,
)


def an_anthropic_client() -> AnthropicClient:
    return AnthropicClient(base_url="https://api.anthropic.com", api_key="sk-ant")


def test_native_reply_maps_blocks_to_tool_calls(monkeypatch):
    calls = capture_post(
        monkeypatch,
        {
            "content": [
                {"type": "text", "text": "我来查看目录"},
                {
                    "type": "tool_use",
                    "id": "toolu_1",
                    "name": "bash",
                    "input": {"command": "ls"},
                },
            ]
        },
    )
    context: Context[AssistantMessage] = Context(
        instruction="干活",
        output_type=AssistantMessage,
        tools=(FakeTool(),),
        messages=(UserMessage(text="hi"),),
    )

    reply = an_anthropic_client().generate(
        context, ModelSettings(model_id="claude-sonnet-4-5")
    )

    assert reply == AssistantMessage(
        text="我来查看目录",
        tool_calls=(ToolCall(id="toolu_1", tool_name="bash", arguments={"command": "ls"}),),
    )
    assert calls["url"] == "https://api.anthropic.com/v1/messages"
    assert calls["headers"]["x-api-key"] == "sk-ant"
    assert calls["headers"]["anthropic-version"] == "2023-06-01"
    payload = calls["payload"]
    assert payload["model"] == "claude-sonnet-4-5"
    assert payload["max_tokens"] == 4096
    assert payload["system"] == "干活"
    assert payload["messages"] == [
        {"role": "user", "content": [{"type": "text", "text": "hi"}]}
    ]
    assert payload["tools"] == [
        {"name": "fake", "description": "a fake tool", "input_schema": {}}
    ]
    assert "output_config" not in payload


def test_history_merges_consecutive_tool_results(monkeypatch):
    calls = capture_post(
        monkeypatch,
        {
            "content": [
                {"type": "tool_use", "id": "t2", "name": "fake", "input": {}}
            ]
        },
    )
    context: Context[AssistantMessage] = Context(
        instruction="干活",
        output_type=AssistantMessage,
        tools=(FakeTool(),),
        messages=(
            UserMessage(text="hi"),
            AssistantMessage(
                text="",
                tool_calls=(
                    ToolCall(id="t1", tool_name="fake", arguments={"query": "a"}),
                    ToolCall(id="t2", tool_name="fake", arguments={"query": "b"}),
                ),
            ),
            ToolResult(tool_call_id="t1", content="out-1"),
            ToolResult(tool_call_id="t2", content="out-2"),
        ),
    )

    an_anthropic_client().generate(context, ModelSettings(model_id="m"))

    assert calls["payload"]["messages"] == [
        {"role": "user", "content": [{"type": "text", "text": "hi"}]},
        {
            "role": "assistant",
            "content": [
                {
                    "type": "tool_use",
                    "id": "t1",
                    "name": "fake",
                    "input": {"query": "a"},
                },
                {
                    "type": "tool_use",
                    "id": "t2",
                    "name": "fake",
                    "input": {"query": "b"},
                },
            ],
        },
        {
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "t1", "content": "out-1"},
                {"type": "tool_result", "tool_use_id": "t2", "content": "out-2"},
            ],
        },
    ]


def test_effort_maps_to_output_config(monkeypatch):
    calls = capture_post(monkeypatch, {"content": [{"type": "text", "text": "ok"}]})
    context: Context[AssistantMessage] = Context(
        instruction="干活", output_type=AssistantMessage
    )

    an_anthropic_client().generate(
        context, ModelSettings(model_id="m", effort=Effort.HIGH)
    )

    assert calls["payload"]["output_config"] == {"effort": "high"}


def test_structured_output_parses_decision(monkeypatch):
    capture_post(
        monkeypatch,
        {"content": [{"type": "text", "text": '{"should_allow": false, "reason": "危险"}'}]},
    )
    context: Context[Decision] = Context(
        instruction="审查", output_type=Decision, messages=(UserMessage(text="call"),)
    )

    decision = an_anthropic_client().generate(context, ModelSettings(model_id="m"))

    assert decision == Decision(should_allow=False, reason="危险")
