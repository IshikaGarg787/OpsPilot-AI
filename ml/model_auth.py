"""Shared-token protection for model routes exposed as public demo services."""

from __future__ import annotations

import hmac
import os

from fastapi import Header, HTTPException


def require_model_token(x_model_token: str | None = Header(default=None)) -> None:
    expected = os.getenv("MODEL_API_TOKEN", "").strip()
    if not expected:
        if os.getenv("NODE_ENV") == "production":
            raise HTTPException(status_code=503, detail="Model service authentication is not configured.")
        return
    if not hmac.compare_digest(x_model_token or "", expected):
        raise HTTPException(status_code=401, detail="A valid model service token is required.")
