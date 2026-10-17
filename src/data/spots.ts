/** Shared place IDs for content, admin and hero pins. */
export const SPOTS = [
  { id: 'tower', rank: 1, ja: '京都タワー', en: 'Kyoto Tower', lat: 34.9875524, lon: 135.7593295, above: 140 },
  { id: 'station', rank: 4, ja: '京都駅', en: 'Kyoto Station', lat: 34.9858, lon: 135.7588, above: 72 },
  { id: 'toji', rank: 2, ja: '東寺', en: 'Toji', lat: 34.98016, lon: 135.74757, above: 64 },
  { id: 'yasaka', rank: 3, ja: '八坂の塔', en: 'Yasaka Pagoda', lat: 34.99823, lon: 135.77905, above: 52 },
  { id: 'kiyomizu', rank: 3, ja: '清水寺', en: 'Kiyomizu-dera', lat: 34.9950586, lon: 135.7838348, above: 40 },
  { id: 'gion', rank: 2, ja: '祇園', en: 'Gion', lat: 35.0024476, lon: 135.7748211, above: 18 },
  { id: 'kawaramachi', rank: 1, ja: '四条河原町', en: 'Shijo-Kawaramachi', lat: 35.0037796, lon: 135.76932, above: 46 },
  { id: 'sanjo', rank: 2, ja: '三条大橋', en: 'Sanjo Bridge', lat: 35.0090445, lon: 135.7717206, above: 26 },
  { id: 'gojo', rank: 2, ja: '五条大橋', en: 'Gojo Bridge', lat: 34.9956954, lon: 135.767913, above: 26 },
  { id: 'kamo', rank: 3, ja: '鴨川', en: 'Kamo River', lat: 35.0185, lon: 135.7716, above: 18 },
  { id: 'nijo', rank: 1, ja: '二条城', en: 'Nijo Castle', lat: 35.0140076, lon: 135.7485369, above: 34 },
  { id: 'gosho', rank: 2, ja: '京都御所', en: 'Imperial Palace', lat: 35.0241380, lon: 135.7621408, above: 30 },
  { id: 'heian', rank: 3, ja: '平安神宮', en: 'Heian Shrine', lat: 35.0160393, lon: 135.7824541, above: 30 },
  { id: 'kinkaku', rank: 2, ja: '金閣寺', en: 'Kinkaku-ji', lat: 35.0395092, lon: 135.7284548, above: 24 },
  { id: 'ryoanji', rank: 2, ja: '龍安寺', en: 'Ryoan-ji', lat: 35.0345180, lon: 135.7182196, above: 30 },
  { id: 'arashiyama', rank: 2, ja: '嵐山', en: 'Arashiyama', lat: 35.0128713, lon: 135.6777623, above: 80 },
  { id: 'atago', rank: 3, ja: '愛宕山', en: 'Mt. Atago', lat: 35.0600453, lon: 135.6342851, above: 60 },
  { id: 'daimonji', rank: 2, ja: '大文字', en: 'Daimonji Firebed', lat: 35.0230738, lon: 135.804312, above: 35 },
  { id: 'kuas', rank: 0, ja: '太秦キャンパス', en: 'KUAS Uzumasa Campus', lat: 35.0099245, lon: 135.7184382, above: 48, action: true },
  { id: 'kameoka', rank: 0, ja: '亀岡キャンパス', en: 'KUAS Kameoka Campus', lat: 34.9936366, lon: 135.5532771, above: 40 },
  { id: 'sonobe', rank: 4, ja: '園部駅周辺', en: 'Sonobe Station area', lat: 35.1023071, lon: 135.4833287, above: 30 },
  { id: 'yamashina', rank: 4, ja: '山科駅周辺', en: 'Yamashina Station area', lat: 34.9925975, lon: 135.8166736, above: 30 },
  { id: 'takeda', rank: 4, ja: '竹田・京都南部', en: 'Takeda / southern Kyoto', lat: 34.9561575, lon: 135.7561415, above: 30 },
  { id: 'philosopher', rank: 4, ja: '哲学の道・南側', en: 'Philosopher’s Path, south', lat: 35.0168503, lon: 135.7959795, above: 25 },
] as const;

export type SpotId = (typeof SPOTS)[number]['id'];
export const SPOT_IDS = SPOTS.map((s) => s.id) as [SpotId, ...SpotId[]];
