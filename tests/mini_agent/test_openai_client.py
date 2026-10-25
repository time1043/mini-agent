from fakes import FakeTool, capture_post
from mini_agent.adapters.models.openai_client import OpenAIClient
from mini_agent.app.ports import Effort, ModelSettings
from mini_agent.domain.context import Context
from mini_agent.domain.roles import Decision
from mini_agent.domain.session import (
    AssistantMessage,
    ToolCall,
    ToolResult,
    UserMessage,
)


def an_openai_client() -> OpenAIClient:
    return OpenAIClient(base_url="https://api.deepseek.com", api_key="sk-test")


def test_native_reply_maps_tool_calls(monkeypatch):
    calls = capture_post(
        monkeypatch,
        {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "id": "c1",
                                "type": "function",
                                "function": {
                                    "name": "bash",
                                    "arguments": '{"command": "ls"}',
                                },
                            }
                        ],
                    }
                }
            ]
        },
    )
    context: Context[AssistantMessage] = Context(
        instruction="干活",
        output_type=AssistantMessage,
        tools=(FakeTool(),),
        messages=(UserMessage(text="hi"),),
    )

    reply = an_openai_client().generate(
        context, ModelSettings(model_id="deepseek-flash")
    )

    assert reply == AssistantMessage(
        text="",
        tool_calls=(ToolCall(id="c1", tool_name="bash", arguments={"command": "ls"}),),
    )
    assert calls["url"] == "https://api.deepseek.com/chat/completions"
    assert calls["headers"] == {"Authorization": "Bearer sk-test"}
    assert calls["payload"]["model"] == "deepseek-flash"
    assert calls["payload"]["messages"][0] == {"role": "system", "content": "干活"}
    assert calls["payload"]["messages"][1] == {"role": "user", "content": "hi"}
    assert calls["payload"]["tools"] == [
        {
            "type": "function",
            "function": {
                "name": "fake",
                "description": "a fake tool",
                "parameters": {},
            },
        }
    ]
    assert "reasoning_effort" not in calls["payload"]


def test_history_maps_assistant_calls_and_tool_results(monkeypatch):
    calls = capture_post(
        monkeypatch, {"choices": [{"message": {"content": "ok"}}]}
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
                    ToolCall(id="c1", tool_name="bash", arguments={"command": "ls"}),
                ),
            ),
            ToolResult(tool_call_id="c1", content="out"),
        ),
    )

    an_openai_client().generate(context, ModelSettings(model_id="m"))

    assert calls["payload"]["messages"] == [
        {"role": "system", "content": "干活"},
        {"role": "user", "content": "hi"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "c1",
                    "type": "function",
                    "function": {"name": "bash", "arguments": '{"command": "ls"}'},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "c1", "content": "out"},
    ]


def test_effort_maps_to_reasoning_effort(monkeypatch):
    calls = capture_post(monkeypatch, {"choices": [{"message": {"content": "ok"}}]})
    context: Context[AssistantMessage] = Context(
        instruction="干活", output_type=AssistantMessage
    )

    an_openai_client().generate(
        context, ModelSettings(model_id="m", effort=Effort.HIGH)
    )

    assert calls["payload"]["reasoning_effort"] == "high"


def test_structured_output_parses_decision(monkeypatch):
    calls = capture_post(
        monkeypatch,
        {
            "choices": [
                {
                    "message": {
                        "content": '```json\n{"should_allow": true, "reason": null}\n```'
                    }
                }
            ]
        },
    )
    context: Context[Decision] = Context(
        instruction="审查", output_type=Decision, messages=(UserMessage(text="call"),)
    )

    decision = an_openai_client().generate(context, ModelSettings(model_id="m"))

    assert decision == Decision(should_allow=True, reason=None)
    assert "tools" not in calls["payload"]
    assert "should_allow" in calls["payload"]["messages"][0]["content"]
