/** The "learn photography" pages, in reading order. */
export const learnTopics = [
  {
    slug: 'shutter-speed',
    no: '01',
    en: 'SHUTTER SPEED',
    title: 'シャッタースピード',
    summary: '動きを止めるか、流すか。花火・光跡・手ブレまで、時間の写し方。',
    fb: 'radial-gradient(circle at 40% 35%, rgba(255,176,96,.45), transparent 28%), radial-gradient(circle at 70% 25%, rgba(140,200,255,.35), transparent 22%), linear-gradient(#0c1129, #03050d)',
  },
  {
    slug: 'aperture',
    no: '02',
    en: 'APERTURE & BOKEH',
    title: '絞りとボケ',
    summary: 'f値・被写界深度・玉ボケ。背景をぼかす仕組みと、くっきり写す仕組み。',
    fb: 'radial-gradient(circle at 28% 38%, rgba(255,184,106,.5), transparent 13%), radial-gradient(circle at 62% 30%, rgba(116,179,255,.4), transparent 11%), radial-gradient(circle at 80% 62%, rgba(255,115,179,.4), transparent 12%), #05060b',
  },
  {
    slug: 'focal-length',
    no: '03',
    en: 'FOCAL LENGTH',
    title: '焦点距離と遠近感',
    summary: '24mm と 85mm で顔の写り方が変わるのはなぜ？ 画角・距離・圧縮効果。',
    fb: 'linear-gradient(135deg, #3a3129, #15120f 70%)',
  },
  {
    slug: 'darkroom',
    no: '04',
    en: 'DEVELOPING',
    title: '現像',
    summary: '暗室でのフィルム現像とプリント、そしてデジタルの RAW 現像。',
    fb: 'radial-gradient(circle at 25% 0%, rgba(255,46,31,.6), transparent 65%), #140505',
  },
] as const;
