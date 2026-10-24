import io

from mini_agent import ui


def test_prompt_prints_hint_and_strips_input(monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO("  hi there  \n"))

    assert ui.prompt() == "hi there"
    assert ">>>" in capsys.readouterr().out


def test_banner_falls_back_when_toilet_missing(monkeypatch, capsys):
    def boom(*args, **kwargs):
        raise FileNotFoundError

    monkeypatch.setattr(ui.subprocess, "run", boom)

    ui.banner()

    assert "MiniAgent" in capsys.readouterr().out
