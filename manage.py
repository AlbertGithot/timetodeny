#!/usr/bin/env python3
"""Django command-line utility for Time To Deny."""
import os
import sys
from pathlib import Path


def main() -> None:
    backend_dir = Path(__file__).resolve().parent / "backend"
    sys.path.insert(0, str(backend_dir))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "timetodeny.settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
