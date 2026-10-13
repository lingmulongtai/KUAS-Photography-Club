"""Read a remote zip's directory and individual entries with HTTP range requests."""
import json
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib

def get(url, start, end, tries=6):
    req = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if len(data) == end - start + 1:
                return data
        except (OSError, urllib.error.URLError):
            if attempt == tries - 1:
                raise
        time.sleep(2 ** attempt)
    raise RuntimeError(f'short read {url} {start}-{end}')

def size(url):
    req = urllib.request.Request(url, method='HEAD')
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers['Content-Length'])

def directory(url):
    n = size(url)
    tail = get(url, max(0, n - 65536), n - 1)
    i = tail.rfind(b'PK\x05\x06')
    cd_size, cd_off = struct.unpack('<II', tail[i + 12:i + 20])
    entries_total = struct.unpack('<H', tail[i + 10:i + 12])[0]
    if cd_off == 0xFFFFFFFF or cd_size == 0xFFFFFFFF or entries_total == 0xFFFF:
        j = tail.rfind(b'PK\x06\x06')
        entries_total, cd_size, cd_off = struct.unpack('<QQQ', tail[j + 32:j + 56])
    cd = get(url, cd_off, cd_off + cd_size - 1)
    out = []
    p = 0
    while p < len(cd) and cd[p:p + 4] == b'PK\x01\x02':
        method, = struct.unpack('<H', cd[p + 10:p + 12])
        csize, usize = struct.unpack('<II', cd[p + 20:p + 28])
        fnl, exl, cml = struct.unpack('<HHH', cd[p + 28:p + 34])
        off, = struct.unpack('<I', cd[p + 42:p + 46])
        name = cd[p + 46:p + 46 + fnl].decode('utf-8', 'replace')
        extra = cd[p + 46 + fnl:p + 46 + fnl + exl]
        q = 0
        while q + 4 <= len(extra):
            hid, hl = struct.unpack('<HH', extra[q:q + 4])
            if hid == 1:
                vals = []
                data = extra[q + 4:q + 4 + hl]
                k = 0
                for flag in (usize, csize, off):
                    if flag == 0xFFFFFFFF:
                        vals.append(struct.unpack('<Q', data[k:k + 8])[0]); k += 8
                    else:
                        vals.append(flag)
                usize, csize, off = vals
            q += 4 + hl
        out.append({'name': name, 'method': method, 'csize': csize, 'usize': usize, 'off': off})
        p += 46 + fnl + exl + cml
    return out

def read(url, e):
    h = get(url, e['off'], e['off'] + 29)
    fnl, exl = struct.unpack('<HH', h[26:30])
    start = e['off'] + 30 + fnl + exl
    data = get(url, start, start + e['csize'] - 1) if e['csize'] else b''
    if e['method'] == 0:
        return data
    return zlib.decompress(data, -15)

if __name__ == '__main__':
    url, out = sys.argv[1], sys.argv[2]
    d = directory(url)
    json.dump(d, open(out, 'w'))
    print(len(d), 'entries')
