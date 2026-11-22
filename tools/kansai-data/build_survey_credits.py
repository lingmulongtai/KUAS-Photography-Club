"""Resolve the catalogue's actual municipal source releases and their reuse terms."""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2] / 'public/kansai/surveys'
CENTRE = 'https://www.geospatial.jp/ckan'
POLICY = 'https://www.mlit.go.jp/plateau/site-policy/'
EXPO_TERMS = 'https://gic-plateau.s3.ap-northeast-1.amazonaws.com/2025/expo-doc/3d-license/license.pdf'
SLUGS = {'25204': 'omihachiman-shi', '27202': 'kishiwadashi'}


def credits():
    layers = json.loads((ROOT / 'index.json').read_text(encoding='utf-8'))['layers']
    packages = set()
    for layer in layers:
        nodes = json.loads((ROOT / layer['file']).read_text())['root']['children']
        for node in nodes:
            code, city, year = re.search(r'/(\d{5})_([a-z-]+)_(?:city|pref)_(\d{4})_',
                                        node['content']['uri']).groups()
            packages.add('plateau-' + '-'.join([code, SLUGS.get(code, city), year]))

    def read(package):
        with urlopen(CENTRE + '/api/3/action/package_show?id=' + package, timeout=60) as r:
            data = json.load(r)['result']
        code = package.split('-')[1]
        if code == '27999':
            assert data['license_id'] == 'ol' and any(r['url'] == EXPO_TERMS for r in data['resources'])
            terms = EXPO_TERMS
        else:
            assert data['license_id'] == 'plateau' and data['license_url'].rstrip('/') == POLICY.rstrip('/'), package
            terms = POLICY
        return {'code': code, 'title': data['title'], 'url': CENTRE + '/dataset/' + package, 'terms': terms}
    with ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(read, sorted(packages)))
    (ROOT / 'sources.json').write_text(json.dumps(records, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    print(len(records), 'dataset reuse declarations')


if __name__ == '__main__':
    credits()
