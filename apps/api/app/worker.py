from __future__ import annotations

from rq import Worker
from redis import Redis

from app.core.config import get_settings


def main() -> None:
    settings = get_settings()
    redis = Redis.from_url(settings.redis_url)
    Worker(["default"], connection=redis).work()


if __name__ == "__main__":
    main()
