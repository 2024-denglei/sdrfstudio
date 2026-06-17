from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./sdrf_studio.db"
    redis_url: str = "redis://localhost:6379/0"
    storage_dir: Path = Path("storage")
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"
    openai_model_v4_flash: str = "deepseek-v4-flash"
    ai_chat_base_url: str = "https://api.openai.com/v1/chat/completions"
    ai_chat_timeout_seconds: float = 120
    deepseek_api_key: str = ""
    enable_cloud_ai: bool = False
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    return settings
