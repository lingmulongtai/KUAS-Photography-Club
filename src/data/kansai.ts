/** Landmarks to look towards on arrival. All five prefectures share one globe. */
export const KANSAI = [
  {code:'25', ja:'滋賀県', en:'Shiga', lon:135.865, lat:35.007, range:2500, heading:244},
  {code:'26', ja:'京都府', en:'Kyoto', lon:135.769, lat:34.994, range:2700, heading:284},
  {code:'27', ja:'大阪府', en:'Osaka', lon:135.504, lat:34.693, range:2100, heading:245},
  {code:'28', ja:'兵庫県', en:'Hyogo', lon:135.194, lat:34.694, range:2400, heading:309},
  {code:'29', ja:'奈良県', en:'Nara', lon:135.832, lat:34.682, range:2100, heading:274},
] as const;
export type PrefCode = typeof KANSAI[number]['code'];
