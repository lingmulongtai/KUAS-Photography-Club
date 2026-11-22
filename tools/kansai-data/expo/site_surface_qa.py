from site_surfaces import *
from visual_check import decoded, camera, frame
from PIL import ImageDraw


def subset(gs, i, delta, texture=True):
    pieces = []
    for p, n, v, col, f, b, tx, w in gs:
        ff = f[b[f[:, 0]] == i]
        if not len(ff):
            continue
        ids, remap = np.unique(ff, return_inverse=True)
        pieces.append(
            (
                p[ids].astype(float) + delta,
                n[ids],
                v[ids],
                col[ids],
                remap.reshape(-1, 3),
                np.zeros(len(ids), np.uint8),
                tx if texture else None,
                w,
            )
        )
    return pieces


def qa():
    lower_priority()
    qa = BASE / "qa-managed-surface"
    qa.mkdir(exist_ok=True)
    audit = json.loads((DEST / "frn-surfaces.json").read_text())
    items = sorted(audit["features"], key=lambda r: r["maxEdgeOriginal"], reverse=True)
    cases = [
        (182, "frn_65fcb412-7de3-4087-beb4-d433be3c05b7"),
        (38, "frn_492de36b-7adc-43c1-b0f5-dfe29ebaa792"),
        (247, "frn_5ce668fc-3ee6-4830-a70a-ae9e6ae5276e"),
        (105, "frn_67c230d1-0850-456c-a028-89ae4d9221b0"),
        (96, "frn_555bea59-908d-44c9-af3a-9782f1045b81"),
        (81, "frn_987a1d16-6fb1-4944-9b32-b3a787a7db89"),
        (121, "frn_9b0d11ab-bb3a-45c0-b5f4-a9f105827358"),
    ]
    rows = []
    montage = Image.new("RGB", (750, 7 * 140))
    with tempfile.TemporaryDirectory(dir=BASE) as td:
        tmp = Path(td)
        for row, (num, pid) in enumerate(cases):
            variants = []
            for file, opt in [
                (BASE / "source/frn/data" / ("data" + str(num) + ".b3dm"), False),
                (ORIG / "frn/proxy" / ("leaf-" + str(num) + ".b3dm"), True),
                (DEST / "frn/surface" / ("leaf-" + str(num) + ".b3dm"), True),
            ]:
                x, rt, _ = decoded(file, opt, BASE / "tools/meshoptimizer", tmp)
                data, h, o, _, _ = readtile(file)
                meta = json.loads(data[28 + h[3] + h[4] : 28 + h[3] + h[4] + h[5]])
                variants.append(subset(x, meta["gml_id"].index(pid), (rt - RTC) @ CY))
            for az in (0.45, 2.1, -1.1):
                cam = camera(np.concatenate([m[0] for m in variants[0]]), RTC, az, 0.96)
                orig, _, fid = frame(variants[0], cam)
                baseline = fid >= 0
                rr = {"source": num, "feature": pid, "azimuth": az}
                ims = [orig]
                for key, geo in zip(("panels", "measured"), variants[1:]):
                    pic, _, ids = frame(geo, cam)
                    mask = ids >= 0
                    uni = np.count_nonzero(mask | baseline)
                    both = np.count_nonzero(mask & baseline)
                    rr[key] = {
                        "iou": round(both / uni, 5) if uni else 1.0,
                        "falsePixels": int((mask & ~baseline).sum()),
                        "nativePixels": int(baseline.sum()),
                        "missingPixels": int((baseline & ~mask).sum()),
                    }
                    ims.append(pic)
                rows.append(rr)
                if az == 0.45:
                    for col, im in enumerate(ims):
                        img = Image.fromarray(im)
                        img.thumbnail((248, 139))
                        montage.paste(img, (col * 250, row * 140))
    montage.save(qa / "source-panels-measured.jpg", quality=84)
    atomic(qa / "shape-check.json", rows)
    for k in ("panels", "measured"):
        print(
            k,
            "median IoU",
            np.median([r[k]["iou"] for r in rows]),
            "false/source",
            sum(r[k]["falsePixels"] for r in rows)
            / sum(r[k]["nativePixels"] for r in rows),
            flush=True,
        )


if __name__ == "__main__":
    qa()
