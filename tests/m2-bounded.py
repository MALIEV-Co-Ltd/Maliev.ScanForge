"""Run an M2 verification command with the system's reported physical memory.

Usage: python tests/m2-bounded.py receipt.json node tests/...
The existing Windows Job cleanup and timeout behavior is shared with M1.
Node child processes are also configured with a system-sized old-space limit.
"""
import ctypes as c
from ctypes import wintypes as w
import os
from pathlib import Path
import runpy


class MemoryStatus(c.Structure):
    _fields_ = [
        ("length", w.DWORD), ("load", w.DWORD),
        ("total_physical", c.c_ulonglong), ("available_physical", c.c_ulonglong),
        ("total_pagefile", c.c_ulonglong), ("available_pagefile", c.c_ulonglong),
        ("total_virtual", c.c_ulonglong), ("available_virtual", c.c_ulonglong),
        ("available_extended_virtual", c.c_ulonglong),
    ]


status = MemoryStatus()
status.length = c.sizeof(status)
kernel = c.WinDLL("kernel32", use_last_error=True)
kernel.GlobalMemoryStatusEx.argtypes = [c.POINTER(MemoryStatus)]
kernel.GlobalMemoryStatusEx.restype = w.BOOL
if not kernel.GlobalMemoryStatusEx(c.byref(status)):
    raise c.WinError(c.get_last_error())
os.environ["SCANFORGE_JOB_MEMORY_BYTES"] = str(status.total_physical)
heap_mebibytes = status.total_physical // (1024 * 1024)
existing_options = os.environ.get("NODE_OPTIONS", "").strip()
os.environ["NODE_OPTIONS"] = (
    f"{existing_options} --max-old-space-size={heap_mebibytes}".strip()
)
runpy.run_path(str(Path(__file__).with_name("m1-bounded.py")), run_name="__main__")
