import subprocess

from mini_agent import tools
from mini_agent.tools import run_bash


def test_run_bash_captures_stdout():
    output = run_bash("echo hello-from-tool")
    assert output.startswith("exit_code: 0")
    assert "hello-from-tool" in output


def test_run_bash_reports_nonzero_exit_code():
    assert run_bash("exit 3").startswith("exit_code: 3")


def test_run_bash_merges_stderr_into_output():
    assert "oops" in run_bash("echo oops >&2")


def test_run_bash_reports_timeout(monkeypatch):
    def boom(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="bash", timeout=60)

    monkeypatch.setattr(tools.subprocess, "run", boom)
    assert run_bash("sleep 999") == "命令超时。"
