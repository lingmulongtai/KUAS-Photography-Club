from datautil import *
import ctypes, os

TOKTX = next((BASE / "tools").rglob("toktx.exe"))


def lower_priority():
    if os.name == "nt":
        k = ctypes.windll.kernel32
        k.SetPriorityClass(k.GetCurrentProcess(), 0x4000)


def texsum(path):
    data = path.read_bytes()
    assert data[:12] == b"\xabKTX 20\xbb\r\n\x1a\n"
    vals = struct.unpack_from("<9I", data, 12)
    return {
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "width": vals[2],
        "height": vals[3],
        "mips": vals[7],
    }
