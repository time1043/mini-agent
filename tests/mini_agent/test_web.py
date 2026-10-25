from fastapi.testclient import TestClient

from fakes import FakeTool, MockSessionStore, ScriptedModelClient
from mini_agent.adapters.api.web import create_app
from mini_agent.app.ports import ModelSettings
from mini_agent.app.service import AgentService
from mini_agent.domain.roles import Assistant, Decision, ToolCallReviewer
from mini_agent.domain.session import AssistantMessage, ToolCall


def a_service() -> AgentService:
    call = ToolCall(id="c1", tool_name="fake", arguments={"query": "x"})
    client = ScriptedModelClient(
        [
            AssistantMessage(text="", tool_calls=(call,)),
            Decision(should_allow=True),
            AssistantMessage(text="完成"),
        ]
    )
    store = MockSessionStore()
    return AgentService(
        model_client=client,
        session_store=store,
        assistant=Assistant(instruction="帮我做事", tools=[FakeTool()]),
        reviewer=ToolCallReviewer(instruction="审查"),
        assistant_model_settings=ModelSettings(model_id="m"),
        reviewer_model_settings=ModelSettings(model_id="m"),
    )


def test_post_session_creates_and_returns_id():
    app = create_app(a_service())

    response = TestClient(app).post("/sessions")

    assert response.status_code == 201
    assert set(response.json()) == {"id"}


def test_chat_endpoint_returns_serialized_messages():
    service = a_service()
    client = TestClient(create_app(service))
    session_id = client.post("/sessions").json()["id"]

    response = client.post(f"/sessions/{session_id}/messages", json={"text": "hi"})

    assert response.status_code == 200
    types = [m["type"] for m in response.json()["messages"]]
    assert types == ["user", "assistant", "tool_result", "assistant"]
    (tool_result,) = [m for m in response.json()["messages"] if m["type"] == "tool_result"]
    assert tool_result == {
        "type": "tool_result",
        "tool_call_id": "c1",
        "content": "fake-output",
    }


def test_list_sessions_reports_message_counts():
    client = TestClient(create_app(a_service()))
    session_id = client.post("/sessions").json()["id"]
    client.post(f"/sessions/{session_id}/messages", json={"text": "hi"})

    sessions = client.get("/sessions").json()

    assert {"id": session_id, "message_count": 4} in sessions


def test_chat_unknown_session_returns_404():
    client = TestClient(create_app(a_service()))

    response = client.post("/sessions/missing/messages", json={"text": "hi"})

    assert response.status_code == 404
