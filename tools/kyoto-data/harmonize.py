"""Radiometric seam harmonization and Lake Biwa open-water cleanup for GSI aerial mosaics.

Detects strictly axis-aligned flight-date step seams (both Web Mercator and Japanese
standard mesh cutlines) across same-land-cover terrain, then solves an exact 2D DCT
Screened Poisson system for smooth per-pixel contrast gain and RGB bias fields.
"""
import gzip
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from common import OUT, bilinear, decode_rgb, global_pixels, mosaic


def _dct1(a, axis):
    n = a.shape[axis]
    y = np.concatenate([a, np.flip(a, axis=axis)], axis=axis)
    spec = np.fft.rfft(y, axis=axis)
    k = np.arange(n, dtype=np.float64)
    phase = np.exp(-1j * np.pi * k / (2.0 * n))
    shape = [1] * a.ndim
    shape[axis] = n
    coeffs = np.real(spec.take(range(n), axis=axis) * phase.reshape(shape))
    scale = np.full(n, np.sqrt(1.0 / (2.0 * n)))
    scale[0] = np.sqrt(1.0 / (4.0 * n))
    return coeffs * scale.reshape(shape)


def _idct1(c, axis):
    n = c.shape[axis]
    k = np.arange(n, dtype=np.float64)
    scale = np.full(n, np.sqrt(2.0 * n))
    scale[0] = np.sqrt(4.0 * n)
    shape = [1] * c.ndim
    shape[axis] = n
    phase = np.exp(1j * np.pi * k / (2.0 * n))
    spec = c * scale.reshape(shape) * phase.reshape(shape)
    pad_shape = list(c.shape)
    pad_shape[axis] = 1
    spec_full = np.concatenate([spec, np.zeros(pad_shape, dtype=np.complex128)], axis=axis)
    y = np.fft.irfft(spec_full, n=2 * n, axis=axis)
    return y.take(range(n), axis=axis)


def _dct2_2d(plane):
    return _dct1(_dct1(plane.astype(np.float64), axis=0), axis=1)


def _idct2_2d(plane):
    return _idct1(_idct1(plane.astype(np.float64), axis=1), axis=0)


def solve_screened_poisson(div_j, anchor_rhs=None, lam=1e-5):
    """Solve (lam - Laplacian) phi = div_j + lam * anchor_rhs with Neumann BCs via 2D DCT-II."""
    h, w = div_j.shape[:2]
    ky = np.arange(h, dtype=np.float64)[:, None]
    kx = np.arange(w, dtype=np.float64)[None, :]
    denom = (4.0 - 2.0 * np.cos(np.pi * ky / h) - 2.0 * np.cos(np.pi * kx / w)) + lam
    if div_j.ndim == 2:
        rhs = div_j.astype(np.float64)
        if anchor_rhs is not None:
            rhs = rhs + lam * anchor_rhs.astype(np.float64)
        return _idct2_2d(_dct2_2d(rhs) / denom).astype(np.float32)
    out = np.empty_like(div_j, dtype=np.float32)
    for c in range(div_j.shape[2]):
        rhs = div_j[:, :, c].astype(np.float64)
        if anchor_rhs is not None:
            rhs = rhs + lam * anchor_rhs[:, :, c].astype(np.float64)
        out[:, :, c] = _idct2_2d(_dct2_2d(rhs) / denom)
    return out


def load_canopy():
    path = Path(OUT) / 'kansai' / 'canopy.bin'
    if not path.exists():
        return None
    raw = path.read_bytes()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    if raw[:4] != b'KTC1':
        raise ValueError('Invalid kansai/canopy.bin header')
    x0, z0, step, w, h = struct.unpack_from('<iiIII', raw, 4)
    cells = np.frombuffer(raw, dtype=np.uint8, offset=24).reshape(h, w)
    return x0, z0, step, cells


def sample_canopy(canopy_data, box, shape_hw):
    h, w = shape_hw
    if canopy_data is None:
        return np.zeros((h, w), dtype=np.uint8)
    x0, z0, step, cells = canopy_data
    ch, cw = cells.shape
    west, north, east, south = box
    xs = west + (np.arange(w) + 0.5) * (east - west) / w
    zs = north + (np.arange(h) + 0.5) * (south - north) / h
    cols = np.clip(np.floor((xs - x0) / step).astype(np.int32), 0, cw - 1)
    rows = np.clip(np.floor((zs - z0) / step).astype(np.int32), 0, ch - 1)
    return cells[rows[:, None], cols[None, :]]


def rasterize_biwa_mask(box, shape_hw, erode_px=1):
    """Exact Lake Biwa open-water mask rasterized from kansai/biwa-water.bin (preserving all islands)."""
    h, w = shape_hw
    path = Path(OUT) / 'kansai' / 'biwa-water.bin'
    if not path.exists():
        return np.zeros((h, w), dtype=bool)
    west, north, east, south = box
    raw = path.read_bytes()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    lake_count, _ = struct.unpack_from('<II', raw, 0)
    verts = np.frombuffer(raw, dtype='<f4', offset=8, count=lake_count * 2).reshape(-1, 3, 2)
    keep = (
        (verts[:, :, 0].max(axis=1) >= west)
        & (verts[:, :, 0].min(axis=1) <= east)
        & (verts[:, :, 1].max(axis=1) >= north)
        & (verts[:, :, 1].min(axis=1) <= south)
    )
    tris = verts[keep]
    if not len(tris):
        return np.zeros((h, w), dtype=bool)
    mask = Image.new('L', (w, h), 0)
    draw = ImageDraw.Draw(mask)
    sx = w / (east - west)
    sz = h / (south - north)
    px = (tris[:, :, 0] - west) * sx
    py = (tris[:, :, 1] - north) * sz
    for i in range(len(tris)):
        draw.polygon([
            (float(px[i, 0]), float(py[i, 0])),
            (float(px[i, 1]), float(py[i, 1])),
            (float(px[i, 2]), float(py[i, 2])),
        ], fill=255)
    if erode_px > 0:
        mask = mask.filter(ImageFilter.MinFilter(erode_px * 2 + 1))
    return np.asarray(mask) > 127


def _sample_z11_box(box, shape_hw):
    h, w = shape_hw
    west, north, east, south = box
    xs = west + (np.arange(w) + 0.5) * (east - west) / w
    zs = north + (np.arange(h) + 0.5) * (south - north) / h
    px, py = global_pixels(xs[[0, -1]], zs[[0, -1]], 11)
    pixels, ox, oy = mosaic('seamlessphoto', 11, px, py, 'jpg', decode_rgb, channels=3)
    ax, az = global_pixels(*np.meshgrid(xs, zs), 11)
    rgb = bilinear(pixels, ax - ox, az - oy)
    return np.nan_to_num(rgb, nan=0.0).astype(np.float32)


def fit_z11_to_kyoto():
    """Fit positive per-channel affine calibration mapping GSI z11 Landsat to Kyoto aerial-mountains."""
    terrain = json.loads((Path(OUT) / 'terrain.json').read_text(encoding='utf-8'))
    wide_meta = terrain['aerialWide']
    box = wide_meta['box']
    ref_file = wide_meta.get('high', {}).get('file', wide_meta['file'])
    with Image.open(Path(OUT) / ref_file) as ref_img:
        w, h = 300, 270
        target = np.asarray(ref_img.convert('RGB').resize((w, h), Image.Resampling.BOX), dtype=np.float32)
    z11 = _sample_z11_box(box, (h, w))
    biwa = rasterize_biwa_mask(box, (h, w), erode_px=0)
    lum_t = target @ np.array([0.2126, 0.7152, 0.0722])
    lum_z = z11 @ np.array([0.2126, 0.7152, 0.0722])
    valid = (~biwa) & (lum_t > 20) & (lum_t < 225) & (lum_z > 20) & (lum_z < 230)
    a = np.zeros(3, dtype=np.float32)
    b = np.zeros(3, dtype=np.float32)
    for c in range(3):
        x = z11[:, :, c][valid]
        y = target[:, :, c][valid]
        x1, x2 = np.percentile(x, [10, 88])
        y1, y2 = np.percentile(y, [10, 88])
        slope = (y2 - y1) / max(x2 - x1, 1.0)
        a[c] = slope
        b[c] = y1 - slope * x1
    return a, b


def sample_kansai_ground_anchor(box):
    """Assemble the overlapping crop from already-harmonized kansai/ground-*.webp sheets."""
    meta_path = Path(OUT) / 'kansai' / 'ground.json'
    if not meta_path.exists():
        return None
    meta = json.loads(meta_path.read_text(encoding='utf-8'))
    west, north, east, south = box
    step = 50.0
    w = max(8, int(round((east - west) / step)))
    h = max(8, int(round((south - north) / step)))
    canvas = np.zeros((h, w, 3), dtype=np.float32)
    covered = np.zeros((h, w), dtype=bool)
    for patch in meta['patches']:
        pw, pn, pe, ps = patch['box']
        if pe <= west or pw >= east or ps <= north or pn >= south:
            continue
        p_path = Path(OUT) / patch['file']
        if not p_path.exists():
            continue
        with Image.open(p_path) as im:
            rgb = np.asarray(im.convert('RGB'), dtype=np.float32)
            alp = np.asarray(im.split()[3]) if im.mode == 'RGBA' else np.full(rgb.shape[:2], 255, dtype=np.uint8)
        ox0 = max(0, int(round((pw - west) / step)))
        oy0 = max(0, int(round((pn - north) / step)))
        sx0 = max(0, int(round((west - pw) / step)))
        sy0 = max(0, int(round((north - pn) / step)))
        cw = min(w - ox0, rgb.shape[1] - sx0)
        ch = min(h - oy0, rgb.shape[0] - sy0)
        if cw <= 0 or ch <= 0:
            continue
        sub_rgb = rgb[sy0:sy0 + ch, sx0:sx0 + cw]
        sub_ok = alp[sy0:sy0 + ch, sx0:sx0 + cw] > 180
        dst = canvas[oy0:oy0 + ch, ox0:ox0 + cw]
        dst[sub_ok] = sub_rgb[sub_ok]
        covered[oy0:oy0 + ch, ox0:ox0 + cw] |= sub_ok
    if covered.mean() < 0.25:
        return None
    if not covered.all():
        fill = np.median(canvas[covered], axis=0)
        canvas[~covered] = fill
    return np.clip(np.round(canvas), 0, 255).astype(np.uint8)


def _box_mean_1d(arr, k, axis):
    pad = [(0, 0)] * arr.ndim
    pad[axis] = (k // 2, k - 1 - k // 2)
    p = np.pad(arr, pad, mode='edge')
    cs = np.cumsum(p, axis=axis, dtype=np.float64)
    z_shape = list(p.shape)
    z_shape[axis] = 1
    cs0 = np.concatenate([np.zeros(z_shape, dtype=np.float64), cs], axis=axis)
    sl_hi = [slice(None)] * arr.ndim
    sl_lo = [slice(None)] * arr.ndim
    sl_hi[axis] = slice(k, None)
    sl_lo[axis] = slice(0, -k)
    return ((cs0[tuple(sl_hi)] - cs0[tuple(sl_lo)]) / k).astype(np.float32)


def _bridge_1d_gaps(weight, jump_rgb, jump_lstd, max_gap, extend_end=3):
    """Seal short gaps along confirmed straight seams so Poisson potentials cannot leak across crossings."""
    h, _ = weight.shape
    w_out = weight.copy()
    jr_out = jump_rgb.copy()
    js_out = jump_lstd.copy()
    active_cols = np.where((weight > 0.2).any(axis=0))[0]
    for col in active_cols:
        idx = np.where(weight[:, col] > 0.2)[0]
        if len(idx) == 0:
            continue
        for k in range(len(idx) - 1):
            a, b = idx[k], idx[k + 1]
            gap = b - a - 1
            if 1 <= gap <= max_gap:
                ja = jump_rgb[a, col]
                jb = jump_rgb[b, col]
                if float(np.dot(ja, jb)) > 0.0:
                    t = np.linspace(0.0, 1.0, gap + 2, dtype=np.float32)[1:-1, None]
                    jr_out[a + 1:b, col] = ja * (1.0 - t) + jb * t
                    js_out[a + 1:b, col] = jump_lstd[a, col] * (1.0 - t) + jump_lstd[b, col] * t
                    w_out[a + 1:b, col] = np.maximum(w_out[a + 1:b, col], 0.85)
        on = w_out[:, col] > 0.2
        padded = np.concatenate([[False], on, [False]])
        starts = np.where(padded[1:] & ~padded[:-1])[0]
        ends = np.where(~padded[1:] & padded[:-1])[0]
        for s, e in zip(starts, ends):
            if e - s < 8:
                continue
            j_top, js_top = jr_out[s, col], js_out[s, col]
            for step in range(1, extend_end + 1):
                r = s - step
                if r >= 0 and w_out[r, col] < 0.2:
                    fade = 1.0 - step / (extend_end + 1.0)
                    jr_out[r, col] = j_top * fade
                    js_out[r, col] = js_top * fade
                    w_out[r, col] = 0.6 * fade
            j_bot, js_bot = jr_out[e - 1, col], js_out[e - 1, col]
            for step in range(1, extend_end + 1):
                r = e - 1 + step
                if r < h and w_out[r, col] < 0.2:
                    fade = 1.0 - step / (extend_end + 1.0)
                    jr_out[r, col] = j_bot * fade
                    js_out[r, col] = js_bot * fade
                    w_out[r, col] = 0.6 * fade
    return jr_out, js_out, w_out


def _detect_straight_seams(img_work, canopy_work, valid_mask, px_metres=40.0, score_lo=4.5):
    forest = ((canopy_work >= 4) & (canopy_work <= 15)).astype(np.float32)
    bw = max(4, int(round(240.0 / px_metres)))
    run_len = max(9, int(round(560.0 / px_metres))) | 1
    max_gap = max(6, int(round(700.0 / px_metres)))
    ext_end = max(2, int(round(160.0 / px_metres)))

    m1 = _box_mean_1d(_box_mean_1d(img_work, 7, 0), 7, 1)
    m2 = _box_mean_1d(_box_mean_1d(img_work * img_work, 7, 0), 7, 1)
    log_std = np.log(np.sqrt(np.maximum(m2 - m1 * m1, 0.0)) + 8.0)

    def detect_axis(arr, lstd, valid, for_f, axis):
        if axis == 0:
            arr = np.transpose(arr, (1, 0, 2))
            lstd = np.transpose(lstd, (1, 0, 2))
            valid = valid.T
            for_f = for_f.T
        h, w, c = arr.shape
        cs = np.concatenate([np.zeros((h, 1, c), dtype=np.float64), np.cumsum(arr, axis=1, dtype=np.float64)], axis=1)
        cs_v = np.concatenate([np.zeros((h, 1), dtype=np.float64), np.cumsum(valid.astype(np.float64), axis=1)], axis=1)
        cs_f = np.concatenate([np.zeros((h, 1), dtype=np.float64), np.cumsum(for_f.astype(np.float64), axis=1)], axis=1)
        cs_s = np.concatenate([np.zeros((h, 1, c), dtype=np.float64), np.cumsum(lstd, axis=1, dtype=np.float64)], axis=1)

        idx = np.arange(w - 1)
        l0, l1 = np.maximum(0, idx - bw + 1), idx + 1
        r0, r1 = idx + 1, np.minimum(w, idx + 1 + bw)
        lw = np.maximum(l1 - l0, 1)[None, :, None]
        rw = np.maximum(r1 - r0, 1)[None, :, None]

        ok = ((cs_v[:, l1] - cs_v[:, l0]) >= bw * 0.65) & ((cs_v[:, r1] - cs_v[:, r0]) >= bw * 0.65)
        mean_l = (cs[:, l1] - cs[:, l0]) / lw
        mean_r = (cs[:, r1] - cs[:, r0]) / rw
        fl = (cs_f[:, l1] - cs_f[:, l0]) / lw[:, :, 0]
        fr = (cs_f[:, r1] - cs_f[:, r0]) / rw[:, :, 0]
        same_lc = (np.abs(fl - fr) < 0.25) & (np.abs(for_f[:, 1:] - for_f[:, :-1]) < 0.5)
        pair_ok = ok & same_lc & valid[:, :-1] & valid[:, 1:]

        step_band = (mean_r - mean_l).astype(np.float32)
        step_1px = (arr[:, 1:] - arr[:, :-1]).astype(np.float32)
        std_jump = ((cs_s[:, r1] - cs_s[:, r0]) / rw - (cs_s[:, l1] - cs_s[:, l0]) / lw).astype(np.float32)

        ok_f = pair_ok.astype(np.float32)
        run_cnt = _box_mean_1d(ok_f, run_len, axis=0) * run_len
        inv_cnt = 1.0 / np.maximum(run_cnt[:, :, None], 1.0)
        run_step = _box_mean_1d(step_band * ok_f[:, :, None], run_len, axis=0) * run_len * inv_cnt
        run_1px = _box_mean_1d(step_1px * ok_f[:, :, None], run_len, axis=0) * run_len * inv_cnt
        run_std = _box_mean_1d(std_jump * ok_f[:, :, None], run_len, axis=0) * run_len * inv_cnt
        run_abs = _box_mean_1d(np.abs(step_band) * ok_f[:, :, None], run_len, axis=0) * run_len * inv_cnt

        mag_band = np.linalg.norm(run_step, axis=2)
        consistency = mag_band / np.maximum(np.linalg.norm(run_abs, axis=2), 1e-3)
        dir_band = run_step / np.maximum(mag_band[:, :, None], 1e-3)
        proj_1px = np.sum(run_1px * dir_band, axis=2)

        p_1px = np.pad(run_1px, ((0, 0), (2, 2), (0, 0)), mode='edge')
        bg_grad = 0.5 * (np.linalg.norm(p_1px[:, 0:w - 1], axis=2) + np.linalg.norm(p_1px[:, 4:w + 3], axis=2))
        sharpness = proj_1px / (bg_grad + 2.2)

        score = np.where(
            (run_cnt >= run_len * 0.45) & (consistency > 0.62) & (proj_1px > 3.2) & (sharpness > 1.65),
            np.minimum(mag_band, proj_1px * 1.7),
            0.0,
        )

        nms_rad = 4
        p_sc = np.pad(score, ((0, 0), (nms_rad, nms_rad)), mode='constant', constant_values=0.0)
        is_max = np.ones_like(score, dtype=bool)
        for dx in range(-nms_rad, nms_rad + 1):
            if dx == 0:
                continue
            nb = p_sc[:, nms_rad + dx:nms_rad + dx + (w - 1)]
            is_max &= (score > nb) if dx < 0 else (score >= nb)

        weight = np.clip((score - score_lo) / 4.5, 0.0, 1.0) * is_max.astype(np.float32)

        min_seg = max(7, int(round(320.0 / px_metres))) | 1
        seg_support = _box_mean_1d((weight > 0.25).astype(np.float32), min_seg, axis=0) * min_seg
        weight = np.where(seg_support >= min_seg * 0.55, weight, 0.0)

        jump_rgb = run_step * weight[:, :, None]
        jump_lstd = np.clip(run_std, -0.75, 0.75) * weight[:, :, None]
        jump_rgb, jump_lstd, _ = _bridge_1d_gaps(weight, jump_rgb, jump_lstd, max_gap=max_gap, extend_end=ext_end)

        if axis == 0:
            jump_rgb = np.transpose(jump_rgb, (1, 0, 2))
            jump_lstd = np.transpose(jump_lstd, (1, 0, 2))
        return jump_rgb, jump_lstd

    jx_rgb, jx_lstd = detect_axis(img_work, log_std, valid_mask, forest, axis=1)
    jy_rgb, jy_lstd = detect_axis(img_work, log_std, valid_mask, forest, axis=0)
    return jx_rgb, jy_rgb, jx_lstd, jy_lstd


def _divergence(jx, jy):
    h, w, c = jx.shape[0], jx.shape[1] + 1, jx.shape[2]
    div = np.zeros((h, w, c), dtype=np.float32)
    div[:, :-1] += jx
    div[:, 1:] -= jx
    div[:-1, :] += jy
    div[1:, :] -= jy
    return div


def harmonize_image(
    image,
    box,
    alpha_mask=None,
    work_step_m=40.0,
    anchor_img=None,
    use_z11_drift_guard=False,
    fill_biwa=True,
    canopy_data=None,
    z11_params=None,
):
    """Remove GSI flight-date seams and black/cloudy Lake Biwa tiles from an RGB PIL Image.

    Returns a harmonized RGB PIL Image of identical size.
    """
    arr_full = np.asarray(image.convert('RGB'), dtype=np.float32)
    fh, fw, _ = arr_full.shape
    west, north, east, south = box
    wh = max(48, int(round((south - north) / work_step_m)))
    ww = max(48, int(round((east - west) / work_step_m)))
    if (wh, ww) != (fh, fw):
        img_w = np.asarray(image.convert('RGB').resize((ww, wh), Image.Resampling.BOX), dtype=np.float32)
    else:
        img_w = arr_full.copy()

    if canopy_data is None:
        canopy_data = load_canopy()
    can_w = sample_canopy(canopy_data, box, (wh, ww))
    biwa_w = rasterize_biwa_mask(box, (wh, ww), erode_px=1)
    lum_w = img_w @ np.array([0.2126, 0.7152, 0.0722])
    valid = (~biwa_w) & (lum_w > 12.0)
    if alpha_mask is not None:
        alp = np.asarray(alpha_mask)
        if alp.shape != (wh, ww):
            alp = np.asarray(Image.fromarray(alp).resize((ww, wh), Image.Resampling.NEAREST))
        valid &= alp > 200

    drift_target = None
    drift_lam = 1e-5
    if anchor_img is not None:
        anc_pil = anchor_img if isinstance(anchor_img, Image.Image) else Image.fromarray(anchor_img)
        drift_target = np.asarray(anc_pil.convert('RGB').resize((ww, wh), Image.Resampling.BOX), dtype=np.float32)
        drift_lam = 1.5e-4
    elif use_z11_drift_guard:
        if z11_params is None:
            z11_params = fit_z11_to_kyoto()
        a_cal, b_cal = z11_params
        cw = max(16, int(round((east - west) / 400.0)))
        ch = max(16, int(round((south - north) / 400.0)))
        z11_c = np.clip(_sample_z11_box(box, (ch, cw)) * a_cal + b_cal, 0, 255)
        drift_target = np.asarray(
            Image.fromarray(z11_c.astype(np.uint8)).filter(ImageFilter.GaussianBlur(7.0)).resize((ww, wh), Image.Resampling.BILINEAR),
            dtype=np.float32,
        )
        drift_lam = 1.5e-5

    total_gain = np.ones((wh, ww, 3), dtype=np.float32)
    total_bias = np.zeros((wh, ww, 3), dtype=np.float32)
    cur = img_w.copy()

    for it in range(3):
        score_lo = 5.0 if it == 0 else (3.8 if it == 1 else 3.2)
        jx_rgb, jy_rgb, jx_lstd, jy_lstd = _detect_straight_seams(cur, can_w, valid, px_metres=work_step_m, score_lo=score_lo)

        if it < 2:
            phi_c = solve_screened_poisson(_divergence(jx_lstd, jy_lstd), lam=8e-6)
            if valid.any():
                phi_c -= np.median(phi_c[valid], axis=0)
            step_gain = np.clip(np.exp(phi_c), 0.78, 1.40)
            new_gain = np.clip(total_gain * step_gain, 0.72, 1.65)
            eff_step = new_gain / total_gain
            total_gain = new_gain
            total_bias = total_bias * eff_step
            cur = np.clip(img_w * total_gain + total_bias, 0, 255)
            jx_rgb, jy_rgb, _, _ = _detect_straight_seams(cur, can_w, valid, px_metres=work_step_m, score_lo=score_lo)

        anchor_rhs = None
        lam_use = 8e-6
        if drift_target is not None:
            anchor_rhs = np.where(valid[:, :, None], drift_target - cur, 0.0)
            lam_use = drift_lam if it == 0 else drift_lam * 0.25
        step_bias = solve_screened_poisson(_divergence(jx_rgb, jy_rgb), anchor_rhs=anchor_rhs, lam=lam_use)
        if drift_target is None and valid.any():
            step_bias -= np.median(step_bias[valid], axis=0)
        total_bias = np.clip(total_bias + step_bias, -110.0, 110.0)
        cur = np.clip(img_w * total_gain + total_bias, 0, 255)

    if (wh, ww) != (fh, fw):
        gain_full = np.stack([
            np.asarray(Image.fromarray(total_gain[:, :, c], mode='F').resize((fw, fh), Image.Resampling.BILINEAR), dtype=np.float32)
            for c in range(3)
        ], axis=2)
        bias_full = np.stack([
            np.asarray(Image.fromarray(total_bias[:, :, c], mode='F').resize((fw, fh), Image.Resampling.BILINEAR), dtype=np.float32)
            for c in range(3)
        ], axis=2)
    else:
        gain_full, bias_full = total_gain, total_bias

    out_rgb = np.clip(arr_full * gain_full + bias_full, 0, 255)

    if fill_biwa:
        biwa_full = rasterize_biwa_mask(box, (fh, fw), erode_px=3 if fw >= 1500 else 1)
        if biwa_full.any():
            blur_r = 1.5 if fw >= 1500 else 1.0
            biwa_soft = np.asarray(
                Image.fromarray((biwa_full.astype(np.uint8) * 255)).filter(ImageFilter.GaussianBlur(blur_r)),
                dtype=np.float32,
            )[:, :, None] / 255.0
            biwa_tone = np.array([32.0, 56.0, 68.0], dtype=np.float32)
            out_rgb = out_rgb * (1.0 - biwa_soft) + biwa_tone * biwa_soft

    return Image.fromarray(np.clip(np.round(out_rgb), 0, 255).astype(np.uint8))
