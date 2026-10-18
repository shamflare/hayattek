"""Minimal server-side client for the private Orthanc REST API.

Only Django talks to Orthanc. Its URL and credentials come from settings and must never
appear in an API response, a log line or an error message returned to a client.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import urllib3
from django.conf import settings

logger = logging.getLogger(__name__)


class OrthancError(Exception):
    """The image store failed or is unreachable. `code` is safe to persist and show."""

    def __init__(self, code: str, status: int | None = None):
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass
class OrthancConfig:
    url: str
    username: str
    password: str
    timeout: float = 30.0

    @property
    def enabled(self) -> bool:
        return bool(self.url)


def get_config() -> OrthancConfig:
    hayat = settings.HAYAT
    return OrthancConfig(url=(hayat.get("ORTHANC_URL") or "").rstrip("/"),
                         username=hayat.get("ORTHANC_USERNAME", ""),
                         password=hayat.get("ORTHANC_PASSWORD", ""),
                         timeout=float(hayat.get("ORTHANC_TIMEOUT", 30)))


_pools: dict[str, urllib3.PoolManager] = {}


class OrthancClient:
    def __init__(self, config: OrthancConfig | None = None, http: urllib3.PoolManager | None = None):
        self.config = config or get_config()
        if not self.config.enabled:
            raise OrthancError("store_not_configured")
        self.http = http or _pools.setdefault(self.config.url, urllib3.PoolManager(maxsize=8))
        self._auth = urllib3.make_headers(
            basic_auth=f"{self.config.username}:{self.config.password}")

    # ------------------------------------------------------------ transport
    def _request(self, method: str, path: str, *, body: bytes | None = None,
                 headers: dict | None = None, stream: bool = False,
                 fields: dict | None = None):
        url = f"{self.config.url}{path}"
        try:
            response = self.http.request(
                method, url, body=body, fields=fields,
                headers={**self._auth, **(headers or {})},
                timeout=urllib3.Timeout(connect=5.0, read=self.config.timeout),
                preload_content=not stream, retries=False, redirect=False,
            )
        except urllib3.exceptions.HTTPError as exc:
            logger.warning("orthanc unreachable", extra={"error": type(exc).__name__})
            raise OrthancError("store_unreachable") from exc
        if response.status >= 400:
            if stream:
                response.release_conn()
            code = "not_found" if response.status == 404 else "store_error"
            logger.warning("orthanc error", extra={"status": response.status, "path_kind":
                                                   path.split("/")[1] if "/" in path else ""})
            raise OrthancError(code, status=response.status)
        return response

    def get_json(self, path: str, fields: dict | None = None):
        response = self._request("GET", path, fields=fields)
        return json.loads(response.data.decode("utf-8"))

    # ------------------------------------------------------------ operations
    def store_instance(self, payload: bytes) -> dict:
        """POST one DICOM file. Returns {ID, ParentStudy, ParentSeries, ParentPatient, Status}."""
        response = self._request("POST", "/instances", body=payload,
                                 headers={"Content-Type": "application/dicom"})
        data = json.loads(response.data.decode("utf-8"))
        if isinstance(data, list):  # Orthanc answers a list for archives; we never send those
            raise OrthancError("unexpected_response")
        return data

    def study(self, study_id: str) -> dict:
        return self.get_json(f"/studies/{study_id}")

    def series_with_instances(self, series_id: str) -> tuple[dict, list[dict]]:
        series = self.get_json(f"/series/{series_id}")
        instances = self.get_json(f"/series/{series_id}/instances")
        return series, instances

    def delete_study(self, study_id: str) -> None:
        self._request("DELETE", f"/studies/{study_id}")

    def rendered_frame(self, instance_id: str, frame: int, *, accept: str,
                       window_center: float | None = None, window_width: float | None = None,
                       quality: int | None = None):
        """Stream a rendered frame. The caller must close the returned response."""
        fields: dict[str, str] = {}
        if window_center is not None and window_width is not None:
            fields["window-center"] = _num(window_center)
            fields["window-width"] = _num(window_width)
        if quality is not None and accept == "image/jpeg":
            fields["quality"] = str(quality)
        return self._request("GET", f"/instances/{instance_id}/frames/{frame}/rendered",
                             headers={"Accept": accept}, stream=True, fields=fields or None)


def _num(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:.2f}"


def get_client() -> OrthancClient:
    """Indirection point for tests (they substitute an in-memory fake)."""
    return OrthancClient()
