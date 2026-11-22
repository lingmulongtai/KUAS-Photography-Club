from pathlib import Path
import requests, json, concurrent.futures, hashlib, subprocess, threading, struct, time, shutil, os
from urllib.parse import urljoin

BASE = Path(__file__).resolve().parent
ROOTS = {
    "bldg": "https://assets.cms.plateau.reearth.io/assets/7b/f67643-f9ad-40f9-8a83-7308c7e83748/27999_osaka-shi_city_2025_citygml_1_op_bldg_lod3/tileset.json",
    "frn": "https://assets.cms.plateau.reearth.io/assets/79/da1696-6197-4856-8876-4404af1bd499/27999_osaka-shi_city_2025_citygml_1_op_frn_lod3/tileset.json",
}
thread = threading.local()


def grab(job):
    path, url = job
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return
    if not hasattr(thread, "client"):
        thread.client = requests.Session()
    for retry in range(3):
        try:
            r = thread.client.get(url, timeout=(15, 90))
            r.raise_for_status()
            data = r.content
            if path.suffix == ".b3dm":
                assert data[:4] == b"b3dm" and struct.unpack_from("<I", data, 8)[
                    0
                ] == len(data)
            path.write_bytes(data)
            return
        except Exception:
            if retry == 2:
                raise


if __name__ == "__main__":
    dep = BASE / "tools"
    dep.mkdir(exist_ok=True)
    package = dep / "KTX-Software-4.4.2-Windows-x64.exe"
    grab(
        (
            package,
            "https://github.com/KhronosGroup/KTX-Software/releases/download/v4.4.2/"
            + package.name,
        )
    )
    assert (
        hashlib.sha256(package.read_bytes()).hexdigest()
        == "1f323b0fec19794f5e6c0425a61d4b1da396872a10be862d105f4f4b2d2957fe"
    )
    if not list(dep.rglob("toktx.exe")):
        sevenzip = shutil.which("7z") or str(
            Path(os.environ["ProgramFiles"]) / "7-Zip" / "7z.exe"
        )
        subprocess.run(
            [sevenzip, "x", "-y", str(package), "-o" + str(dep / "ktx")],
            check=True,
            stdout=subprocess.DEVNULL,
        )
    jobs = []
    for k, u in ROOTS.items():
        path = BASE / "source" / k / "tileset.json"
        grab((path, u))

        def collect(n):
            route = n.get("content", {}).get("uri")
            if route:
                jobs.append((path.parent / route, urljoin(u, route)))
            for c in n.get("children", []):
                collect(c)

        collect(json.loads(path.read_text())["root"])
    jobs.sort(
        key=lambda j: (
            0
            if j[0].name
            in (
                "data31.b3dm",
                "data37.b3dm",
                "data54.b3dm",
                "data70.b3dm",
                "data49.b3dm",
                "data260.b3dm",
                "data92.b3dm",
            )
            else 1
        )
    )
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        list(pool.map(grab, jobs))
    print("verified", len(jobs), sum(p.stat().st_size for p, u in jobs))
