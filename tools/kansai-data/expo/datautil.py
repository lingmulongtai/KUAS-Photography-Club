import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE / "deps"))
import numpy as np, json, struct, hashlib, io, collections
from PIL import Image


def readtile(path):
    data = path.read_bytes()
    h = struct.unpack_from("<4s6I", data)
    o = 28 + sum(h[3:])
    assert len(data) == h[2]
    n = struct.unpack_from("<I", data, o + 12)[0]
    return data, h, o, json.loads(data[o + 20 : o + 20 + n]), o + 28 + n


def getview(data, g, start, i):
    v = g["bufferViews"][i]
    o = start + v.get("byteOffset", 0)
    return memoryview(data)[o : o + v["byteLength"]]
