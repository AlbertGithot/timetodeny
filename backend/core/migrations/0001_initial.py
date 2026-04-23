# Generated for Time To Deny backend.
import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="AdminSetting",
            fields=[
                ("key", models.CharField(max_length=120, primary_key=True, serialize=False)),
                ("value", models.TextField()),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name="AdminSession",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("token", models.CharField(max_length=128, unique=True)),
                ("ip", models.GenericIPAddressField(blank=True, null=True)),
                ("user_agent", models.TextField(blank=True)),
                ("login_time", models.DateTimeField(auto_now_add=True)),
                ("logout_time", models.DateTimeField(blank=True, null=True)),
                ("status", models.CharField(choices=[("active", "Active"), ("ended", "Ended")], default="active", max_length=16)),
            ],
            options={"ordering": ["-login_time"]},
        ),
        migrations.CreateModel(
            name="Chat",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(default="New conversation", max_length=200)),
                ("mode", models.CharField(default="instant", max_length=16)),
                ("active_model", models.CharField(default="local-assistant", max_length=160)),
            ],
            options={"ordering": ["-updated_at"]},
        ),
        migrations.CreateModel(
            name="ModelRegistry",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=180)),
                ("repo_id", models.CharField(blank=True, max_length=255)),
                ("filename", models.CharField(blank=True, max_length=255)),
                ("model_type", models.CharField(choices=[("text", "Text"), ("vision", "Vision"), ("code", "Code")], default="text", max_length=20)),
                ("size", models.CharField(default="-", max_length=64)),
                ("status", models.CharField(choices=[("ready", "Ready"), ("loading", "Loading"), ("downloading", "Downloading"), ("error", "Error"), ("unloaded", "Unloaded")], default="unloaded", max_length=20)),
                ("vram", models.CharField(default="-", max_length=64)),
                ("selected", models.BooleanField(default=False)),
                ("hidden", models.BooleanField(default=False)),
                ("system_prompt", models.TextField(blank=True)),
                ("quantization", models.CharField(default="Q4_K_M", max_length=64)),
                ("download_progress", models.PositiveSmallIntegerField(default=0)),
                ("local_path", models.CharField(blank=True, max_length=500)),
            ],
            options={"ordering": ["-selected", "hidden", "name"]},
        ),
        migrations.CreateModel(
            name="Message",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("role", models.CharField(choices=[("system", "System"), ("user", "User"), ("assistant", "Assistant")], max_length=16)),
                ("content", models.TextField(blank=True)),
                ("thinking", models.TextField(blank=True)),
                ("tokens_per_sec", models.FloatField(blank=True, null=True)),
                ("total_tokens", models.PositiveIntegerField(default=0)),
                ("test_passed", models.BooleanField(blank=True, null=True)),
                ("test_output", models.TextField(blank=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("chat", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="messages", to="core.chat")),
            ],
            options={"ordering": ["created_at"]},
        ),
        migrations.CreateModel(
            name="RequestLog",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("ip", models.GenericIPAddressField(blank=True, null=True)),
                ("user_agent", models.TextField(blank=True)),
                ("model", models.CharField(blank=True, max_length=160)),
                ("mode", models.CharField(default="instant", max_length=16)),
                ("query", models.TextField(blank=True)),
                ("response", models.TextField(blank=True)),
                ("status", models.CharField(choices=[("success", "Success"), ("error", "Error"), ("timeout", "Timeout"), ("streaming", "Streaming")], default="streaming", max_length=16)),
                ("latency_ms", models.PositiveIntegerField(default=0)),
                ("tokens", models.PositiveIntegerField(default=0)),
                ("error_details", models.TextField(blank=True)),
                ("chat", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="request_logs", to="core.chat")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="GeneratedFile",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=255)),
                ("language", models.CharField(blank=True, max_length=80)),
                ("content", models.TextField()),
                ("file_type", models.CharField(choices=[("code", "Code"), ("text", "Text"), ("image_url", "Image URL")], default="text", max_length=24)),
                ("disk_path", models.CharField(blank=True, max_length=500)),
                ("message", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="generated_files", to="core.message")),
            ],
        ),
        migrations.CreateModel(
            name="Attachment",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=255)),
                ("file_type", models.CharField(default="file", max_length=24)),
                ("size", models.CharField(blank=True, max_length=64)),
                ("content", models.TextField(blank=True)),
                ("stored_path", models.CharField(blank=True, max_length=500)),
                ("message", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="attachments", to="core.message")),
            ],
        ),
        migrations.CreateModel(
            name="AdminAction",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("ip", models.GenericIPAddressField(blank=True, null=True)),
                ("action", models.CharField(max_length=500)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("session", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="actions", to="core.adminsession")),
            ],
            options={"ordering": ["created_at"]},
        ),
    ]
