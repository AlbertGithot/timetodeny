from __future__ import annotations

from django.conf import settings
from django.http import HttpResponse


class SimpleCorsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method == "OPTIONS":
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)

        origin = request.headers.get("Origin")
        origin_normalized = origin.rstrip("/") if origin else ""
        allowed = {
            settings.TTD_FRONTEND_ORIGIN.rstrip("/"),
            settings.TTD_FRONTEND_INTERNAL_URL.rstrip("/"),
            "http://localhost:8000",
            "http://127.0.0.1:8000",
            "http://localhost:4028",
            "http://127.0.0.1:4028",
        }
        if origin_normalized in allowed or settings.DEBUG:
            response["Access-Control-Allow-Origin"] = origin or settings.TTD_FRONTEND_ORIGIN
            response["Vary"] = "Origin"
        response["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        response["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response["Access-Control-Allow-Credentials"] = "true"
        return response
