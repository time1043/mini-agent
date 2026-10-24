import pytest

from mini_agent import llm


class FakeSseResponse:
    def __init__(self, lines):
        self._lines = lines

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def raise_for_status(self):
        pass

    def iter_lines(self, chunk_size=1):
        return iter(self._lines)


def test_read_reply_assembles_reasoning_content_and_tool_calls(monkeypatch):
    lines = [
        b": keep-alive",
        b'data: {"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}',
        b'data: {"choices":[{"delta":{"content":null,"reasoning_content":"think"}}]}',
        b'data: {"choices":[{"delta":{"content":"Hi","reasoning_content":""}}]}',
        b'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"bash","arguments":"{\\"command\\": \\"ls\\""}}]}}]}',
        b'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"","function":{"name":"","arguments":"}"}}]}}]}',
        b"data: [DONE]",
    ]
    monkeypatch.setattr(llm.requests, "post", lambda *args, **kwargs: FakeSseResponse(lines))

    reply = llm.read_reply([{"role": "user", "content": "hi"}], "sk-test")

    assert reply["content"] == "Hi"
    assert reply["reasoning_content"] == "think"
    assert reply["tool_calls"] == [
        {
            "id": "c1",
            "type": "function",
            "function": {"name": "bash", "arguments": '{"command": "ls"}'},
        },
    ]


def test_load_api_key_matches_provider_case_insensitively(tmp_path):
    auth = tmp_path / "auth.json"
    auth.write_text('{"deepseek": {"key": "sk-test"}}')
    assert llm.load_api_key("DeepSeek", filename=str(auth)) == "sk-test"


def test_load_api_key_raises_for_unknown_provider(tmp_path):
    auth = tmp_path / "auth.json"
    auth.write_text('{"deepseek": {"key": "sk-test"}}')
    with pytest.raises(KeyError):
        llm.load_api_key("openai", filename=str(auth))
