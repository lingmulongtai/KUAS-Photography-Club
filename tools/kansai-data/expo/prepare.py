"""Rebuild the club's noncommercial 2025 Osaka-Kansai Expo exhibit.

Install this directory's requirements.txt, run npm ci at the project root, then
run 'python prepare.py <scratch-directory>'. The encoders use Windows and 7-Zip.
The output is <scratch-directory>/delivery/full-embedded/. The official source
terms are linked in public/kansai/expo-models/CREDITS.txt. No network or data
preparation is needed for a normal site build.
"""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


def prepare(work, verify_views):
    source = Path(__file__).resolve().parent
    project = source.parents[2]
    if work == project or work.is_relative_to(project):
        raise ValueError("Use a scratch directory outside the source checkout")
    work.mkdir(parents=True, exist_ok=True)
    for pattern in ("*.py", "*.mjs", "source-sha256.json"):
        for tool in source.glob(pattern):
            if tool.name != "prepare.py":
                shutil.copy2(tool, work / tool.name)
    meshopt = project / "node_modules/meshoptimizer"
    target = work / "tools/meshoptimizer"
    target.mkdir(parents=True, exist_ok=True)
    if json.loads((meshopt / "package.json").read_bytes())["version"] != "1.1.1":
        raise ValueError("The Expo source meshes require meshoptimizer 1.1.1")
    for name in (
        "package.json",
        "LICENSE.md",
        "meshopt_encoder.js",
        "meshopt_decoder.mjs",
        "meshopt_simplifier.js",
    ):
        shutil.copy2(meshopt / name, target / name)

    def run(name, *args):
        subprocess.run(
            [sys.executable, "-B", "-X", "utf8", str(work / name), *args],
            cwd=work,
            check=True,
        )

    run("bootstrap.py")
    for rel, expected in json.loads(
        (source / "source-sha256.json").read_bytes()
    ).items():
        if hashlib.sha256((work / rel).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Official survey content changed: {rel}")
    for task in (
        "spatial.py",
        "ring_impostor.py",
        "expo_site.py",
        "site_surfaces.py",
        "site_near_v2.py",
    ):
        run(task)
    run("ship_expo.py", "full", "--head")
    run("inline_unique.py", "full")
    run(
        "verify_package.py",
        "delivery/full-embedded",
        "delivery-proof/full-embedded/sha256.json",
    )
    if verify_views:
        run("site_surface_qa.py")
        run("site_fine_qa.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scratch", type=Path)
    parser.add_argument("--verify-views", action="store_true")
    args = parser.parse_args()
    prepare(args.scratch.resolve(), args.verify_views)
