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
 * Where the join form sends its answers.
 * - `endpoint`: any service that accepts a form POST (Formspree, Getform, a Google Apps Script web app…).
 *   Leave it empty and the form will open the member's mail app with the answers filled in instead.
 * - `googleFormUrl`: optional. If set, a link to the Google Form is shown next to the form.
 */
export const joinForm = {
  endpoint: '',
  googleFormUrl: '',
} as const;

export const nav = [
  { href: '/trips/', ja: '撮影会', en: 'Trips' },
  { href: '/learn/', ja: '写真を学ぶ', en: 'Learn' },
  { href: '/about/', ja: 'サークルについて', en: 'About' },
  { href: '/guidelines/', ja: 'ガイドライン', en: 'Guidelines' },
] as const;
