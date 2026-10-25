import subprocess

import pytest

from mini_agent.adapters.tools.bash import BashTool


@pytest.mark.parametrize(
    ("command", "exit_code", "needle"),
    [
        pytest.param("echo hello-from-tool", 0, "hello-from-tool", id="stdout"),
        pytest.param("echo oops >&2", 0, "oops", id="stderr-merged"),
        pytest.param("exit 3", 3, "", id="nonzero-exit"),
    ],
)
def test_bash_tool_output(command, exit_code, needle):
    output = BashTool().execute({"command": command})
    assert output.startswith(f"exit_code: {exit_code}")
    if needle:
        assert needle in output


def test_bash_tool_reports_timeout(monkeypatch):
    def boom(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="bash", timeout=60)

    monkeypatch.setattr("mini_agent.adapters.tools.bash.subprocess.run", boom)
    assert BashTool().execute({"command": "sleep 999"}) == "命令超时。"


def test_bash_tool_declares_schema_for_the_model():
    tool = BashTool()
    assert tool.name == "bash"
    assert tool.parameters["required"] == ["command"]
