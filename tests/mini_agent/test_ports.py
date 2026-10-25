from fakes import MockSessionStore, ScriptedModelClient
from mini_agent.app.ports import Effort, ModelSettings
from mini_agent.domain.context import Context
from mini_agent.domain.session import Session


def test_model_settings_default_effort_is_off():
    settings = ModelSettings(model_id="m1")
    assert settings.effort is Effort.OFF


def test_mock_store_round_trips_a_session():
    store = MockSessionStore()
    session = Session.new()
    store.save(session)

    assert store.load(session.id) is session
    assert store.list() == [session]


def test_scripted_model_client_records_contexts():
    client = ScriptedModelClient(outputs=["ok"])
    context: Context[str] = Context(instruction="i", output_type=str)

    assert client.generate(context, ModelSettings(model_id="m1")) == "ok"
    assert client.contexts == [context]
