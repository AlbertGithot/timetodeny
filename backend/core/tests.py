from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.test import Client, TestCase, override_settings

from .models import GeneratedFile, RequestLog
from .seed import ensure_defaults
from .services import stream_llamacpp


class FakeLlamaResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def __iter__(self):
        yield b'data: {"content":"Hello","stop":false}\n\n'
        yield b'data: {"content":" world","stop":false}\n\n'
        yield b'data: {"content":"","stop":true}\n\n'


@override_settings(ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"])
class ApiSmokeTests(TestCase):
    def setUp(self) -> None:
        ensure_defaults()
        self.frontend_build_dir = tempfile.TemporaryDirectory()
        build_root = Path(self.frontend_build_dir.name)
        (build_root / "admin-panel").mkdir(parents=True, exist_ok=True)
        (build_root / "_next" / "static").mkdir(parents=True, exist_ok=True)
        (build_root / "index.html").write_text("<html><body>chat ui</body></html>", encoding="utf-8")
        (build_root / "admin-panel" / "index.html").write_text("panel", encoding="utf-8")
        (build_root / "404.html").write_text("missing", encoding="utf-8")
        (build_root / "_next" / "static" / "app.js").write_text("console.log('ok')", encoding="utf-8")
        self.settings_override = override_settings(TTD_FRONTEND_BUILD_ROOT=build_root)
        self.settings_override.enable()
        self.client = Client()

    def tearDown(self) -> None:
        self.settings_override.disable()
        self.frontend_build_dir.cleanup()

    def test_chat_stream_creates_file_and_request_log(self) -> None:
        response = self.client.post(
            "/api/chat/stream",
            data=json.dumps({"message": "создай файл smoke.py", "mode": "expert", "model": "deepseek-r1:14b"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = b"".join(response.streaming_content).decode("utf-8")
        self.assertIn("event: done", body)
        self.assertIn("smoke.py", body)
        self.assertTrue(GeneratedFile.objects.filter(name="smoke.py").exists())
        self.assertEqual(RequestLog.objects.latest("created_at").status, "success")

    def test_admin_token_protects_request_log(self) -> None:
        denied = self.client.get("/api/admin/requests")
        self.assertEqual(denied.status_code, 401)

        login = self.client.post(
            "/api/admin/login",
            data=json.dumps({"password": "1111"}),
            content_type="application/json",
        )
        self.assertEqual(login.status_code, 200)
        token = login.json()["token"]

        allowed = self.client.get("/api/admin/requests", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(allowed.status_code, 200)
        self.assertTrue(allowed.json()["ok"])

    def test_root_serves_exported_frontend(self) -> None:
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "chat ui")

    def test_non_api_route_serves_exported_frontend(self) -> None:
        response = self.client.get("/admin-panel")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "panel")

    def test_exported_static_asset_is_served(self) -> None:
        response = self.client.get("/_next/static/app.js")
        self.assertEqual(response.status_code, 200)
        self.assertIn("javascript", response["Content-Type"])

    def test_api_index_explains_backend(self) -> None:
        response = self.client.get("/api")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["health"], "/api/health")

    @patch("urllib.request.urlopen", return_value=FakeLlamaResponse())
    def test_llamacpp_stream_parser(self, _urlopen) -> None:
        tokens = list(stream_llamacpp("Say hello", "instant", "test-model", ""))
        self.assertEqual("".join(tokens), "Hello world")
