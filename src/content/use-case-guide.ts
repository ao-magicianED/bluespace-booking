/**
 * トップページ「用途から探す」の案内。
 * 各拠点ページに書いてある設備・定員の事実だけを根拠にする（新しい事実は書かない）。
 * 並びと組み合わせは、外部予約サイトを含む実際の予約の用途の多さ（2026-09 集計）を参考にしている。
 */
export const USE_CASE_GUIDE: { use: string; slugs: string[]; point: string }[] = [
  {
    use: "会議・研修・セミナー（〜20名）",
    slugs: ["ueno-okachimachi", "ueno-4a", "ueno-4b", "kanda", "keisei-koiwa"],
    point: "プロジェクター・ホワイトボード・高速光Wi-Fiを備えた最大20名の5拠点",
  },
  {
    use: "20〜30名の研修・セミナー",
    slugs: ["ueno-4a", "ueno-4b"],
    point: "上野駅前4Aと4Bを連結すると最大30名規模に対応",
  },
  {
    use: "少人数の会議・面接・Web会議",
    slugs: ["nishi-shinjuku", "shirokane-takanawa"],
    point: "Web会議用カメラと55インチモニター（西新宿403・最大12名）、最大6名の白金高輪",
  },
  {
    use: "ダンス練習・演劇の稽古・レッスン",
    slugs: ["kanda"],
    point: "全面ミラーとBluetoothスピーカーを備えた神田駅徒歩1分の拠点",
  },
  {
    use: "撮影・配信・収録",
    slugs: ["nishi-shinjuku", "ueno-4b", "ueno-okachimachi"],
    point: "グリーンスクリーン（西新宿403）、撮影機材一式（上野駅前4B）、TVロケ実績（上野御徒町）",
  },
  {
    use: "パーティー・懇親会・ボードゲーム会",
    slugs: ["keisei-koiwa", "ueno-okachimachi"],
    point: "全拠点で飲食の持ち込み自由。京成小岩はボードゲーム備品と80インチスクリーンあり",
  },
  {
    use: "サロン・施術（エステ・ネイル・整体）",
    slugs: ["shirokane-takanawa"],
    point: "施術ベッド（オプション）・姿見鏡・水回りのある白金高輪",
  },
  {
    use: "テレワーク・自習・1人での作業",
    slugs: ["ueno-okachimachi", "ueno-4b", "shirokane-takanawa"],
    point: "30分単位・24時間いつでも予約でき、空きがあれば当日の直前まで受付",
  },
];
