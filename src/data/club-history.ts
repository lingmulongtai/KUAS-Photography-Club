type Localized = { ja: string; en: string };

export type HistoryIllustration = 'camera' | 'mountains' | 'badge' | 'campus' | 'festival' | 'frames';
type Milestone = {
  date?: string;
  /** the year it belongs to, for undated entries (shown under that year) */
  year?: string;
  /** a turning point, drawn larger in the timeline */
  highlight?: boolean;
  label: Localized;
  title: Localized;
  detail: Localized;
  illustration: HistoryIllustration;
};

export const clubHistory: readonly Milestone[] = [
  {
    date: '2025-05', label: { ja: '2025年5月', en: 'May 2025' }, illustration: 'camera',
    title: { ja: '写真同好会として活動開始', en: 'A student photography circle begins' },
    detail: { ja: '現在の写真部は、写真を楽しむ学生が集まる同好会としてスタートしました。', en: 'The current club began as a student circle for people who wanted to enjoy photography together.' },
  },
  {
    year: '2025', label: { ja: '同好会時代', en: 'During our circle years' }, illustration: 'mountains',
    title: { ja: '初めての撮影会は、箕面大滝へ', en: 'Our first photo outing: Minoh Falls' },
    detail: { ja: '部員と一緒に出かけて撮る活動は、大阪の箕面大滝から始まりました。', en: 'We held our first group photo outing at Minoh Falls in Osaka.' },
  },
  {
    date: '2026-04', label: { ja: '2026年4月', en: 'April 2026' }, illustration: 'badge', highlight: true,
    title: { ja: '同好会から正式な部活動へ', en: 'The circle becomes a recognized club' },
    detail: { ja: '学友会公認の部活動として、京都先端科学大学写真部の活動が始まりました。', en: 'We became an officially recognized student club through the university’s student association.' },
  },
  {
    date: '2026-07-12', label: { ja: '2026年7月12日', en: 'July 12, 2026' }, illustration: 'campus',
    title: { ja: 'オープンキャンパスの撮影に協力', en: 'Photographing the university open campus' },
    detail: { ja: '大学のオープンキャンパスに撮影で協力し、当日の様子を写真に残しました。', en: 'We helped document the university’s open campus through photographs.' },
  },
  {
    date: '2026-08-08', label: { ja: '2026年8月8日', en: 'August 8, 2026' }, illustration: 'festival',
    title: { ja: '太秦キャンパスの龍頭祭に出展', en: 'Taking part in the Ryūto Festival' },
    detail: { ja: '太秦キャンパスで開かれた龍頭祭に出展し、模擬店を運営しました。', en: 'At the Uzumasa campus festival, we took part by running a stall.' },
  },
  {
    date: '2026-10-24', label: { ja: '2026年10月24日〜25日', en: 'October 24–25, 2026' }, illustration: 'frames',
    title: { ja: '龍尾祭で写真を展示、撮影体験も', en: 'Prints and a photo booth at the Ryūbi Festival' },
    detail: { ja: '京都亀岡キャンパスの龍尾祭で、部員の作品を展示。来場者が楽しめる撮影ブースも設けました。', en: 'At the Kyoto Kameoka campus festival, we displayed members’ work and set up a photo booth for visitors.' },
  },
];
