import subprocess

import pytest

from mini_agent import tools
from mini_agent.tools import run_bash


@pytest.mark.parametrize(
    ("command", "exit_code", "needle"),
    [
        pytest.param("echo hello-from-tool", 0, "hello-from-tool", id="stdout"),
        pytest.param("echo oops >&2", 0, "oops", id="stderr-merged"),
        pytest.param("exit 3", 3, "", id="nonzero-exit"),
    ],
)
def test_run_bash_output(command, exit_code, needle):
    output = run_bash(command)
    assert output.startswith(f"exit_code: {exit_code}")
    if needle:
        assert needle in output


def test_run_bash_reports_timeout(monkeypatch):
    def boom(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="bash", timeout=60)

    monkeypatch.setattr(tools.subprocess, "run", boom)
    assert run_bash("sleep 999") == "命令超时。"
