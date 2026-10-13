/**
 * Facts about the club, in one place.
 * Edit this file when the meeting room, member count or contacts change.
 */
export const club = {
  name: 'KUAS Photography Club',
  nameJa: '京都先端科学大学 写真サークル',
  shortJa: 'KUAS 写真サークル',
  university: '京都先端科学大学',
  campus: '太秦キャンパス',
  /** Recognised by the student union. */
  recognized: '2025-05-21',
  members: 55,
  membersAsOf: '2025-10-29',
  meetings: {
    day: '毎週金曜',
    dayEn: 'Fridays',
    times: ['18:00〜'],
    room: 'S306',
  },
  tripsPerMonth: 2,
  instagram: {
    handle: 'kuas_photographyclub',
    url: 'https://www.instagram.com/kuas_photographyclub',
  },
  email: '2025m011@kuas.ac.jp',
  github: 'https://github.com/lingmulongtai/KUAS-Photography-Club',
} as const;

/**
 * Forms the club runs itself (Google Forms or Microsoft Forms).
 * Paste each form's share link here; while a link is empty the site points people to Instagram and email instead.
 */
export const forms = {
  /** 見学・入部の申し込み */
  join: '',
  /** 撮影依頼・協賛・取材など、外部の方からのお問い合わせ */
  contact: '',
};

export const nav = [
  { href: '/trips/', ja: '撮影会', en: 'Trips' },
  { href: '/schedule/', ja: 'スケジュール', en: 'Schedule' },
  { href: '/learn/', ja: '写真を学ぶ', en: 'Learn' },
  { href: '/about/', ja: 'サークルについて', en: 'About' },
  { href: '/guidelines/', ja: 'ガイドライン', en: 'Guidelines' },
] as const;
