/**
 * Short comments from members for the About page ("部員の声").
 *
 * Add a comment only with the member's agreement, written as they said it, and with the name
 * and year shown the way they asked (a nickname or no name is fine). The section stays hidden
 * while this list is empty.
 */
export interface MemberVoice {
  quote: string;
  quoteEn?: string;
  /** e.g. 'Hana' or '3回生'; leave out to show no name */
  who?: string;
  whoEn?: string;
}

export const memberVoices: MemberVoice[] = [
  // { quote: 'カメラを持っていなかったけど、スマホで撮った写真を褒めてもらえたのがうれしかった。', quoteEn: '…', who: '2回生', whoEn: 'Second-year student' },
];
