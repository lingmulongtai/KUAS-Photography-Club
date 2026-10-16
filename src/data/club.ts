/**
 * Facts about the club, in one place.
 * Edit this file when the meeting room, member count or contacts change.
 */
export const club = {
  name: 'KUAS Photography Club',
  nameJa: '京都先端科学大学 写真部',
  shortJa: 'KUAS 写真部',
  university: '京都先端科学大学',
  campus: '太秦キャンパス',
  members: 74,
  membersAsOf: '2026年10月',
  meetings: {
    day: '毎週金曜',
    dayEn: 'Fridays',
    times: ['18:00〜'],
    room: 'S306',
  },
  feePerSemester: 1000,
  instagram: {
    handle: 'kuas_photographyclub',
    url: 'https://www.instagram.com/kuas_photographyclub',
  },
  /** Public contact address. */
  email: 'photography.club.in.kuas@gmail.com',
  github: 'https://github.com/lingmulongtai/KUAS-Photography-Club',
} as const;

/**
 * Forms the club runs itself. Paste a form's share link here; while it is empty the site points
 * people to Instagram and email instead. Outside parties contact the club by Instagram DM or email only.
 */
export const forms = {
  /** Microsoft Forms. Sign-in required; questions, language and permitted account scope unverified. */
  join: 'https://forms.cloud.microsoft/r/ZGB8GdNTUC',
};

export const nav = [
  { href: '/trips/', ja: '撮影会', en: 'Trips' },
  { href: '/schedule/', ja: 'スケジュール', en: 'Schedule' },
  { href: '/learn/', ja: '写真を学ぶ', en: 'Learn' },
  { href: '/about/', ja: '写真部について', en: 'About' },
  { href: '/guidelines/', ja: 'ガイドライン', en: 'Guidelines' },
] as const;
