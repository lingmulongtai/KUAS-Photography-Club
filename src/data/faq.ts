import { club } from './club.ts';

/**
 * Questions people ask before visiting. Used by the FAQ page, the home page (entries marked
 * `home`) and the join page. Answers only state what the club has confirmed; add a question here
 * once the organizers have agreed its answer.
 */
export interface FaqEntry {
  q: string;
  a: string;
  /** shown in the short list on the home page */
  home?: boolean;
}

const fee = club.feePerSemester;

export const faq: { ja: FaqEntry[]; en: FaqEntry[] } = {
  ja: [
    { q: 'カメラを持っていなくても大丈夫？', a: '大丈夫です。スマートフォンで参加できます。共有機材は整備中です。写真部では、カメラを持っていない人も使える共有カメラの購入を目指しています。', home: true },
    { q: '留学生でも参加できますか？ / Can international students join?', a: 'もちろんです。日本人と留学生が一緒に活動しています。English is welcome at meetings and on trips.', home: true },
    { q: '費用はかかりますか？', a: `部費は半期${fee.toLocaleString('ja-JP')}円です。撮影会の交通費や入場料等は別途各自負担です。`, home: true },
    { q: '毎回参加しないといけませんか？', a: '撮影会は来られるときだけで大丈夫です。参加・途中参加・途中退出やキャンセルについては、事前に運営と調整してください。', home: true },
    { q: '途中の学期からでも入れますか？', a: '見学を希望する時期を運営にご相談ください。正式な入部に必要な手続きは、運営からご案内します。' },
    { q: 'ミーティングはいつ、どこでありますか？', a: `通常は${club.meetings.day} ${club.meetings.times.join(' / ')}、${club.campus} ${club.meetings.room} 教室です。休会や教室変更があるので、来る前にスケジュールを確認してください。` },
    { q: '見学だけでも行っていいですか？', a: '見学だけでも歓迎です。フォームか Instagram の DM で、見学したい日を教えてください。' },
    { q: 'LINE などのグループに入れば入部完了ですか？', a: 'いいえ。連絡用チャットへの参加だけでは、正式な入部手続きは完了しません。必要な手続きは運営からご案内します。活動登録や保険の手続き・適用条件も運営にご確認ください。' },
    { q: '学外の人や卒業生も参加できますか？', a: '見学は京都先端科学大学の在学生・留学生を受け付けています。教職員、学外の方、卒業生等の参加・正式入部の可否は、お問い合わせページから運営にご相談ください。' },
  ],
  en: [
    { q: 'Do I need a camera?', a: 'No. A smartphone is enough to take part. Shared cameras and other equipment are still being prepared; ask what is available.', home: true },
    { q: 'Can international students join?', a: 'Yes. Japanese and international students take part together, and English is welcome at meetings and on trips.', home: true },
    { q: 'How much does it cost?', a: `The club fee is ¥${fee.toLocaleString('en-US')} per semester. Each member pays their own travel and admission costs for outings.`, home: true },
    { q: 'Do I have to come every time?', a: 'No. Join outings when you can. Arrange participation, late arrival, early departure or cancellation with the organizers in advance.', home: true },
    { q: 'Can I join partway through the semester?', a: 'Tell the organizers when you would like to visit. They will explain the formal membership procedures.' },
    { q: 'When and where are meetings?', a: `Usually ${club.meetings.dayEn} at ${club.meetings.times[0].replace('〜', '')} in room ${club.meetings.room}, Uzumasa Campus. Meetings are sometimes cancelled or moved, so check the schedule before you come.` },
    { q: 'Can I just visit?', a: 'Yes, visitors are welcome. Tell us the day you would like to visit using the form or an Instagram DM.' },
    { q: 'Does joining the LINE group make me a member?', a: 'No. Joining a LINE or other communication chat does not complete membership. The organizers will explain the required procedures. Ask them about activity registration, insurance procedures and eligibility.' },
    { q: 'Can staff, alumni or people outside KUAS take part?', a: 'Visits are open to KUAS students, including international students. Staff, alumni and people outside KUAS should contact the organizers about participation and eligibility for formal membership.' },
  ],
};
