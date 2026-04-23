from __future__ import annotations

import json
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

    @patch("urllib.request.urlopen", return_value=FakeLlamaResponse())
    def test_llamacpp_stream_parser(self, _urlopen) -> None:
        tokens = list(stream_llamacpp("Say hello", "instant", "test-model", ""))
        self.assertEqual("".join(tokens), "Hello world")
