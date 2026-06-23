"""
Application configuration, loaded from environment variables / .env file.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://spad:spad_dev_password@localhost:5432/spad_dev"
    app_env: str = "development"
    app_debug: bool = True
    cors_origins: str = "http://localhost:5173"

    firebase_project_id: str = ""
    firebase_credentials_path: str = ""
    firebase_credentials_json: str = ""
    # Default False so the app, tests, and seed script keep working before
    # a Firebase project exists. Flip to true once real credentials are set
    # (see backend/.env.example and app/core/firebase.py).
    firebase_enabled: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
