from mini_agent import agent


def test_run_swallows_eof_and_keyboardinterrupt(monkeypatch, capsys):
    monkeypatch.setattr(agent, "banner", lambda: None)
    monkeypatch.setattr(agent, "prompt", lambda: (_ for _ in ()).throw(EOFError))

    agent.run()

    assert capsys.readouterr().out == "\n"


def test_main_executes_tool_calls_then_stops_on_plain_reply(monkeypatch):
    monkeypatch.setattr(agent, "banner", lambda: None)
    monkeypatch.setattr(agent, "load_api_key", lambda provider: "sk-test")
    answers = iter(["hi", ""])
    monkeypatch.setattr(agent, "prompt", lambda: next(answers))

    replies = iter(
        [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "bash",
                            "arguments": '{"command": "echo hi"}',
                        },
                    },
                ],
            },
            {"role": "assistant", "content": "done"},
        ]
    )
    seen = []
    monkeypatch.setattr(
        agent,
        "read_reply",
        lambda messages, api_key: (seen.append(list(messages)), next(replies))[1],
    )

    executed = []
    monkeypatch.setattr(
        agent,
        "run_bash",
        lambda command: (executed.append(command), "exit_code: 0\n\nhi")[1],
    )

    agent.run()

    assert executed == ["echo hi"]
    assert [m["role"] for m in seen[0]] == ["system", "user"]
    assert [m["role"] for m in seen[1]] == ["system", "user", "assistant", "tool"]
    tool_msg = seen[1][-1]
    assert tool_msg["tool_call_id"] == "call_1"
    assert tool_msg["content"] == "exit_code: 0\n\nhi"
