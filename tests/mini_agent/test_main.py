import json

import pytest

from mini_agent import main
from mini_agent.adapters.models.anthropic_client import AnthropicClient
from mini_agent.adapters.models.google_client import GoogleClient
from mini_agent.adapters.models.openai_client import OpenAIClient
from mini_agent.adapters.stores.jsonl import JsonlSessionStore
from mini_agent.adapters.tools.bash import BashTool
from mini_agent.app.ports import Effort


def test_load_api_key_matches_provider_case_insensitively(tmp_path):
    auth = tmp_path / "auth.json"
    auth.write_text(json.dumps({"deepseek": {"key": "sk-test"}}))
    assert main.load_api_key("DeepSeek", filename=str(auth)) == "sk-test"


def test_load_api_key_raises_for_unknown_provider(tmp_path):
    auth = tmp_path / "auth.json"
    auth.write_text(json.dumps({"deepseek": {"key": "sk-test"}}))
    with pytest.raises(KeyError):
        main.load_api_key("openai", filename=str(auth))


def test_build_service_wires_deepseek_by_default(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "load_api_key", lambda provider: "sk-test")

    service = main.build_service("deepseek", store_root=tmp_path)

    assert isinstance(service.model_client, OpenAIClient)
    assert service.model_client.api_key == "sk-test"
    assert isinstance(service.session_store, JsonlSessionStore)
    assert service.session_store.root == tmp_path
    assert service.assistant_model_settings.model_id == "deepseek-flash"
    assert service.assistant_model_settings.effort is Effort.OFF
    tools = service.assistant.tools
    assert [tool.name for tool in tools] == ["bash"]
    assert isinstance(tools[0], BashTool)


@pytest.mark.parametrize(
    ("provider", "client_type", "default_model"),
    [
        pytest.param("anthropic", AnthropicClient, "claude-sonnet-4-5", id="anthropic"),
        pytest.param("google", GoogleClient, "gemini-3-flash", id="google"),
    ],
)
def test_build_service_selects_provider_client(
    monkeypatch, tmp_path, provider, client_type, default_model
):
    monkeypatch.setattr(main, "load_api_key", lambda provider: "sk-test")

    service = main.build_service(provider, store_root=tmp_path)

    assert isinstance(service.model_client, client_type)
    assert service.assistant_model_settings.model_id == default_model


def test_parse_args_defaults():
    args = main.parse_args([])

    assert args.web is False
    assert args.provider == "deepseek"
    assert args.effort == "off"
    assert args.session is None


def test_run_uses_cli_and_passes_session(monkeypatch):
    calls = {}
    monkeypatch.setattr(main, "load_api_key", lambda provider: "sk-test")
    monkeypatch.setattr(
        main,
        "CliApp",
        lambda service: type("FakeCli", (), {"run": lambda self, session_id: calls.update(session_id=session_id)})(),
    )

    main.run(["--session", "abc"])

    assert calls["session_id"] == "abc"


def test_run_web_uses_web_api(monkeypatch):
    calls = {}
    monkeypatch.setattr(main, "load_api_key", lambda provider: "sk-test")

    import mini_agent.adapters.api.web as web_module

    monkeypatch.setattr(
        web_module,
        "WebApi",
        lambda service: type("FakeWeb", (), {"run": lambda self, **kw: calls.update(ran=True)})(),
    )

    main.run(["--web"])

    assert calls["ran"] is True
