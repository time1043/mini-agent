"""会话的 JSONL 落盘：每个会话一个文件，首行是 id，其后每行一条消息。"""

from __future__ import annotations

import json
from pathlib import Path

from mini_agent.app.ports import SessionStore
from mini_agent.domain.session import Session, message_from_dict, message_to_dict


def dump(session: Session) -> str:
    lines = [json.dumps({"id": session.id}, ensure_ascii=False)]
    lines += [json.dumps(message_to_dict(m), ensure_ascii=False) for m in session.messages]
    return "\n".join(lines) + "\n"


def parse(text: str) -> Session:
    records = [json.loads(line) for line in text.splitlines() if line.strip()]
    session = Session(id=records[0]["id"])
    for record in records[1:]:
        session.append(message_from_dict(record))
    return session


class JsonlSessionStore(SessionStore):
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, session_id: str) -> Path:
        return self.root / f"{session_id}.jsonl"

    def save(self, session: Session) -> None:
        self._path(session.id).write_text(dump(session), encoding="utf-8")

    def load(self, session_id: str) -> Session:
        return parse(self._path(session_id).read_text(encoding="utf-8"))

    def list(self) -> list[Session]:
        return [self.load(path.stem) for path in self.files()]

    def files(self) -> list[Path]:
        return sorted(self.root.glob("*.jsonl"))
