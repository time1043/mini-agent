from fakes import FakeTool, capture_post
from mini_agent.adapters.models.google_client import GoogleClient
from mini_agent.app.ports import Effort, ModelSettings
from mini_agent.domain.context import Context
from mini_agent.domain.roles import Decision
from mini_agent.domain.session import (
    AssistantMessage,
    ToolCall,
    ToolResult,
    UserMessage,
)


def a_google_client() -> GoogleClient:
    return GoogleClient(
        base_url="https://generativelanguage.googleapis.com", api_key="g-key"
    )


def test_native_reply_maps_function_call(monkeypatch):
    calls = capture_post(
        monkeypatch,
        {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": "查看目录"},
                            {"functionCall": {"name": "bash", "args": {"command": "ls"}}},
                        ]
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

    reply = a_google_client().generate(context, ModelSettings(model_id="gemini-3-flash"))

    assert reply == AssistantMessage(
        text="查看目录",
        tool_calls=(ToolCall(id="call_0", tool_name="bash", arguments={"command": "ls"}),),
    )
    assert (
        calls["url"]
        == "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent"
    )
    assert calls["headers"] == {"x-goog-api-key": "g-key"}
    payload = calls["payload"]
    assert payload["systemInstruction"] == {"parts": [{"text": "干活"}]}
    assert payload["contents"] == [{"role": "user", "parts": [{"text": "hi"}]}]
    assert payload["tools"] == [
        {
            "functionDeclarations": [
                {"name": "fake", "description": "a fake tool", "parameters": {}}
            ]
        }
    ]
    assert "generationConfig" not in payload


def test_tool_result_uses_function_name_from_previous_call(monkeypatch):
    calls = capture_post(
        monkeypatch,
        {
            "candidates": [
                {
                    "content": {
                        "parts": [{"functionCall": {"name": "fake", "args": {}}}]
                    }
                }
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
                tool_calls=(ToolCall(id="c1", tool_name="bash", arguments={"command": "ls"}),),
            ),
            ToolResult(tool_call_id="c1", content="out"),
        ),
    )

    a_google_client().generate(context, ModelSettings(model_id="m"))

    assert calls["payload"]["contents"] == [
        {"role": "user", "parts": [{"text": "hi"}]},
        {
            "role": "model",
            "parts": [{"functionCall": {"name": "bash", "args": {"command": "ls"}}}],
        },
        {
            "role": "user",
            "parts": [
                {"functionResponse": {"name": "bash", "response": {"result": "out"}}}
            ],
        },
    ]


def test_effort_maps_to_thinking_level(monkeypatch):
    calls = capture_post(
        monkeypatch, {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}
    )
    context: Context[AssistantMessage] = Context(
        instruction="干活", output_type=AssistantMessage
    )

    a_google_client().generate(
        context, ModelSettings(model_id="m", effort=Effort.MEDIUM)
    )

    assert calls["payload"]["generationConfig"] == {
        "thinkingConfig": {"thinkingLevel": "medium"}
    }


def test_structured_output_parses_decision(monkeypatch):
    capture_post(
        monkeypatch,
        {
            "candidates": [
                {"content": {"parts": [{"text": '{"should_allow": true, "reason": null}'}]}}
            ]
        },
    )
    context: Context[Decision] = Context(
        instruction="审查", output_type=Decision, messages=(UserMessage(text="call"),)
    )

    decision = a_google_client().generate(context, ModelSettings(model_id="m"))

    assert decision == Decision(should_allow=True, reason=None)
