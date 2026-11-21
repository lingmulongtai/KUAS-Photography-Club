from site_near_v2 import *
from visual_check import decoded, camera, frame
from datautil import Image
import tempfile, time


def qa(kind, num, root, pas=0):
    from pathlib import Path

    out = BASE / "qa-site-fine"
    out.mkdir(exist_ok=True)
    src = BASE / "source" / kind / "data" / ("data" + str(num) + ".b3dm")
    rec = json.loads((MD / (kind + "-" + str(num) + ".json")).read_text())
    assert rec["units"]
    sample = []
    with tempfile.TemporaryDirectory(dir=BASE) as td:
        tmp = Path(td)
        a, rtc, ha = decoded(src, False, BASE / "tools/meshoptimizer", tmp, pas)
        b = []
        for u in rec["units"]:
            path = root / kind / u["uri"]
            g, rt, h = decoded(path, True, BASE / "tools/meshoptimizer", tmp, pas)
            assert np.array_equal(rtc, rt) and h == ha
            b.extend(g)
        for az, zoom in ((0.45, 0.96), (-1.2, 1.70)):
            cam = camera(np.concatenate([t[0] for t in a]), rtc, az, zoom)
            i, di, fi = frame(a, cam, pas)
            j, dj, fj = frame(b, cam, pas)
            x = fi >= 0
            y = fj >= 0
            mask = x & y
            mu = np.square(j[mask].astype(float) - i[mask]).mean()
            sample.append(
                {
                    "azimuth": az,
                    "zoom": zoom,
                    "silhouetteIoU": float(mask.sum() / (x | y).sum()),
                    "featureAgreement": float((fi[mask] == fj[mask]).mean()),
                    "psnr": float(10 * np.log10(255**2 / max(1e-12, mu))),
                    "depthP95Metres": float(
                        np.quantile(abs(di[mask] - dj[mask]), 0.95)
                    ),
                    "maxDepthMetres": float(abs(di[mask] - dj[mask]).max()),
                }
            )
            p = Image.fromarray(np.concatenate([i, j], axis=1))
            p.thumbnail((1100, 500))
            p.save(out / (kind + "-" + str(num) + "-" + str(az) + ".jpg"), quality=91)
    atomic(out / (kind + "-" + str(num) + ".json"), sample)
    print(kind, num, sample, flush=True)


if __name__ == "__main__":
    lower_priority()
    qa("bldg", 37, DEST)
    qa("bldg", 31, DEST)
    qa("bldg", 49, DEST)
