/** OpenStreetMap mapped sports outlines, metres east/south about KAMEOKA_CENTER.
 * OSM contributors (ODbL); ways 1525060289, 1525059749, 1525165359. */
export const KAMEOKA_FIELDS = {
  "baseballNorth": [
    [
      -330.61,
      -287.51
    ],
    [
      -282.03,
      -303.15
    ],
    [
      -239.35,
      -288.49
    ],
    [
      -222.18,
      -259.67
    ],
    [
      -225.61,
      -187.37
    ],
    [
      -319.33,
      -179.07
    ],
    [
      -333.07,
      -186.88
    ],
    [
      -335.03,
      -196.65
    ]
  ],
  "main": [
    [
      -333.32,
      -162.95
    ],
    [
      -335.76,
      -75.01
    ],
    [
      -180.22,
      -54.01
    ],
    [
      -166.97,
      -164.41
    ]
  ],
  "baseballSouth": [
    [
      -10.72,
      190.87
    ],
    [
      49.25,
      201.59
    ],
    [
      29.14,
      303.93
    ],
    [
      15.69,
      302.55
    ],
    [
      -31.06,
      249.85
    ],
    [
      -21.83,
      204.41
    ]
  ]
} as const;

/** Approximate painted perimeter from the shipped GSI orthophoto, within about 4 m.
 * The image does not establish a surveyed court count. */
export const KAMEOKA_TENNIS = [[74,195],[112,201],[99,269],[64,262]] as const;
