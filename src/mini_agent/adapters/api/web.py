"""Web API 适配器：把 AgentService 暴露为 HTTP 接口。"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from mini_agent.app.service import AgentService
from mini_agent.domain.session import message_to_dict


class ChatIn(BaseModel):
    text: str


def create_app(service: AgentService) -> FastAPI:
    app = FastAPI(title="mini-agent")

    @app.post("/sessions", status_code=201)
    def post_session() -> dict:
        session = service.new_session()
        return {"id": session.id}

    @app.get("/sessions")
    def get_sessions() -> list[dict]:
        return [
            {"id": session.id, "message_count": len(session.messages)}
            for session in service.list_sessions()
        ]

    @app.post("/sessions/{session_id}/messages")
    def post_message(session_id: str, body: ChatIn) -> dict:
        try:
            fresh = service.chat(session_id, body.text)
        except (KeyError, FileNotFoundError):
            raise HTTPException(status_code=404, detail="session not found") from None
        return {"messages": [message_to_dict(m) for m in fresh]}

    return app


class WebApi:
    def __init__(self, service: AgentService):
        self.service = service

    def run(self, host: str = "127.0.0.1", port: int = 8000) -> None:
        import uvicorn

        uvicorn.run(create_app(self.service), host=host, port=port)
