# Generated for Time To Deny model install jobs.

import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0002_model_performance_settings"),
    ]

    operations = [
        migrations.CreateModel(
            name="ModelInstallJob",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("repo_id", models.CharField(max_length=255)),
                ("filename", models.CharField(max_length=255)),
                (
                    "model_type",
                    models.CharField(
                        choices=[("text", "Text"), ("vision", "Vision"), ("code", "Code")],
                        default="text",
                        max_length=20,
                    ),
                ),
                ("quantization", models.CharField(default="Q4_K_M", max_length=64)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("queued", "Queued"),
                            ("downloading", "Downloading"),
                            ("verifying", "Verifying"),
                            ("ready", "Ready"),
                            ("failed", "Failed"),
                            ("cancelled", "Cancelled"),
                        ],
                        default="queued",
                        max_length=20,
                    ),
                ),
                ("progress", models.PositiveSmallIntegerField(default=0)),
                ("bytes_downloaded", models.BigIntegerField(default=0)),
                ("bytes_total", models.BigIntegerField(default=0)),
                ("speed_bps", models.FloatField(default=0)),
                ("eta_seconds", models.PositiveIntegerField(default=0)),
                ("log", models.TextField(blank=True)),
                ("error_details", models.TextField(blank=True)),
                ("local_path", models.CharField(blank=True, max_length=500)),
                ("requested_by_ip", models.GenericIPAddressField(blank=True, null=True)),
                ("requested_by_user_agent", models.TextField(blank=True)),
                (
                    "model",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="install_jobs",
                        to="core.modelregistry",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
    ]
