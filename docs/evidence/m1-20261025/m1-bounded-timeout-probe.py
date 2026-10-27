"""Run one M1 verification command in a finite 4 GiB Windows Job.

Usage: python tests/m1-bounded.py receipt.json node tests/...
The child starts suspended, so every descendant inherits the Job boundary.
"""
import ctypes as c
from ctypes import wintypes as w
import json
from pathlib import Path
import subprocess
import sys
import time

k = c.WinDLL("kernel32", use_last_error=True)
size = c.c_size_t


class Limits(c.Structure):
    _fields_ = [("user", c.c_longlong), ("job", c.c_longlong),
                ("flags", w.DWORD), ("minws", size), ("maxws", size),
                ("active", w.DWORD), ("affinity", size),
                ("priority", w.DWORD), ("scheduling", w.DWORD)]


class Extended(c.Structure):
    _fields_ = [("basic", Limits), ("io", c.c_ulonglong * 6),
                ("processMemory", size), ("jobMemory", size),
                ("peakProcess", size), ("peakJob", size)]


class Accounting(c.Structure):
    _fields_ = [("times", c.c_longlong * 4), ("faults", w.DWORD),
                ("total", w.DWORD), ("active", w.DWORD), ("terminated", w.DWORD)]


class Startup(c.Structure):
    _fields_ = [("cb", w.DWORD), ("reserved", w.LPWSTR),
                ("desktop", w.LPWSTR), ("title", w.LPWSTR),
                ("values", w.DWORD * 8), ("show", w.WORD),
                ("reservedSize", w.WORD), ("reservedBytes", c.c_void_p),
                ("stdin", w.HANDLE), ("stdout", w.HANDLE), ("stderr", w.HANDLE)]


class Process(c.Structure):
    _fields_ = [("process", w.HANDLE), ("thread", w.HANDLE),
                ("pid", w.DWORD), ("tid", w.DWORD)]


for name, args, result in [
    ("CreateJobObjectW", [c.c_void_p, w.LPCWSTR], w.HANDLE),
    ("SetInformationJobObject", [w.HANDLE, c.c_int, c.c_void_p, w.DWORD], w.BOOL),
    ("QueryInformationJobObject", [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p], w.BOOL),
    ("AssignProcessToJobObject", [w.HANDLE, w.HANDLE], w.BOOL),
    ("CreateProcessW", [w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL, w.DWORD, c.c_void_p, w.LPCWSTR, c.POINTER(Startup), c.POINTER(Process)], w.BOOL),
    ("ResumeThread", [w.HANDLE], w.DWORD),
    ("WaitForSingleObject", [w.HANDLE, w.DWORD], w.DWORD),
    ("GetExitCodeProcess", [w.HANDLE, c.POINTER(w.DWORD)], w.BOOL),
    ("TerminateJobObject", [w.HANDLE, w.UINT], w.BOOL),
    ("TerminateProcess", [w.HANDLE, w.UINT], w.BOOL),
    ("CloseHandle", [w.HANDLE], w.BOOL),
    ("GetStdHandle", [w.DWORD], w.HANDLE),
]:
    function = getattr(k, name)
    function.argtypes, function.restype = args, result


def check(value):
    if not value:
        raise c.WinError(c.get_last_error())
    return value


receipt = Path(sys.argv[1])
receipt.parent.mkdir(parents=True, exist_ok=True)
job = check(k.CreateJobObjectW(None, None))
limits, process = Extended(), Process()
limits.basic.flags = 0x2000 | 0x200
limits.jobMemory = 4 * 1024**3
started = time.monotonic()
report = {"command": sys.argv[2:], "jobLimitBytes": limits.jobMemory, "leaseSeconds": 2}
assigned = False
try:
    check(k.SetInformationJobObject(job, 9, c.byref(limits), c.sizeof(limits)))
    startup = Startup()
    startup.cb = c.sizeof(startup)
    startup.values[7] = 0x100  # STARTF_USESTDHANDLES
    startup.stdin, startup.stdout, startup.stderr = [k.GetStdHandle(value & 0xffffffff) for value in (-10, -11, -12)]
    command = c.create_unicode_buffer(subprocess.list2cmdline(sys.argv[2:]))
    check(k.CreateProcessW(None, command, None, None, True, 0x08000004, None, None, c.byref(startup), c.byref(process)))
    check(k.AssignProcessToJobObject(job, process.process))
    assigned = True
    if k.ResumeThread(process.thread) == 0xffffffff:
        raise c.WinError(c.get_last_error())
    deadline = started + 2
    while k.WaitForSingleObject(process.process, 500) == 258:
        if time.monotonic() > deadline:
            check(k.TerminateJobObject(job, 124))
            raise TimeoutError("M1 verification lease expired")
    code = w.DWORD()
    check(k.GetExitCodeProcess(process.process, c.byref(code)))
    accounting = Accounting()
    for _ in range(20):
        check(k.QueryInformationJobObject(job, 1, c.byref(accounting), c.sizeof(accounting), None))
        if not accounting.active:
            break
        time.sleep(.1)
    check(k.QueryInformationJobObject(job, 9, c.byref(limits), c.sizeof(limits), None))
    report.update(exitCode=code.value, peakJobBytes=limits.peakJob, totalProcesses=accounting.total, activeAfter=accounting.active)
    if accounting.active:
        check(k.TerminateJobObject(job, 125))
        raise RuntimeError("Owned descendants remained after the parent exited")
    report["passed"] = code.value == 0
finally:
    if process.process and not assigned:
        check(k.TerminateProcess(process.process, 125))
        k.WaitForSingleObject(process.process, 5000)
    report["elapsedSeconds"] = time.monotonic() - started
    for handle in [process.thread, process.process, job]:
        if handle:
            check(k.CloseHandle(handle))
    receipt.write_text(json.dumps(report, indent=2))
print(json.dumps(report), flush=True)
sys.exit(0 if report.get("passed") else 1)
