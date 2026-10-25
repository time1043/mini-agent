"""应用层端口（依赖倒置）：领域只依赖这里的抽象，不依赖具体实现。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import StrEnum

from mini_agent.domain.context import Context
from mini_agent.domain.session import Session


class Effort(StrEnum):
    """推理力度；各模型客户端负责映射到自家的参数。"""

    OFF = "off"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    XHIGH = "xhigh"
    MAX = "max"


@dataclass(frozen=True)
class ModelSettings:
    model_id: str
    effort: Effort = Effort.OFF


class SessionStore(ABC):
    @abstractmethod
    def list(self) -> list[Session]: ...

    @abstractmethod
    def save(self, session: Session) -> None: ...

    @abstractmethod
    def load(self, session_id: str) -> Session: ...


class ModelClient(ABC):
    @abstractmethod
    def generate[O](self, context: Context[O], model_settings: ModelSettings) -> O: ...
