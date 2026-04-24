#!/usr/bin/env python3
"""Django command-line utility for Time To Deny."""
import os
import subprocess
import sys
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent


def should_auto_migrate(argv: list[str]) -> bool:
    return (
        len(argv) > 1
        and argv[1] == "runserver"
        and os.environ.get("TTD_AUTO_MIGRATE", "1") == "1"
        and os.environ.get("RUN_MAIN") != "true"
    )


def main() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "timetodeny.settings")

    if should_auto_migrate(sys.argv):
        subprocess.run(
            [sys.executable, str(BASE_DIR / "manage.py"), "migrate", "--noinput"],
            check=True,
        )

    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
