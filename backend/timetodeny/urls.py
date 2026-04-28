from django.conf import settings
from django.conf.urls.static import static
from django.urls import path, re_path

from core import views

urlpatterns = [
    path("api", views.api_index),
    path("api/health", views.health),
    path("api/runtime", views.runtime_status),
    path("api/chats", views.chats_collection),
    path("api/chats/<uuid:chat_id>", views.chat_detail),
    path("api/chat/stream", views.chat_stream),
    path("api/chat/stop", views.chat_stop),
    path("api/workspaces/<uuid:chat_id>", views.workspace_detail),
    path("api/workspaces/<uuid:chat_id>/file", views.workspace_file),
    path("api/workspaces/<uuid:chat_id>/zip", views.workspace_zip),
    path("api/workspaces/<uuid:chat_id>/diff", views.workspace_diff),
    path("api/workspaces/<uuid:chat_id>/test", views.workspace_test),
    path("api/workspaces/<uuid:chat_id>/rollback", views.workspace_rollback),
    path("api/models", views.models_collection),
    path("api/models/search", views.models_search),
    path("api/models/install-jobs", views.model_install_jobs),
    path("api/models/install-jobs/<uuid:job_id>/cancel", views.model_install_job_cancel),
    path("api/models/install-jobs/<uuid:job_id>/retry", views.model_install_job_retry),
    path("api/models/install", views.model_install),
    path("api/models/import-local", views.models_import_local),
    path("api/models/runtime", views.models_runtime),
    path("api/models/restart", views.models_runtime_restart),
    path("api/models/show-all", views.models_show_all),
    path("api/models/hide-all", views.models_hide_all),
    path("api/models/compatibility", views.models_compatibility),
    path("api/models/<uuid:model_id>/<str:action>", views.model_action),
    path("api/admin/login", views.admin_login),
    path("api/admin/logout", views.admin_logout),
    path("api/admin/change-password", views.admin_change_password),
    path("api/admin/kick-all", views.admin_kick_all),
    path("api/admin/requests", views.admin_requests),
    path("api/admin/requests/export", views.admin_requests_export),
    path("api/admin/server", views.admin_server),
    path("api/admin/logs", views.admin_logs),
    path("api/admin/disk", views.admin_disk),
    path("api/admin/cleanup", views.admin_cleanup),
    path("api/admin/backup", views.admin_backup),
    path("api/admin/sessions", views.admin_sessions),
    path("", views.index),
    re_path(r"^(?!api(?:/|$)|media(?:/|$)).*$", views.frontend_entry),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
