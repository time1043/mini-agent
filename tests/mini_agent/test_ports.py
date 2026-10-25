from mini_agent.app.ports import Effort, ModelClient, ModelSettings, SessionStore
from mini_agent.domain.context import Context
from mini_agent.domain.session import Session


class MockSessionStore(SessionStore):
    """测试替身：内存中的会话表。"""

    def __init__(self):
        self.sessions: dict[str, Session] = {}

    def list(self):
        return list(self.sessions.values())

    def save(self, session):
        self.sessions[session.id] = session

    def load(self, session_id):
        return self.sessions[session_id]


class MockModelClient(ModelClient):
    def __init__(self, output):
        self._output = output
        self.contexts: list[Context] = []

    def generate[O](self, context: Context[O], model_settings: ModelSettings) -> O:
        self.contexts.append(context)
        return self._output


def test_model_settings_default_effort_is_off():
    settings = ModelSettings(model_id="m1")
    assert settings.effort is Effort.OFF


def test_mock_store_round_trips_a_session():
    store = MockSessionStore()
    session = Session(id="s1")
    store.save(session)

    assert store.load("s1") is session
    assert store.list() == [session]


def test_mock_model_client_records_contexts():
    client = MockModelClient(output="ok")
    context: Context[str] = Context(instruction="i", output_type=str)

    assert client.generate(context, ModelSettings(model_id="m1")) == "ok"
    assert client.contexts == [context]
