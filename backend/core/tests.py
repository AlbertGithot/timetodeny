from __future__ import annotations

import json
from email.message import Message
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


class FakeFrontendResponse:
    def __init__(self, body: bytes, status: int = 200, content_type: str = "text/html; charset=utf-8") -> None:
        self._body = body
        self.status = status
        self.headers = Message()
        self.headers["Content-Type"] = content_type

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def read(self) -> bytes:
        return self._body

    def getcode(self) -> int:
        return self.status


@override_settings(ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"])
class ApiSmokeTests(TestCase):
    def setUp(self) -> None:
        ensure_defaults()
        self.client = Client()

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

    @patch("urllib.request.urlopen", return_value=FakeFrontendResponse(b"<html><body>chat ui</body></html>"))
    def test_root_proxies_frontend(self, _urlopen) -> None:
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "chat ui")

    @patch("urllib.request.urlopen", return_value=FakeFrontendResponse(b"panel", content_type="text/plain"))
    def test_non_api_route_proxies_frontend(self, _urlopen) -> None:
        response = self.client.get("/admin-panel")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"panel")

    def test_api_index_explains_backend(self) -> None:
        response = self.client.get("/api")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["health"], "/api/health")

    @patch("urllib.request.urlopen", return_value=FakeLlamaResponse())
    def test_llamacpp_stream_parser(self, _urlopen) -> None:
        tokens = list(stream_llamacpp("Say hello", "instant", "test-model", ""))
        self.assertEqual("".join(tokens), "Hello world")
