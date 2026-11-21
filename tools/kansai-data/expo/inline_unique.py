"""Inline KTX pages used by a single geometry file, bounded per tile."""

from pathlib import Path
from collections import Counter, defaultdict
import hashlib, json, os, struct, sys, gzip
from datautil import BASE, readtile
from convert import atomic
from ship_expo import ROOT, REFERENCE, write_file
from verify_package import verify


def run(profile):
    src, dst = ROOT / profile, ROOT / (profile + "-embedded")
    proof = REFERENCE / dst.name
    proof.mkdir(parents=True, exist_ok=True)
    report = json.loads((REFERENCE / profile / "dependencies.json").read_text())
    uses = Counter(
        page for model in report["localB3dm"].values() for page in set(model["pages"])
    )
    selected = set()
    page_orig = {}
    for rel, model in report["localB3dm"].items():
        path = src / rel
        exclusive = sorted({page for page in model["pages"] if uses[page] == 1})
        if not exclusive:
            write_file(path, dst / rel)
            continue
        data, _, offset, doc, start = readtile(path)
        body = bytearray(data[start:])
        changed = False
        added = {}
        for item in doc.get("images", []):
            u = item.get("uri")
            if not u:
                continue
            p = (path.parent / u).resolve().relative_to(src.resolve()).as_posix()
            if p not in exclusive:
                continue
            if p in added:
                item.pop("uri")
                item["bufferView"] = added[p]
                continue
            buf = (src / p).read_bytes()
            if len(data) + len(body) - len(data[start:]) + len(buf) + 512 > 520_000:
                continue
            selected.add(p)
            changed = True
            while len(body) % 4:
                body.append(0)
            i = len(doc["bufferViews"])
            doc["bufferViews"].append(
                {"buffer": 0, "byteOffset": len(body), "byteLength": len(buf)}
            )
            body.extend(buf)
            item.pop("uri")
            item["bufferView"] = i
            added[p] = i
            page_orig[(rel, i)] = p
        if not changed:
            write_file(path, dst / rel)
            continue
        while len(body) % 4:
            body.append(0)
        doc["buffers"][0]["byteLength"] = len(body)
        j = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode()
        j += b" " * (-len(j) % 4)
        total = 28 + len(j) + len(body)
        glb = (
            struct.pack("<4s4I", b"glTF", 2, total, len(j), 0x4E4F534A)
            + j
            + struct.pack("<II", len(body), 0x004E4942)
            + body
        )
        prefix = bytearray(data[:offset])
        struct.pack_into("<I", prefix, 8, len(prefix) + len(glb))
        out = dst / rel
        out.parent.mkdir(exist_ok=True, parents=True)
        out.write_bytes(prefix + glb)
    for f in src.rglob("*"):
        if not f.is_file() or f.suffix == ".b3dm":
            continue
        rel = f.relative_to(src).as_posix()
        if rel not in selected:
            write_file(f, dst / rel)
    # Verify every embedded texture against the independent original-page digest.
    for (rel, i), p in page_orig.items():
        data, _, _, g, start = readtile(dst / rel)
        view = g["bufferViews"][i]
        at = start + view["byteOffset"]
        decoded = data[at : at + view["byteLength"]]
        assert decoded == (src / p).read_bytes() and decoded.startswith(
            b"\xabKTX 20\xbb\r\n\x1a\n"
        )
    items = [
        {
            "path": f.relative_to(dst).as_posix(),
            "bytes": f.stat().st_size,
            "sha256": hashlib.sha256(f.read_bytes()).hexdigest(),
        }
        for f in sorted(dst.rglob("*"))
        if f.is_file()
    ]
    manifest = proof / "sha256.json"
    atomic(manifest, items)
    result = verify(dst, manifest)
    result.update(
        embeddedPages=len(selected), largest=max(items, key=lambda i: i["bytes"])
    )
    atomic(proof / "summary.json", result)
    print(result, flush=True)


if __name__ == "__main__":
    run(sys.argv[1])
