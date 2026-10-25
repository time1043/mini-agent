import pytest

from mini_agent.domain.tool import Tool


def test_tool_is_abstract():
    with pytest.raises(TypeError):
        Tool()  # type: ignore[abstract]


def test_tool_subclass_declares_name_description_parameters():
    class Echo(Tool):
        name = "echo"
        description = "Return the text back."
        parameters = {"type": "object", "properties": {"text": {"type": "string"}}}

        def execute(self, arguments):
            return arguments["text"]

    assert Echo().execute({"text": "hi"}) == "hi"
