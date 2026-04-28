from __future__ import annotations

import json
import shutil
import socket
import subprocess
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError
from unittest.mock import patch

from django.test import Client, TestCase, override_settings

from .models import Chat, GeneratedFile, ModelInstallJob, ModelRegistry, RequestLog
from .seed import ensure_defaults
from .services import create_model_file_artifacts, postprocess_assistant_response, stream_llamacpp


class FakeLlamaResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def __iter__(self):
        yield b'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n'
        yield b'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n\n'
        yield b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'


def fake_http_503() -> HTTPError:
    return HTTPError(
        url="http://127.0.0.1:8080/v1/chat/completions",
        code=503,
        msg="Service Unavailable",
        hdrs={},
        fp=None,
    )


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

    def test_model_install_downloads_huggingface_file_by_default(self) -> None:
        model_dir = tempfile.TemporaryDirectory()
        self.addCleanup(model_dir.cleanup)

        def fake_download(repo_id: str, filename: str, local_dir: str) -> str:
            target = Path(local_dir) / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"gguf")
            return str(target)

        login = self.client.post(
            "/api/admin/login",
            data=json.dumps({"password": "1111"}),
            content_type="application/json",
        )
        token = login.json()["token"]

        with override_settings(TTD_MODEL_DIR=Path(model_dir.name), TTD_ALLOW_HF_DOWNLOAD="1"):
            with patch("huggingface_hub.hf_hub_download", side_effect=fake_download):
                response = self.client.post(
                    "/api/models/install",
                    data=json.dumps({
                        "repoId": "owner/model-GGUF",
                        "filename": "model-q4_k_m.gguf",
                        "modelType": "text",
                        "quantization": "Q4_K_M",
                    }),
                    content_type="application/json",
                    HTTP_AUTHORIZATION=f"Bearer {token}",
                )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["model"]["status"], "ready")
        self.assertTrue(Path(payload["model"]["localPath"]).is_file())
        model = ModelRegistry.objects.get(repo_id="owner/model-GGUF", filename="model-q4_k_m.gguf")
        self.assertEqual(model.download_progress, 100)

    def test_model_install_returns_error_when_download_fails(self) -> None:
        model_dir = tempfile.TemporaryDirectory()
        self.addCleanup(model_dir.cleanup)
        login = self.client.post(
            "/api/admin/login",
            data=json.dumps({"password": "1111"}),
            content_type="application/json",
        )
        token = login.json()["token"]

        with override_settings(TTD_MODEL_DIR=Path(model_dir.name), TTD_ALLOW_HF_DOWNLOAD="1"):
            with patch("huggingface_hub.hf_hub_download", side_effect=RuntimeError("not found")):
                response = self.client.post(
                    "/api/models/install",
                    data=json.dumps({
                        "repoId": "owner/broken-GGUF",
                        "filename": "broken-q4_k_m.gguf",
                        "modelType": "text",
                    }),
                    content_type="application/json",
                    HTTP_AUTHORIZATION=f"Bearer {token}",
                )

        self.assertEqual(response.status_code, 502)
        self.assertFalse(response.json()["ok"])
        model = ModelRegistry.objects.get(repo_id="owner/broken-GGUF", filename="broken-q4_k_m.gguf")
        self.assertEqual(model.status, "error")
        self.assertIn("not found", model.local_path)

    def test_model_install_job_downloads_with_real_job_status(self) -> None:
        model_dir = tempfile.TemporaryDirectory()
        self.addCleanup(model_dir.cleanup)
        login = self.client.post(
            "/api/admin/login",
            data=json.dumps({"password": "1111"}),
            content_type="application/json",
        )
        token = login.json()["token"]

        def fake_job_download(job: ModelInstallJob) -> tuple[str, str]:
            target = Path(model_dir.name) / "owner__model-GGUF" / job.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"gguf")
            job.bytes_total = 4
            job.bytes_downloaded = 4
            job.speed_bps = 4
            job.progress = 95
            job.save(update_fields=["bytes_total", "bytes_downloaded", "speed_bps", "progress", "updated_at"])
            return str(target), "4B"

        with override_settings(TTD_MODEL_DIR=Path(model_dir.name), TTD_ALLOW_HF_DOWNLOAD="1"):
            with patch("core.views.download_huggingface_model_for_job", side_effect=fake_job_download):
                response = self.client.post(
                    "/api/models/install-jobs",
                    data=json.dumps({
                        "repoId": "owner/model-GGUF",
                        "filename": "job-q4_k_m.gguf",
                        "modelType": "text",
                        "quantization": "Q4_K_M",
                    }),
                    content_type="application/json",
                    HTTP_AUTHORIZATION=f"Bearer {token}",
                )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["job"]["status"], "ready")
        self.assertEqual(payload["job"]["progress"], 100)
        self.assertEqual(payload["job"]["model"]["status"], "ready")
        self.assertTrue(ModelRegistry.objects.filter(filename="job-q4_k_m.gguf", status="ready").exists())

    def test_model_install_job_can_be_cancelled_and_retried(self) -> None:
        model_dir = tempfile.TemporaryDirectory()
        self.addCleanup(model_dir.cleanup)
        login = self.client.post(
            "/api/admin/login",
            data=json.dumps({"password": "1111"}),
            content_type="application/json",
        )
        token = login.json()["token"]
        job = ModelInstallJob.objects.create(repo_id="owner/model-GGUF", filename="retry-q4_k_m.gguf", status="failed")

        def fake_job_download(next_job: ModelInstallJob) -> tuple[str, str]:
            target = Path(model_dir.name) / next_job.filename
            target.write_bytes(b"gguf")
            return str(target), "4B"

        with override_settings(TTD_MODEL_DIR=Path(model_dir.name)):
            with patch("core.views.download_huggingface_model_for_job", side_effect=fake_job_download):
                retry = self.client.post(
                    f"/api/models/install-jobs/{job.id}/retry",
                    data=json.dumps({}),
                    content_type="application/json",
                    HTTP_AUTHORIZATION=f"Bearer {token}",
                )

        self.assertEqual(retry.status_code, 201)
        self.assertNotEqual(retry.json()["job"]["id"], str(job.id))

    def test_models_collection_syncs_only_existing_local_files(self) -> None:
        model_dir = tempfile.TemporaryDirectory()
        self.addCleanup(model_dir.cleanup)
        real_path = Path(model_dir.name) / "real-q4_k_m.gguf"
        real_path.write_bytes(b"gguf")
        ModelRegistry.objects.create(
            name="fake-ready",
            repo_id="fake/repo",
            filename="missing.gguf",
            status="ready",
            selected=True,
        )

        with override_settings(TTD_MODEL_DIR=Path(model_dir.name)):
            response = self.client.get("/api/models")

        self.assertEqual(response.status_code, 200)
        names = [item["name"] for item in response.json()["models"]]
        self.assertEqual(names, ["real-q4_k_m"])
        self.assertFalse(ModelRegistry.objects.filter(name="fake-ready").exists())
        self.assertTrue(ModelRegistry.objects.get(name="real-q4_k_m").selected)

    def test_model_delete_removes_local_file(self) -> None:
        model_dir = tempfile.TemporaryDirectory()
        self.addCleanup(model_dir.cleanup)
        model_path = Path(model_dir.name) / "delete-me.gguf"
        model_path.write_bytes(b"gguf")
        model = ModelRegistry.objects.create(
            name="delete-me",
            repo_id="local",
            filename="delete-me.gguf",
            status="ready",
            selected=True,
            local_path=str(model_path),
        )
        login = self.client.post(
            "/api/admin/login",
            data=json.dumps({"password": "1111"}),
            content_type="application/json",
        )
        token = login.json()["token"]

        with override_settings(TTD_MODEL_DIR=Path(model_dir.name)):
            response = self.client.post(
                f"/api/models/{model.id}/delete",
                data=json.dumps({}),
                content_type="application/json",
                HTTP_AUTHORIZATION=f"Bearer {token}",
            )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(model_path.exists())
        self.assertFalse(ModelRegistry.objects.filter(id=model.id).exists())

    def test_model_runtime_restart_uses_selected_local_model(self) -> None:
        model_dir = tempfile.TemporaryDirectory()
        self.addCleanup(model_dir.cleanup)
        model_path = Path(model_dir.name) / "runtime.gguf"
        model_path.write_bytes(b"gguf")
        ModelRegistry.objects.create(
            name="runtime",
            repo_id="local",
            filename="runtime.gguf",
            status="ready",
            selected=True,
            local_path=str(model_path),
        )
        login = self.client.post(
            "/api/admin/login",
            data=json.dumps({"password": "1111"}),
            content_type="application/json",
        )
        token = login.json()["token"]

        with override_settings(TTD_MODEL_DIR=Path(model_dir.name)):
            with patch("core.views.restart_llama_server", return_value={"running": True, "selectedModel": "runtime"}) as restart:
                response = self.client.post(
                    "/api/models/restart",
                    data=json.dumps({}),
                    content_type="application/json",
                    HTTP_AUTHORIZATION=f"Bearer {token}",
                )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["runtime"]["running"])
        restart.assert_called_once()

    def test_model_settings_are_saved_from_registry(self) -> None:
        model_path = Path(tempfile.mkdtemp()) / "speed.gguf"
        self.addCleanup(lambda: model_path.parent.exists() and shutil.rmtree(model_path.parent, ignore_errors=True))
        model_path.write_bytes(b"gguf")
        model = ModelRegistry.objects.create(
            name="speed",
            repo_id="local",
            filename="speed.gguf",
            status="ready",
            selected=True,
            local_path=str(model_path),
        )
        login = self.client.post(
            "/api/admin/login",
            data=json.dumps({"password": "1111"}),
            content_type="application/json",
        )
        token = login.json()["token"]

        with patch("core.views.stop_managed_llama") as stop_llama:
            response = self.client.post(
                f"/api/models/{model.id}/settings",
                data=json.dumps({
                    "performance": {
                        "autoSelect": True,
                        "useForInstant": True,
                        "useForExpert": False,
                        "instantContextMessages": 3,
                        "expertContextMessages": 18,
                        "instantMaxTokens": 256,
                        "expertMaxTokens": 4096,
                        "llamaContextSize": 4096,
                        "llamaThreads": 4,
                        "llamaGpuLayers": 12,
                        "promptCacheEnabled": True,
                        "runTests": False,
                        "maxTestFiles": 0,
                    }
                }),
                content_type="application/json",
                HTTP_AUTHORIZATION=f"Bearer {token}",
            )

        self.assertEqual(response.status_code, 200)
        model.refresh_from_db()
        self.assertEqual(model.instant_context_messages, 3)
        self.assertEqual(model.expert_max_tokens, 4096)
        self.assertEqual(model.llama_threads, 4)
        self.assertFalse(model.run_tests)
        self.assertFalse(model.use_for_expert)
        self.assertEqual(response.json()["model"]["performance"]["instantMaxTokens"], 256)
        stop_llama.assert_called_once()

    def test_auto_model_selection_prefers_code_model_for_file_tasks(self) -> None:
        from core.views import choose_response_model

        text = ModelRegistry.objects.create(name="chatty", status="ready", model_type="text", selected=True, quantization="Q4_K_M")
        coder = ModelRegistry.objects.create(name="coder", status="ready", model_type="code", selected=False, quantization="Q4_K_M")

        chosen = choose_response_model("__auto__", "instant", "создай файл app.py с кодом")

        self.assertEqual(chosen, coder)
        self.assertTrue(text.selected)

    def test_root_serves_exported_frontend(self) -> None:
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "chat ui")

    def test_non_api_route_serves_exported_frontend(self) -> None:
        response = self.client.get("/admin-panel")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "panel")

    def test_short_admin_route_serves_admin_panel(self) -> None:
        response = self.client.get("/admin")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "panel")

    def test_exported_static_asset_is_served(self) -> None:
        response = self.client.get("/_next/static/app.js")
        self.assertEqual(response.status_code, 200)
        self.assertIn("javascript", response["Content-Type"])

    def test_missing_frontend_export_auto_builds_once(self) -> None:
        from core import views

        frontend_dir = tempfile.TemporaryDirectory()
        build_dir = tempfile.TemporaryDirectory()
        self.addCleanup(frontend_dir.cleanup)
        self.addCleanup(build_dir.cleanup)
        frontend_path = Path(frontend_dir.name)
        build_path = Path(build_dir.name)
        (frontend_path / "package.json").write_text('{"scripts":{"build":"next build"}}', encoding="utf-8")
        views._FRONTEND_BUILD_ATTEMPTED = False
        views._FRONTEND_BUILD_ERROR = ""

        def fake_build(*args, **kwargs):
            build_path.mkdir(parents=True, exist_ok=True)
            (build_path / "index.html").write_text("<html><body>rebuilt ui</body></html>", encoding="utf-8")
            return subprocess.CompletedProcess(args=args[0], returncode=0, stdout="", stderr="")

        with override_settings(
            TTD_FRONTEND_BUILD_ROOT=build_path,
            TTD_FRONTEND_DIR=frontend_path,
            TTD_AUTO_BUILD_FRONTEND=True,
        ):
            with patch("core.views._find_npm_executable", return_value="/usr/bin/npm"), patch("core.views.subprocess.run", side_effect=fake_build) as build:
                response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "rebuilt ui")
        build.assert_called_once()
        views._FRONTEND_BUILD_ATTEMPTED = False
        views._FRONTEND_BUILD_ERROR = ""

    def test_api_index_explains_backend(self) -> None:
        response = self.client.get("/api")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["health"], "/api/health")

    def test_public_runtime_status_is_safe_for_chat_header(self) -> None:
        response = self.client.get("/api/runtime")
        self.assertEqual(response.status_code, 200)
        runtime = response.json()["runtime"]
        self.assertIn(runtime["state"], {"ready", "loading", "offline"})
        self.assertNotIn("modelPath", runtime)
        self.assertNotIn("logTail", runtime)

    def test_chat_stream_has_no_default_prompt_limit(self) -> None:
        with override_settings(TTD_MAX_PROMPT_CHARS=0):
            response = self.client.post(
                "/api/chat/stream",
                data=json.dumps({"message": "x" * 20000, "model": "deepseek-r1:14b"}),
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 200)
        body = b"".join(response.streaming_content).decode("utf-8")
        self.assertIn("event: done", body)

    def test_workspace_file_diff_rollback_and_zip(self) -> None:
        generated_dir = tempfile.TemporaryDirectory()
        self.addCleanup(generated_dir.cleanup)
        chat = Chat.objects.create(title="workspace")

        with override_settings(TTD_GENERATED_DIR=Path(generated_dir.name)):
            first = self.client.post(
                f"/api/workspaces/{chat.id}/file",
                data=json.dumps({"path": "app.py", "content": "print('one')\n"}),
                content_type="application/json",
            )
            second = self.client.post(
                f"/api/workspaces/{chat.id}/file",
                data=json.dumps({"path": "app.py", "content": "print('two')\n"}),
                content_type="application/json",
            )
            tree = self.client.get(f"/api/workspaces/{chat.id}")
            diff = self.client.get(f"/api/workspaces/{chat.id}/diff?path=app.py")
            test_run = self.client.post(
                f"/api/workspaces/{chat.id}/test",
                data=json.dumps({"path": "app.py"}),
                content_type="application/json",
            )
            tree_after_test = self.client.get(f"/api/workspaces/{chat.id}")
            rollback = self.client.post(
                f"/api/workspaces/{chat.id}/rollback",
                data=json.dumps({"path": "app.py"}),
                content_type="application/json",
            )
            archive = self.client.get(f"/api/workspaces/{chat.id}/zip")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(tree.status_code, 200)
        self.assertEqual(tree.json()["workspace"]["files"][0]["path"], "app.py")
        self.assertEqual(diff.status_code, 200)
        self.assertIn("-print('one')", diff.json()["diff"]["diff"])
        self.assertIn("+print('two')", diff.json()["diff"]["diff"])
        self.assertEqual(test_run.status_code, 200)
        self.assertTrue(test_run.json()["result"]["passed"])
        self.assertFalse((Path(generated_dir.name) / "workspaces" / str(chat.id) / "__pycache__").exists())
        self.assertNotIn("__pycache__", json.dumps(tree_after_test.json()["workspace"]))
        self.assertEqual(rollback.status_code, 200)
        self.assertEqual(rollback.json()["file"]["content"], "print('one')\n")
        self.assertEqual(archive.status_code, 200)
        with zipfile.ZipFile(BytesIO(b"".join(archive.streaming_content))) as zipped:
            self.assertEqual(zipped.namelist(), ["app.py"])

    def test_model_file_artifact_parser_writes_workspace_file(self) -> None:
        generated_dir = tempfile.TemporaryDirectory()
        self.addCleanup(generated_dir.cleanup)
        chat = Chat.objects.create(title="model file")
        response = """Готово.

```ttd-file path="src/app.py"
print('hi')
```
"""

        with override_settings(TTD_GENERATED_DIR=Path(generated_dir.name)):
            artifacts, passed, output, cleaned = create_model_file_artifacts("создай файл app.py", response, str(chat.id))

        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0].name, "src/app.py")
        self.assertEqual(artifacts[0].content, "print('hi')")
        self.assertTrue(Path(artifacts[0].disk_path).is_file())
        self.assertTrue(passed)
        self.assertIn("py_compile", output)
        self.assertIn("Создал файл", cleaned)
        self.assertNotIn("ttd-file", cleaned)

    def test_model_file_artifact_parser_does_not_guess_without_protocol(self) -> None:
        generated_dir = tempfile.TemporaryDirectory()
        self.addCleanup(generated_dir.cleanup)
        chat = Chat.objects.create(title="plain code")
        response = """Вот код:

```python
print('hi')
```
"""

        with override_settings(TTD_GENERATED_DIR=Path(generated_dir.name)):
            artifacts, passed, output, cleaned = create_model_file_artifacts("напиши код", response, str(chat.id))

        self.assertEqual(artifacts, [])
        self.assertIsNone(passed)
        self.assertEqual(output, "")
        self.assertEqual(cleaned, response.strip())

    def test_response_postprocess_marks_truncated_code_for_continue(self) -> None:
        cleaned, needs_continue = postprocess_assistant_response(
            "Ответ\n\n```python\nprint('unterminated')",
            max_tokens=100,
            token_count=95,
        )

        self.assertTrue(cleaned.endswith("```"))
        self.assertTrue(needs_continue)

    def test_llamacpp_file_request_creates_generated_file(self) -> None:
        model_dir = tempfile.TemporaryDirectory()
        generated_dir = tempfile.TemporaryDirectory()
        self.addCleanup(model_dir.cleanup)
        self.addCleanup(generated_dir.cleanup)
        model_path = Path(model_dir.name) / "coder.gguf"
        model_path.write_bytes(b"gguf")
        ModelRegistry.objects.create(
            name="coder",
            repo_id="local",
            filename="coder.gguf",
            status="ready",
            selected=True,
            local_path=str(model_path),
        )

        llama_tokens = iter([
            "Готово.\n\n",
            "```ttd-file path=\"hello.py\"\n",
            "print('hello')\n",
            "```",
        ])
        with override_settings(
            TTD_MODEL_BACKEND="llamacpp",
            TTD_MODEL_DIR=Path(model_dir.name),
            TTD_GENERATED_DIR=Path(generated_dir.name),
        ):
            with patch("core.views.ensure_llama_server"), patch("core.views.stream_llamacpp", return_value=llama_tokens) as stream:
                response = self.client.post(
                    "/api/chat/stream",
                    data=json.dumps({"message": "напиши небольшой скрипт и лучше файлами мне все скинь", "model": "coder"}),
                    content_type="application/json",
                )
                body = b"".join(response.streaming_content).decode("utf-8")

        self.assertEqual(response.status_code, 200)
        self.assertIn("event: done", body)
        self.assertTrue(GeneratedFile.objects.filter(name="hello.py", content__contains="print('hello')").exists())
        self.assertTrue(list((Path(generated_dir.name) / "workspaces").glob("*/hello.py")))
        sent_prompt = stream.call_args.args[0]
        self.assertNotIn("ttd-file", sent_prompt)
        self.assertIn("лучше файлами", sent_prompt)

    def test_admin_import_local_models_and_runtime_maintenance(self) -> None:
        model_dir = tempfile.TemporaryDirectory()
        self.addCleanup(model_dir.cleanup)
        (Path(model_dir.name) / "local-q4_k_m.gguf").write_bytes(b"gguf")
        login = self.client.post(
            "/api/admin/login",
            data=json.dumps({"password": "1111"}),
            content_type="application/json",
        )
        token = login.json()["token"]

        with override_settings(TTD_MODEL_DIR=Path(model_dir.name)):
            imported = self.client.post(
                "/api/models/import-local",
                data=json.dumps({}),
                content_type="application/json",
                HTTP_AUTHORIZATION=f"Bearer {token}",
            )
            disk = self.client.get("/api/admin/disk", HTTP_AUTHORIZATION=f"Bearer {token}")
            logs = self.client.get("/api/admin/logs", HTTP_AUTHORIZATION=f"Bearer {token}")
            cleanup = self.client.post(
                "/api/admin/cleanup",
                data=json.dumps({"days": 7}),
                content_type="application/json",
                HTTP_AUTHORIZATION=f"Bearer {token}",
            )

        self.assertEqual(imported.status_code, 200)
        self.assertEqual(imported.json()["models"][0]["name"], "local-q4_k_m")
        self.assertEqual(disk.status_code, 200)
        self.assertTrue(disk.json()["entries"])
        self.assertEqual(logs.status_code, 200)
        self.assertEqual(cleanup.status_code, 200)

    @patch("urllib.request.urlopen", return_value=FakeLlamaResponse())
    def test_llamacpp_stream_parser(self, _urlopen) -> None:
        with override_settings(TTD_REQUEST_TIMEOUT_SECONDS=777):
            tokens = list(stream_llamacpp("Say hello", "instant", "test-model", "", history=[{"role": "user", "content": "Earlier"}]))
        self.assertEqual("".join(tokens), "Hello world")

        request = _urlopen.call_args.args[0]
        self.assertEqual(_urlopen.call_args.kwargs["timeout"], 777)
        self.assertTrue(request.full_url.endswith("/v1/chat/completions"))
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["messages"][1]["role"], "user")
        self.assertEqual(payload["messages"][1]["content"], "Earlier")
        self.assertEqual(payload["messages"][2]["role"], "user")
        self.assertEqual(payload["messages"][2]["content"], "Say hello")
        self.assertIn("same language", payload["messages"][0]["content"])
        self.assertIn("ttd-file", payload["messages"][0]["content"])
        self.assertNotIn("max_tokens", payload)

    @patch("urllib.request.urlopen", return_value=FakeLlamaResponse())
    def test_llamacpp_stream_can_use_manual_token_cap(self, _urlopen) -> None:
        with override_settings(TTD_LLAMA_CPP_N_PREDICT=4096):
            tokens = list(stream_llamacpp("Say hello", "instant", "test-model", ""))

        self.assertEqual("".join(tokens), "Hello world")
        request = _urlopen.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["max_tokens"], 4096)

    def test_llamacpp_timeout_reports_slow_model(self) -> None:
        with patch("urllib.request.urlopen", side_effect=socket.timeout("timed out")):
            with override_settings(TTD_REQUEST_TIMEOUT_SECONDS=5):
                with self.assertRaisesRegex(RuntimeError, "did not produce a token within 5s"):
                    list(stream_llamacpp("Slow please", "instant", "test-model", ""))

    @patch("time.sleep", return_value=None)
    def test_llamacpp_stream_retries_503_until_ready(self, _sleep) -> None:
        with patch("urllib.request.urlopen", side_effect=[fake_http_503(), FakeLlamaResponse()]) as urlopen:
            with override_settings(TTD_LLAMA_READY_TIMEOUT_SECONDS=10):
                tokens = list(stream_llamacpp("Привет", "instant", "test-model", ""))

        self.assertEqual("".join(tokens), "Hello world")
        self.assertEqual(urlopen.call_count, 2)
