from datautil import *
from numba import njit


@njit(cache=True)
def plane(poly, n, axis, edge, sign, out):
    k = 0
    for i in range(n):
        a = poly[(i - 1) % n]
        b = poly[i]
        da = (a[axis] - edge) * sign
        db = (b[axis] - edge) * sign
        if (da < 0) != (db < 0):
            t = da / (da - db)
            for j in range(4):
                out[k, j] = a[j] + (b[j] - a[j]) * t
            out[k, axis] = edge
            k += 1
        if db >= 0:
            for j in range(4):
                out[k, j] = b[j]
            k += 1
    return k


@njit(cache=True)
def carve(uv, faces, nx, ny, repeatx, repeaty, write, ids, pg, weights):
    a = np.zeros((12, 4), dtype=np.float64)
    b = a.copy()
    count = 0
    for f in range(len(faces)):
        x = uv[faces[f], 0] * nx
        y = uv[faces[f], 1] * ny
        x0 = int(np.floor(min(x)))
        x1 = int(np.floor(max(x)))
        y0 = int(np.floor(min(y)))
        y1 = int(np.floor(max(y)))
        if not repeatx:
            x0 = min(max(x0, 0), nx - 1)
            x1 = min(max(x1, 0), nx - 1)
        if not repeaty:
            y0 = min(max(y0, 0), ny - 1)
            y1 = min(max(y1, 0), ny - 1)
        if (x1 - x0 + 1) * (y1 - y0 + 1) > 20000:
            raise ValueError("triangle exceeds safe texture repeat range")
        for py in range(y0, y1 + 1):
            for px in range(x0, x1 + 1):
                for j in range(3):
                    a[j, 0] = x[j]
                    a[j, 1] = y[j]
                    a[j, 2] = 1.0 if j == 1 else 0.0
                    a[j, 3] = 1.0 if j == 2 else 0.0
                n = 3
                if x1 != x0:
                    if repeatx or px > 0:
                        n = plane(a, n, 0, float(px), 1.0, b)
                        a, b = b, a
                    if repeatx or px < nx - 1:
                        n = plane(a, n, 0, float(px + 1), -1.0, b)
                        a, b = b, a
                if y1 != y0:
                    if repeaty or py > 0:
                        n = plane(a, n, 1, float(py), 1.0, b)
                        a, b = b, a
                    if repeaty or py < ny - 1:
                        n = plane(a, n, 1, float(py + 1), -1.0, b)
                        a, b = b, a
                for k in range(1, n - 1):
                    area = (a[k, 2] - a[0, 2]) * (a[k + 1, 3] - a[0, 3]) - (
                        a[k, 3] - a[0, 3]
                    ) * (a[k + 1, 2] - a[0, 2])
                    if area <= 1e-15:
                        continue
                    if write:
                        ids[count] = f
                        pg[count, 0] = px
                        pg[count, 1] = py
                        for j, v in enumerate((0, k, k + 1)):
                            weights[count, j, 0] = a[v, 2]
                            weights[count, j, 1] = a[v, 3]
                    count += 1
    return count


def split(uv, faces, nx, ny, rx, ry):
    args = (uv, faces, nx, ny, rx, ry)

    def arrays(n):
        return (
            np.empty(n, np.int64),
            np.empty((n, 2), np.int32),
            np.empty((n, 3, 2), np.float64),
        )

    n = carve(*args, False, *arrays(0))
    out = arrays(n)
    assert carve(*args, True, *out) == n
    ids, p, w = out
    a = w[:, 1] - w[:, 0]
    b = w[:, 2] - w[:, 0]
    area = a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]
    err = np.max(np.abs(np.bincount(ids, weights=area, minlength=len(faces)) - 1))
    assert err < 1e-8, ("triangle coverage", err)
    return ids, p, w, err
