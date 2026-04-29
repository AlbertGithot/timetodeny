from __future__ import annotations

import uuid

from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Chat(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200, default="New conversation")
    mode = models.CharField(max_length=16, default="instant")
    active_model = models.CharField(max_length=160, default="local-assistant")

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return self.title


class Message(TimeStampedModel):
    ROLE_CHOICES = (
        ("system", "System"),
        ("user", "User"),
        ("assistant", "Assistant"),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat = models.ForeignKey(Chat, related_name="messages", on_delete=models.CASCADE)
    role = models.CharField(max_length=16, choices=ROLE_CHOICES)
    content = models.TextField(blank=True)
    thinking = models.TextField(blank=True)
    tokens_per_sec = models.FloatField(null=True, blank=True)
    total_tokens = models.PositiveIntegerField(default=0)
    test_passed = models.BooleanField(null=True, blank=True)
    test_output = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["created_at"]


class Attachment(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    message = models.ForeignKey(Message, related_name="attachments", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    file_type = models.CharField(max_length=24, default="file")
    size = models.CharField(max_length=64, blank=True)
    content = models.TextField(blank=True)
    stored_path = models.CharField(max_length=500, blank=True)


class GeneratedFile(TimeStampedModel):
    TYPE_CHOICES = (
        ("code", "Code"),
        ("text", "Text"),
        ("image_url", "Image URL"),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    message = models.ForeignKey(Message, related_name="generated_files", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    language = models.CharField(max_length=80, blank=True)
    content = models.TextField()
    file_type = models.CharField(max_length=24, choices=TYPE_CHOICES, default="text")
    disk_path = models.CharField(max_length=500, blank=True)


class RequestLog(TimeStampedModel):
    STATUS_CHOICES = (
        ("success", "Success"),
        ("error", "Error"),
        ("timeout", "Timeout"),
        ("streaming", "Streaming"),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    model = models.CharField(max_length=160, blank=True)
    mode = models.CharField(max_length=16, default="instant")
    query = models.TextField(blank=True)
    response = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="streaming")
    latency_ms = models.PositiveIntegerField(default=0)
    tokens = models.PositiveIntegerField(default=0)
    error_details = models.TextField(blank=True)
    chat = models.ForeignKey(Chat, null=True, blank=True, related_name="request_logs", on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-created_at"]


class ModelRegistry(TimeStampedModel):
    TYPE_CHOICES = (
        ("text", "Text"),
        ("vision", "Vision"),
        ("code", "Code"),
    )
    STATUS_CHOICES = (
        ("ready", "Ready"),
        ("loading", "Loading"),
        ("downloading", "Downloading"),
        ("error", "Error"),
        ("unloaded", "Unloaded"),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=180)
    repo_id = models.CharField(max_length=255, blank=True)
    filename = models.CharField(max_length=255, blank=True)
    model_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="text")
    size = models.CharField(max_length=64, default="-")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="unloaded")
    vram = models.CharField(max_length=64, default="-")
    selected = models.BooleanField(default=False)
    hidden = models.BooleanField(default=False)
    system_prompt = models.TextField(blank=True)
    quantization = models.CharField(max_length=64, default="Q4_K_M")
    download_progress = models.PositiveSmallIntegerField(default=0)
    local_path = models.CharField(max_length=500, blank=True)
    auto_select = models.BooleanField(default=True)
    use_for_instant = models.BooleanField(default=True)
    use_for_expert = models.BooleanField(default=True)
    instant_context_messages = models.PositiveSmallIntegerField(default=4)
    expert_context_messages = models.PositiveSmallIntegerField(default=12)
    instant_max_tokens = models.PositiveIntegerField(default=512)
    expert_max_tokens = models.PositiveIntegerField(default=2048)
    llama_context_size = models.PositiveIntegerField(default=0)
    llama_threads = models.PositiveIntegerField(default=0)
    llama_gpu_layers = models.IntegerField(default=-1)
    prompt_cache_enabled = models.BooleanField(default=True)
    run_tests = models.BooleanField(default=True)
    max_test_files = models.PositiveSmallIntegerField(default=2)

    class Meta:
        ordering = ["-selected", "hidden", "name"]

    def __str__(self) -> str:
        return self.name


class ModelInstallJob(TimeStampedModel):
    TYPE_CHOICES = ModelRegistry.TYPE_CHOICES
    STATUS_CHOICES = (
        ("queued", "Queued"),
        ("downloading", "Downloading"),
        ("verifying", "Verifying"),
        ("ready", "Ready"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    repo_id = models.CharField(max_length=255)
    filename = models.CharField(max_length=255)
    model_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="text")
    quantization = models.CharField(max_length=64, default="Q4_K_M")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="queued")
    progress = models.PositiveSmallIntegerField(default=0)
    bytes_downloaded = models.BigIntegerField(default=0)
    bytes_total = models.BigIntegerField(default=0)
    speed_bps = models.FloatField(default=0)
    eta_seconds = models.PositiveIntegerField(default=0)
    log = models.TextField(blank=True)
    error_details = models.TextField(blank=True)
    local_path = models.CharField(max_length=500, blank=True)
    requested_by_ip = models.GenericIPAddressField(null=True, blank=True)
    requested_by_user_agent = models.TextField(blank=True)
    model = models.ForeignKey(ModelRegistry, null=True, blank=True, related_name="install_jobs", on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.repo_id}/{self.filename} [{self.status}]"


class AdminSession(TimeStampedModel):
    STATUS_CHOICES = (
        ("active", "Active"),
        ("ended", "Ended"),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token = models.CharField(max_length=128, unique=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    login_time = models.DateTimeField(auto_now_add=True)
    logout_time = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="active")

    class Meta:
        ordering = ["-login_time"]


class AdminAction(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(AdminSession, null=True, blank=True, related_name="actions", on_delete=models.SET_NULL)
    ip = models.GenericIPAddressField(null=True, blank=True)
    action = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class AdminSetting(models.Model):
    key = models.CharField(max_length=120, primary_key=True)
    value = models.TextField()
    updated_at = models.DateTimeField(auto_now=True)
