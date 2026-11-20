// Copied verbatim from the club's public Instagram profile on 2026-11-19.
// Keep display line breaks; only normalize those breaks for the meta description.
const biography = [
  "京都先端科学大学 写真部",
  "カメラを持ってなくても大丈夫！ゆるく楽しく活動中",
  "月２回の撮影会/ 学祭での展示",
  "学部・学年・国籍問わず仲良しです！",
  "入部希望やご質問など、お気軽にDMください💌",
  "International students are welcome!",
].join('\n');

export const homeJa = {
  title: "京都先端科学大学写真部📸(KUAS Photography Club)",
  biography,
  description: biography.replace(/\r\n?|\n/g, ' '),
  /** A phone shows this sentence and the traits instead of the whole profile (same facts). */
  short: 'カメラがなくても大丈夫。撮影会と、学祭での展示をしています。',
  traits: ['カメラなしでもOK', '撮影会', '学祭で展示', '留学生歓迎'],
  traitsEn: ['No camera needed', 'Photo outings', 'Campus festival exhibition', 'International students welcome'],
  /** The DM invitation shown beside the official Instagram account. */
  dm: '入部希望やご質問など、お気軽にDMください',
} as const;
