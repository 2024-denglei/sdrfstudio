from __future__ import annotations

from typing import Any

import requests
from fastapi import HTTPException

from app.core.config import get_settings


SENSITIVE_CLIENT_PAYLOAD_KEYS = {
    "authorization",
    "api_key",
    "apikey",
    "apiKey",
    "base_url",
    "baseUrl",
    "url",
}


def proxy_chat_completion(payload: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    api_key = settings.openai_api_key or settings.deepseek_api_key
    if not settings.enable_cloud_ai or not api_key:
        raise HTTPException(status_code=503, detail="Cloud AI is not configured on the server.")
    if not isinstance(payload.get("messages"), list):
        raise HTTPException(status_code=400, detail="AI chat payload must include a messages array.")

    upstream_payload = sanitize_client_payload(payload)
    if not upstream_payload.get("model"):
        upstream_payload["model"] = settings.openai_model

    try:
        response = requests.post(
            settings.ai_chat_base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=upstream_payload,
            timeout=settings.ai_chat_timeout_seconds,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"AI provider request failed: {exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"AI provider returned {response.status_code}: {response.text[:1000]}",
        )
    try:
        return response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="AI provider returned invalid JSON.") from exc


def sanitize_client_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in payload.items()
        if key not in SENSITIVE_CLIENT_PAYLOAD_KEYS
    }
