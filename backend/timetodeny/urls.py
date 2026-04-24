from django.conf import settings
from django.conf.urls.static import static
from django.urls import path, re_path

from core import views

urlpatterns = [
    path("api", views.api_index),
    path("api/health", views.health),
    path("api/chats", views.chats_collection),
    path("api/chats/<uuid:chat_id>", views.chat_detail),
    path("api/chat/stream", views.chat_stream),
    path("api/models", views.models_collection),
    path("api/models/search", views.models_search),
    path("api/models/install", views.model_install),
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
    path("api/admin/sessions", views.admin_sessions),
    path("", views.index),
    re_path(r"^(?!api(?:/|$)|media(?:/|$)).*$", views.frontend_entry),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
