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
  /** Public contact address (the club's Gmail; messages are forwarded to the organisers). */
  email: 'photography.club.in.kuas@gmail.com',
  github: 'https://github.com/lingmulongtai/KUAS-Photography-Club',
} as const;

/**
 * Forms the club runs itself. Paste a form's share link here; while it is empty the site points
 * people to Instagram and email instead. Outside parties contact the club by Instagram DM or email only.
 */
export const forms = {
  /** 見学・入部の申し込み (Microsoft Forms, KUAS accounts only; English for now) */
  join: 'https://forms.cloud.microsoft/r/ZGB8GdNTUC',
};

export const nav = [
  { href: '/trips/', ja: '撮影会', en: 'Trips' },
  { href: '/schedule/', ja: 'スケジュール', en: 'Schedule' },
  { href: '/learn/', ja: '写真を学ぶ', en: 'Learn' },
  { href: '/about/', ja: 'サークルについて', en: 'About' },
  { href: '/guidelines/', ja: 'ガイドライン', en: 'Guidelines' },
] as const;
