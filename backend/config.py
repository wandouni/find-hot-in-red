import yaml
from dataclasses import dataclass, field
from pathlib import Path

CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"


@dataclass
class LLMConfig:
    provider: str = "openai"
    api_key: str = ""
    api_base: str = ""
    model: str = "gpt-4o"
    vision_model: str = "gpt-4o"


@dataclass
class CrawlerConfig:
    max_notes_per_keyword: int = 30
    top_comments: int = 10
    delay_min_ms: int = 1500
    delay_max_ms: int = 4000


@dataclass
class ServerConfig:
    backend_port: int = 8000
    frontend_port: int = 3000


@dataclass
class Settings:
    llm: LLMConfig = field(default_factory=LLMConfig)
    crawler: CrawlerConfig = field(default_factory=CrawlerConfig)
    server: ServerConfig = field(default_factory=ServerConfig)


def load_settings() -> Settings:
    if not CONFIG_PATH.exists():
        return Settings()
    with open(CONFIG_PATH) as f:
        raw = yaml.safe_load(f) or {}
    return Settings(
        llm=LLMConfig(**raw.get("llm", {})),
        crawler=CrawlerConfig(**raw.get("crawler", {})),
        server=ServerConfig(**raw.get("server", {})),
    )


settings = load_settings()
