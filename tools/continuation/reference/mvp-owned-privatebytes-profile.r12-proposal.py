"""SOURCE ONLY: bounded observer; caller owns every borrowed verified handle.

No process discovery, handle opening, termination, threads, GC, or cap changes.
Only integrate into a separately reviewed and pinned validation-runner copy.
"""
import ctypes as C
import ctypes.wintypes as W
import json
import time


class PROCESS_MEMORY_COUNTERS_EX(C.Structure):
    _fields_ = [('cb', W.DWORD), ('PageFaultCount', W.DWORD)] + [
        (name, C.c_size_t) for name in (
            'PeakWorkingSetSize', 'WorkingSetSize', 'QuotaPeakPagedPoolUsage',
            'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage',
            'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage',
            'PrivateUsage')]


class PrivateBytesProfile:
    INTERVAL_NS = 100_000_000
    MAX_ROWS = 40_000
    MAX_BYTES = 8 * 1024 * 1024
    MAX_IDENTITIES = 1024
    MAX_BATCH = 64
    FOOTER_RESERVE = 1024

    def __init__(self, kernel32, path, phase_deadline):
        assert C.sizeof(C.c_void_p) == 8
        assert C.sizeof(PROCESS_MEMORY_COUNTERS_EX) == 80
        self.kernel32 = kernel32
        self.query = kernel32.K32GetProcessMemoryInfo
        self.query.argtypes = [W.HANDLE, C.POINTER(PROCESS_MEMORY_COUNTERS_EX), W.DWORD]
        self.query.restype = W.BOOL
        self.deadline_ns = min(int(phase_deadline * 1e9), time.monotonic_ns() + 600_000_000_000)
        self.next_ns = 0
        self.rows = self.bytes = 0
        self.peaks = {}
        self.stop_reason = None
        self.closed = False
        self.errors = 0
        self.file = path.open('xb', buffering=4096)

    def _append(self, row):
        encoded = (json.dumps(row, separators=(',', ':'), ensure_ascii=True) + '\n').encode('ascii')
        if self.rows >= self.MAX_ROWS:
            self.stop_reason = 'row-cap'
            return False
        if self.bytes + len(encoded) > self.MAX_BYTES - self.FOOTER_RESERVE:
            self.stop_reason = 'byte-cap'
            return False
        self.file.write(encoded)
        self.bytes += len(encoded)
        self.rows += 1
        return True

    def sample(self, verified):
        """verified: at most64 (pid, borrowed_handle, already_verified_identity).

        Caller passes only identities accepted by the unchanged private Job
        completion capture. Identity and final executable hashes remain in its
        original ledger. PID plus exact startFileTime joins this separate trace.
        Never reopen a PID, and never close a borrowed handle here.
        """
        now = time.monotonic_ns()
        if self.closed or self.stop_reason or now < self.next_ns:
            return
        if now >= self.deadline_ns:
            self.stop_reason = 'time-cap'
            return
        self.next_ns = now + self.INTERVAL_NS
        assert len(verified) <= self.MAX_BATCH
        for pid, handle, identity in verified:
            if time.monotonic_ns() >= self.deadline_ns:
                self.stop_reason = 'time-cap'
                break
            key = (pid, identity['startFileTime'])
            assert identity['pid'] == pid and len(str(key[1])) <= 20
            if key not in self.peaks:
                if len(self.peaks) >= self.MAX_IDENTITIES:
                    self.stop_reason = 'identity-cap'
                    break
                self.peaks[key] = {'samples': 0, 'peakPrivateBytes': None}
            base = dict(kind='sample', monotonicNs=time.monotonic_ns(),
                        pid=pid, startFileTime=key[1])
            status = self.kernel32.WaitForSingleObject(handle, 0)
            if status == 0:
                # A completed child is not an allocation reading of zero.
                base['status'] = 'exited-before-sample'
            elif status != 258:
                base.update(status='wait-unavailable', waitResult=int(status))
                self.errors += 1
            else:
                counters = PROCESS_MEMORY_COUNTERS_EX()
                counters.cb = C.sizeof(counters)
                C.set_last_error(0)
                if self.query(handle, C.byref(counters), counters.cb):
                    base.update(status='measured', privateBytes=int(counters.PrivateUsage))
                else:
                    base.update(status='query-unavailable', winError=C.get_last_error())
                    self.errors += 1
            if not self._append(base):
                break
            if base['status'] == 'measured':
                peak = self.peaks[key]
                peak['samples'] += 1
                peak['peakPrivateBytes'] = max(peak['peakPrivateBytes'] or 0, base['privateBytes'])

    def close(self):
        if self.closed:
            return
        try:
            footer = (json.dumps(dict(kind='footer', rows=self.rows, dataBytes=self.bytes,
                                     errors=self.errors, stopReason=self.stop_reason or 'phase-finally'),
                                 separators=(',', ':')) + '\n').encode('ascii')
            assert len(footer) <= self.FOOTER_RESERVE
            self.file.write(footer)
            self.bytes += len(footer)
        finally:
            try:
                self.file.close()
            finally:
                self.closed = self.file.closed

    def summary(self):
        return dict(schema=1, metric='PROCESS_MEMORY_COUNTERS_EX.PrivateUsage',
                    intervalNs=self.INTERVAL_NS, rows=self.rows, bytes=self.bytes,
                    maxRows=self.MAX_ROWS, maxBytes=self.MAX_BYTES,
                    stopReason=self.stop_reason, errors=self.errors, closed=self.closed,
                    identities=[dict(pid=pid, startFileTime=start, **values)
                                for (pid, start), values in self.peaks.items()],
                    sampledPeakOnly=True, exactAllocationAttribution=False,
                    handleOwnership='borrowed-verified-private-job-handles')
