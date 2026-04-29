#!/usr/bin/env python3
"""Django command-line utility for Time To Deny."""
import os
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = PROJECT_ROOT / "backend"


def should_auto_migrate(argv: list[str]) -> bool:
    return (
        len(argv) > 1
        and argv[1] == "runserver"
        and os.environ.get("TTD_AUTO_MIGRATE", "1") == "1"
        and os.environ.get("RUN_MAIN") != "true"
    )


def main() -> None:
    sys.path.insert(0, str(BACKEND_DIR))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "timetodeny.settings")

    if should_auto_migrate(sys.argv):
        subprocess.run(
            [sys.executable, str(PROJECT_ROOT / "manage.py"), "migrate", "--noinput"],
            check=True,
        )

    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
