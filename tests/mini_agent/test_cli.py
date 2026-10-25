from fakes import FakeTool, MockSessionStore, ScriptedModelClient
from mini_agent.adapters.cli import CliApp
from mini_agent.app.ports import ModelSettings
from mini_agent.app.service import AgentService
from mini_agent.domain.roles import Assistant, Decision, ToolCallReviewer
from mini_agent.domain.session import AssistantMessage, Session, ToolCall
from mini_agent.ui import CYAN, GRAY, RESET

CALL = ToolCall(id="c1", tool_name="fake", arguments={"query": "x"})


def make_app(outputs):
    store = MockSessionStore()
    service = AgentService(
        model_client=ScriptedModelClient(outputs),
        session_store=store,
        assistant=Assistant(instruction="干活", tools=[FakeTool()]),
        reviewer=ToolCallReviewer(instruction="审查"),
        assistant_model_settings=ModelSettings(model_id="m"),
        reviewer_model_settings=ModelSettings(model_id="m"),
    )
    return CliApp(service), store


def scripted_prompt(monkeypatch, answers):
    iterator = iter(answers)
    monkeypatch.setattr("mini_agent.adapters.cli.prompt", lambda: next(iterator))
    monkeypatch.setattr("mini_agent.adapters.cli.banner", lambda: None)


def test_run_chats_until_empty_input(monkeypatch, capsys):
    app, store = make_app([AssistantMessage(text="你好")])
    scripted_prompt(monkeypatch, ["hi", ""])

    app.run()

    out = capsys.readouterr().out
    assert "会话：" in out
    assert "你好" in out
    (session,) = store.list()
    assert [type(m).__name__ for m in session.messages] == ["UserMessage", "AssistantMessage"]


def test_run_prints_tool_calls_and_results_live(monkeypatch, capsys):
    app, _ = make_app(
        [
            AssistantMessage(text="", tool_calls=(CALL,)),
            Decision(should_allow=True),
            AssistantMessage(text="完成"),
        ]
    )
    scripted_prompt(monkeypatch, ["跑一下", ""])

    app.run()

    out = capsys.readouterr().out
    assert f"{CYAN}$ fake {{\"query\": \"x\"}}" in out
    assert f"{GRAY}fake-output{RESET}" in out
    assert "完成" in out


def test_run_resumes_given_session(monkeypatch, capsys):
    app, store = make_app([AssistantMessage(text="接着聊")])
    store.save(Session(id="resume-me"))
    scripted_prompt(monkeypatch, ["hi", ""])

    app.run(session_id="resume-me")

    assert len(store.load("resume-me").messages) == 2
    assert "会话：resume-me" in capsys.readouterr().out


def test_run_swallows_eof(monkeypatch, capsys):
    app, _ = make_app([])

    def raise_eof():
        raise EOFError

    monkeypatch.setattr("mini_agent.adapters.cli.prompt", raise_eof)
    monkeypatch.setattr("mini_agent.adapters.cli.banner", lambda: None)

    app.run()

    assert capsys.readouterr().out.endswith("\n")
