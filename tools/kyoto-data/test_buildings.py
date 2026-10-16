"""Exporter regressions: python -m unittest discover -s tools/kyoto-data -p test_*.py."""
import gzip
import json
import os
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import build_buildings as B


class BuildingExportTest(unittest.TestCase):
    def test_sagano_houses_survive_without_adding_sheds_or_far_city_detail(self):
        house = {'class': '普通建物', 'height': 6}
        self.assertTrue(B.west_corridor(-6500, -1300))
        self.assertTrue(B.keep(house, 45, -6500, -1300))
        self.assertFalse(B.keep(house, 10, -6500, -1300))
        self.assertFalse(B.keep({'class': '普通無壁舎', 'height': 3}, 45, -6500, -1300))
        self.assertFalse(B.west_corridor(-6500, 2500))
        self.assertFalse(B.keep(house, 45, -6500, 2500))

    def test_export_ground_matches_near_then_regional_edge_blending(self):
        with tempfile.TemporaryDirectory() as out:
            def grid(name, value):
                # Constant 5x5 grid, encoded as the shipped two byte-plane delta stream.
                d = np.zeros((5, 5), dtype=np.int16)
                d[0, 0] = value * 10
                u = d.view(np.uint16).flatten()
                with gzip.open(os.path.join(out, name), 'wb') as f:
                    f.write((u & 255).astype(np.uint8).tobytes() + (u >> 8).astype(np.uint8).tobytes())
                return {'box': [0, 0, 1200, 1200], 'nx': 5, 'nz': 5, 'step': 300, 'file': name}
            meta = {'far': grid('far', 10), 'near': grid('near', 20),
                    'arashiyama': {'elevation': grid('regional', 40)}}
            with open(os.path.join(out, 'terrain.json'), 'w') as f:
                json.dump(meta, f)
            with patch.object(B, 'OUT', out):
                height = B.heightfield()
            self.assertEqual(height(600, 600), 40)
            # 60m from edge: near weight=.104, regional weight=.5.
            self.assertAlmostEqual(height(60, 600), 25.52)
            self.assertEqual(height(0, 600), 10)


if __name__ == '__main__':
    unittest.main()
