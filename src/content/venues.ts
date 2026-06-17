/**
 * 拠点の紹介コンテンツ（写真・コピー・設備・アクセス等）。
 * 運用データ（料金・営業時間・カレンダーID）はSupabaseのvenuesテーブル、
 * 見せるコンテンツはこのファイル＋public/venues/ の写真で管理する。
 * 写真の取り込みは scripts/import-photos.mjs（コーポレートサイトの素材から圧縮コピー）。
 */

export type GalleryCategory = {
  id: string;
  label: string;
  images: { src: string; alt: string }[];
};

export type VenueContent = {
  slug: string;
  /** Googleビジネスプロフィールと完全一致させる正式名称 */
  name: string;
  badge: string;
  station: string;
  capacityShort: string;
  address: string;
  postalCode: string;
  addressLocality: string;
  catchCopy: string;
  overview: string;
  uses: string[];
  amenities: { label: string; note: string }[];
  accessRows: { label: string; main: string; sub: string }[];
  nearby: { name: string; category: string; emoji: string; query: string }[];
  reviews: { initial: string; quote: string; name: string; role: string }[];
  faqs: { q: string; a: string }[];
  /** Googleマップ「共有→地図を埋め込む」の公式pb URL。無い場合は空文字（mapQueryフォールバック） */
  mapEmbedSrc: string;
  mapQuery: string;
  geo: { lat: number; lng: number } | null;
  photos: {
    hero: string;
    categories: GalleryCategory[];
    accessMap: string | null;
  };
};

/** 全拠点共通のFAQ（予約システムの仕様に基づく） */
const COMMON_FAQS = [
  {
    q: "予約は何分単位でできますか？",
    a: "30分単位でご予約いただけます。連続した時間をまとめて選択でき、最大8時間まで一度に予約できます。",
  },
  {
    q: "支払い方法は何がありますか？",
    a: "クレジットカード決済（Visa / Mastercard / JCB / AMEX等）に対応しています。決済が完了した時点で予約確定となります。",
  },
  {
    q: "キャンセルはできますか？",
    a: "利用日の8日以上前は全額返金、7〜2日前は50%返金、前日・当日は返金不可です。会員登録済みの方はマイページからワンクリックでキャンセル・自動返金ができます。",
  },
  {
    q: "領収書は発行できますか？",
    a: "会員登録のうえマイページから、宛名・但し書きを指定して発行できます（インボイス制度の登録番号記載・PDF保存可）。",
  },
  {
    q: "入室方法は？",
    a: "ご予約確定後にお送りする確認メールにて、入室方法をご案内します。24時間営業・無人運営のため、スタッフの立ち会いはありません。",
  },
  {
    q: "当日予約はできますか？",
    a: "空きがあれば利用開始の直前（1分前）までご予約いただけます。さらに当日予約は10%OFFの直前割が自動適用されます。",
  },
  {
    q: "定期利用の割引はありますか？",
    a: "はい。毎週・毎月など定期でのご利用は常時10%OFFでご提供しています。ご希望の頻度をお問い合わせフォームからお知らせいただければ、お見積もりをお送りします。",
  },
];

/** 取り込み済み写真からカテゴリ配列を組み立てるヘルパー */
function gallery(
  slug: string,
  name: string,
  spec: { id: string; label: string; count: number }[]
): GalleryCategory[] {
  return spec
    .filter((s) => s.count > 0)
    .map((s) => ({
      id: s.id,
      label: s.label,
      images: Array.from({ length: s.count }, (_, i) => ({
        src: `/venues/${slug}/${s.id}-${i + 1}.jpg`,
        alt: `${name} ${s.label} ${String(i + 1).padStart(2, "0")}`,
      })),
    }));
}

const NEARBY_TEMPLATE = (st: string, superNote = "惣菜・お弁当") => [
  { name: "松屋・吉野家", category: "牛丼・定食チェーン", emoji: "🍱", query: `松屋 ${st}` },
  { name: "セブンイレブン", category: "コンビニ", emoji: "🏪", query: `セブンイレブン ${st}` },
  { name: "ローソン / ファミマ", category: "コンビニ", emoji: "🏪", query: `ローソン ファミリーマート ${st}` },
  { name: "100円ショップ", category: "ダイソー / キャンドゥ", emoji: "🛍️", query: `100円ショップ ${st}` },
  { name: "スーパー", category: superNote, emoji: "🥗", query: `スーパー ${st}` },
  { name: "ドラッグストア", category: "医薬品・日用品", emoji: "💊", query: `ドラッグストア ${st}` },
  { name: "カフェ", category: "休憩・打ち合わせ", emoji: "☕", query: `カフェ ${st}` },
  { name: "コインパーキング", category: "お車でお越しの方", emoji: "🅿️", query: `コインパーキング ${st}` },
  { name: "飲食店全般", category: "ランチ・ディナー", emoji: "🍽️", query: `飲食店 ${st}` },
  { name: "ATM", category: "銀行・コンビニATM", emoji: "🏧", query: `ATM ${st}` },
];

export const venueContents: Record<string, VenueContent> = {
  "keisei-koiwa": {
    slug: "keisei-koiwa",
    name: "ブルースペース京成小岩",
    badge: "京成小岩エリア唯一のレンタルスペース",
    station: "京成小岩駅 徒歩30秒（北口）",
    capacityShort: "16名最適（最大20名）／ 約26㎡",
    address: "東京都江戸川区北小岩6-11-2 エールプラザ京成小岩B101号室",
    postalCode: "133-0041",
    addressLocality: "江戸川区",
    catchCopy: "駅徒歩30秒・24時間営業。会議からパーティーまで使える多目的スペース",
    overview:
      "京成小岩駅北口から徒歩30秒、京成小岩エリア唯一のレンタルスペースです。地元の方の懇親会・ママ会・2次会・3次会から、ボードゲーム会・大画面での映画鑑賞、塾・教室・セミナー、会議・面接、撮影の控室・機材置き、配送の荷物置き、会社の一時的なオフィスまで、用途を選ばず幅広くご利用いただけます。80インチスクリーン・55インチモニター・3200ルーメンプロジェクター・Bluetoothマイクを完備し、最大20名収容対応。スペースマーケットでは4.0評価のトップホスト拠点です。",
    uses: [
      "ボードゲーム会場",
      "地元のママ会・懇親会",
      "2次会・3次会",
      "大画面の映画鑑賞",
      "会議・面接",
      "塾・教室",
      "定期的セミナー・勉強会",
      "イベント集客",
      "会社の一時オフィス",
      "撮影の控室・機材置き",
      "配送の荷物置きスペース",
      "YouTube収録・配信",
    ],
    amenities: [
      { label: "80インチスクリーン", note: "映画・スポーツ観戦も大迫力" },
      { label: "55インチモニター", note: "サブ画面・ボードゲーム解説に" },
      { label: "プロジェクター 3200lm", note: "明るい部屋でも映像クリア" },
      { label: "高速光WiFi", note: "配信・Web会議も安定" },
      { label: "Bluetoothマイク", note: "セミナー・配信に最適" },
      { label: "ホワイトボード", note: "塾・ワークショップ・会議に" },
      { label: "ボードゲーム備品", note: "体験会・遊び会に" },
      { label: "2名がけテーブル×8 / 椅子×20", note: "最大20名収容対応" },
      { label: "冷暖房完備", note: "年間通して快適" },
      { label: "アルコール消毒", note: "衛生対策済み" },
      { label: "ゴミ持ち帰り不要", note: "スタッフ対応 ※有償" },
      { label: "電源タップ", note: "複数機器同時利用OK" },
    ],
    accessRows: [
      { label: "最寄り駅", main: "京成本線「京成小岩駅」", sub: "徒歩30秒（北口）" },
      { label: "副駅", main: "JR総武線「小岩駅」", sub: "徒歩圏内" },
      { label: "住所", main: "東京都江戸川区北小岩6-11-2", sub: "エールプラザ京成小岩B101号室" },
    ],
    nearby: NEARBY_TEMPLATE("京成小岩駅", "マルエツ / イオン等"),
    reviews: [
      {
        initial: "O",
        quote:
          "ボードゲーム会で20名利用。広々していて参加者全員ストレスなく遊べました。55インチモニターでルール説明もできて運営しやすい。駅から30秒なので集合もスムーズです。",
        name: "O様",
        role: "ボードゲームサークル",
      },
      {
        initial: "W",
        quote:
          "個人塾の特別講習会で利用。ホワイトボードが複数あり、生徒それぞれの作業エリアを分けられて便利でした。Wi-Fiも安定していて教材のオンライン共有もスムーズ。",
        name: "W様",
        role: "個別指導塾",
      },
      {
        initial: "C",
        quote:
          "映画鑑賞会で利用。80インチスクリーンと音響で映画館気分を満喫できました。プロジェクターは3200ルーメンで昼間でも見やすく、参加者からも好評でした。",
        name: "C様",
        role: "映画鑑賞会主催",
      },
    ],
    faqs: COMMON_FAQS,
    mapEmbedSrc:
      "https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d1619.7528028385912!2d139.8835091!3d35.742608!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x6018852a8f92a19d%3A0x105ecc60fd2ee0f9!2z5Lqs5oiQ5bCP5bKpL-ODrOODs-OCv-ODq-OCueODmuODvOOCuS_osrjjgZfkvJrorbDlrqQv44Oc44O844OJ44Ky44O844OgL-eglOS_ruaWveiorS_jgrnjgr_jgrjjgqov44OW44Or44O844K544Oa44O844K55Lqs5oiQ5bCP5bKp!5e0!3m2!1sja!2sjp!4v1779069961894!5m2!1sja!2sjp",
    mapQuery: "ブルースペース京成小岩",
    geo: { lat: 35.742608, lng: 139.8835091 },
    photos: {
      hero: "/venues/keisei-koiwa/hero.jpg",
      categories: gallery("keisei-koiwa", "ブルースペース京成小岩", [
        { id: "interior", label: "室内", count: 8 },
        { id: "equipment", label: "備品・設備", count: 10 },
        { id: "exterior", label: "外観・周辺", count: 4 },
        { id: "layout", label: "間取り・レイアウト", count: 3 },
      ]),
      accessMap: "/venues/keisei-koiwa/access-map.jpg",
    },
  },

  kanda: {
    slug: "kanda",
    name: "ブルースペース神田",
    badge: "インスタベース東京都1位",
    station: "JR神田駅 徒歩1分（東口）",
    capacityShort: "16名最適（最大20名）／ 室内20㎡（共用部含め44㎡）",
    address: "東京都千代田区鍛冶町2-8-7 光起ビル地下1階",
    postalCode: "101-0044",
    addressLocality: "千代田区",
    catchCopy: "神田駅徒歩1分・全面ミラーのフラッグシップ拠点。ダンスから研修まで",
    overview:
      "JR神田駅東口から徒歩1分、東京メトロ銀座線・神田駅からも徒歩3分の好立地にある完全個室レンタルスペース。白を基調としたシンプルな内装は撮影との相性が良く、全面ミラー採用でダンス・稽古・ウォーキング教室にも対応します。BenQプロジェクター＋80インチスクリーン・46インチモニター・両面ホワイトボード・有線マイク・Bluetoothスピーカーなど充実の設備はすべて無料。テーブル8台・椅子20脚で最大20名着席でき、高速光WiFi（平均300Mbps）と24時間換気で配信・Web会議も快適です。インスタベース東京都エリアで1位を獲得した、設備充実のフラッグシップ拠点。",
    uses: [
      "ダンスレッスン",
      "ウォーキング教室",
      "演劇・稽古",
      "会議・ミーティング",
      "セミナー・研修",
      "ワークショップ",
      "YouTube・TikTok撮影",
      "動画配信",
      "商品撮影",
      "面接会場",
      "勉強会・読書会",
      "社内研修",
      "コスプレ撮影",
      "ゲーム大会",
      "懇親会・パーティー",
    ],
    amenities: [
      { label: "全面ミラー", note: "ダンス・稽古・撮影・ウォーキング" },
      { label: "高速光WiFi（業務用）", note: "配信・Web会議も安定" },
      { label: "BenQプロジェクター", note: "単焦点・80インチスクリーン" },
      { label: "ホーロー型ホワイトボード", note: "両面 1200×900mm" },
      { label: "受付用ボード×2", note: "セミナー・イベントの受付に" },
      { label: "SHARPモニター", note: "資料投影・サイネージに" },
      { label: "スピーカー・マイクセット", note: "SANWA SUPPLY セミナー対応" },
      { label: "スマートフォン三脚", note: "配信・撮影に" },
      { label: "LANケーブル 10m", note: "有線接続でさらに安定" },
      { label: "電源タップ6個口", note: "Lightning・USB対応" },
      { label: "冷暖房完備", note: "年間通して快適" },
      { label: "長机・椅子（最大20脚）", note: "レイアウト変更自由" },
    ],
    accessRows: [
      { label: "最寄り駅", main: "JR神田駅", sub: "徒歩1分（東口）" },
      { label: "副駅", main: "JR秋葉原駅", sub: "徒歩8分" },
      { label: "住所", main: "東京都千代田区鍛冶町2-8-7", sub: "光起ビル地下1階" },
    ],
    nearby: NEARBY_TEMPLATE("神田駅"),
    reviews: [
      {
        initial: "Y",
        quote:
          "ダンスレッスンで利用。全面ミラーで広々しており、音響も良く大満足でした。駅近で参加者も迷わず集合でき、講師としても助かります。",
        name: "Y様",
        role: "ダンスインストラクター",
      },
      {
        initial: "K",
        quote:
          "研修会場として利用。Wi-Fiが非常に速く快適でWeb会議もスムーズ、プロジェクター・ホワイトボードも揃っていて準備がとても楽でした。きれいに保たれていて安心です。",
        name: "K様",
        role: "人事担当 / 研修担当",
      },
      {
        initial: "T",
        quote:
          "神田駅近くで10名でのミーティング。スペースとしては大変お得で、オンライン会議の備品も充実していて会議の進行がスムーズでした。リピートします。",
        name: "T様",
        role: "法人ユーザー",
      },
    ],
    faqs: COMMON_FAQS,
    mapEmbedSrc:
      "https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d1619.7528028385912!2d139.7728167!3d35.6927341!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x60188dd3d48ab543%3A0x2ce6de16e96da94!2z44OW44Or44O844K544Oa44O844K556We55Sw!5e0!3m2!1sja!2sjp!4v1779069961894!5m2!1sja!2sjp",
    mapQuery: "ブルースペース神田",
    geo: { lat: 35.6927341, lng: 139.7728167 },
    photos: {
      hero: "/venues/kanda/hero.jpg",
      categories: gallery("kanda", "ブルースペース神田", [
        { id: "interior", label: "室内", count: 8 },
        { id: "equipment", label: "備品・設備", count: 10 },
        { id: "exterior", label: "外観・周辺", count: 4 },
        { id: "layout", label: "間取り・レイアウト", count: 3 },
      ]),
      accessMap: "/venues/kanda/access-map.jpg",
    },
  },

  "ueno-okachimachi": {
    slug: "ueno-okachimachi",
    name: "ブルースペース上野御徒町",
    badge: "TV撮影実績あり / インスタベース高評価",
    station: "JR御徒町駅 徒歩3分",
    capacityShort: "18名最適（最大20名）／ 約43㎡",
    address: "東京都台東区上野3-13-10 トミヤマビルB1階",
    postalCode: "110-0005",
    addressLocality: "台東区",
    catchCopy: "御徒町3分・上野6分。TVロケ実績ありの43㎡ワイド空間",
    overview:
      "JR御徒町駅から徒歩3分。上野広小路・末広町・仲御徒町・上野御徒町を含む5駅4路線がすべて徒歩3分圏内という抜群のアクセスです。地下1階ワンフロア貸切型なので、周囲を気にせず撮影・研修・ダンス練習・ボードゲーム会に集中できます。TV番組のロケ実績があり、ビジネスプロジェクター＋80インチスクリーン・49型テレビ・ホーロー型ホワイトボード（1200×900）・有線マイクを完備。テーブル6台・椅子20脚で最大18名収容、高速WiFiは最大256台接続に対応します。インスタベースでは「清潔感・スタッフ対応」ともに高評価をいただいています。",
    uses: [
      "TV番組ロケ・撮影",
      "YouTube・TikTok収録",
      "商品撮影",
      "企業会議・社内ミーティング",
      "セミナー・勉強会",
      "研修・新人教育",
      "ボードゲーム会・体験会",
      "ワークショップ",
      "稽古・演劇練習",
      "面接会場",
      "商談・打ち合わせ",
      "配信・ライブ",
      "学習塾・英会話教室",
      "ダンス・ヨガ",
      "コスプレ撮影",
      "物販・展示会",
    ],
    amenities: [
      { label: "49型テレビ（ハイセンス）", note: "資料投影・サイネージに" },
      { label: "プロジェクター", note: "スクリーン投影対応" },
      { label: "ホーロー型ホワイトボード", note: "1200×900mm 大型タイプ" },
      { label: "高速光WiFi", note: "配信・Web会議も安定" },
      { label: "LANケーブル 10m", note: "有線接続でさらに安定" },
      { label: "撮影機材", note: "TV番組ロケ実績" },
      { label: "マイク・スピーカー", note: "セミナー・配信に" },
      { label: "受付・案内ボード", note: "セミナー・イベント運営" },
      { label: "冷暖房完備", note: "年間通して快適" },
      { label: "アルコール消毒", note: "衛生対策済み・換気良好" },
      { label: "ゴミ持ち帰り不要", note: "スタッフ対応" },
      { label: "長机・椅子（最大20脚）", note: "レイアウト変更自由" },
    ],
    accessRows: [
      { label: "最寄り駅", main: "JR御徒町駅", sub: "徒歩3分" },
      { label: "副駅1", main: "JR上野駅", sub: "徒歩6分" },
      { label: "副駅2", main: "東京メトロ末広町駅", sub: "徒歩5分" },
      { label: "住所", main: "東京都台東区上野3-13-10", sub: "トミヤマビルB1階" },
    ],
    nearby: NEARBY_TEMPLATE("御徒町駅", "マルエツ・吉池等"),
    reviews: [
      {
        initial: "T",
        quote:
          "TV番組のロケ地として利用。撮影機材を持ち込みやすい広さで、スタッフ対応も丁寧でした。問い合わせの返答も早く、安心して任せられます。",
        name: "T様",
        role: "番組制作会社",
      },
      {
        initial: "H",
        quote:
          "会社の会議で使用。エアコンの効きもよく滞りなく進行できました。会社からも近場なので、また利用させていただきます。",
        name: "H様",
        role: "法人ユーザー",
      },
      {
        initial: "N",
        quote:
          "セミナー開催で利用。多数の駅から集客ができ、清掃も行き届いていて空気循環も良く安心でした。問い合わせもすぐに回答してもらえたのも高評価です。",
        name: "N様",
        role: "セミナー主催者",
      },
    ],
    faqs: COMMON_FAQS,
    mapEmbedSrc: "",
    mapQuery: "ブルースペース上野御徒町",
    geo: null,
    photos: {
      hero: "/venues/ueno-okachimachi/hero.jpg",
      categories: gallery("ueno-okachimachi", "ブルースペース上野御徒町", [
        { id: "interior", label: "室内", count: 8 },
        { id: "equipment", label: "備品・設備", count: 10 },
        { id: "exterior", label: "外観・周辺", count: 4 },
        { id: "layout", label: "間取り・レイアウト", count: 3 },
      ]),
      accessMap: "/venues/ueno-okachimachi/access-map.jpg",
    },
  },

  "ueno-4a": {
    slug: "ueno-4a",
    name: "ブルースペース上野駅前4A",
    badge: "上野駅徒歩1分 / 4Bと連結可",
    station: "JR上野駅 徒歩1分",
    capacityShort: "18名最適（最大20名）／ 約26㎡",
    address: "東京都台東区上野7-7-11 伸栄ビル401号室",
    postalCode: "110-0005",
    addressLocality: "台東区",
    catchCopy: "上野駅徒歩1分の超駅近。4Bと連結で最大30名の研修にも",
    overview:
      "JR上野駅から徒歩1分、9路線・9駅が徒歩12分圏内という都内屈指のアクセスを誇るレンタルスペース。65インチ特大モニターと100インチプロジェクタースクリーンの2画面を備え、セミナー・研修から撮影・配信まで設備はすべて無料で使えます。隣接する4Bと連結すれば最大30名規模の研修や同時2会場開催にも対応。業務用Wi-Fiルーターで配信・Web会議も安定し、エレベーターありで機材の搬入もスムーズ、隣にコインパーキングがあるためお車も便利です。地方からの参加者でも迷わずアクセスでき、女性参加者にも配慮した立地。",
    uses: [
      "会議・打ち合わせ",
      "セミナー・研修",
      "勉強会",
      "YouTube収録・配信",
      "商品撮影・モデル撮影",
      "面接会場",
      "稽古・演技練習",
      "ワークショップ",
      "ボードゲーム会",
      "飲み会・打ち上げ",
      "4Bと連結で30名研修",
      "同時2セミナー開催",
      "コスプレ撮影・ポートレート",
      "学習塾・英会話教室",
      "ゲーム大会・物販",
    ],
    amenities: [
      { label: "高速光WiFi", note: "業務用ルーターで配信も安定" },
      { label: "プロジェクター", note: "スクリーン投影対応" },
      { label: "ホワイトボード", note: "ミーティング・ワークショップ" },
      { label: "TV / モニター", note: "資料共有・サイネージに" },
      { label: "撮影機材", note: "一式持ち込み可" },
      { label: "冷暖房完備", note: "年間通して快適" },
      { label: "アルコール消毒", note: "衛生対策済み" },
      { label: "ゴミ持ち帰り不要", note: "スタッフ対応" },
      { label: "4Bと連結可", note: "最大30名規模に対応" },
      { label: "エレベーター", note: "機材搬入もスムーズ" },
      { label: "長机・椅子", note: "レイアウト変更自由" },
      { label: "電源タップ", note: "複数機器同時利用OK" },
    ],
    accessRows: [
      { label: "最寄り駅", main: "JR上野駅", sub: "徒歩1分" },
      { label: "副駅", main: "東京メトロ上野駅", sub: "徒歩2分" },
      { label: "住所", main: "東京都台東区上野7-7-11", sub: "伸栄ビル401号室" },
    ],
    nearby: NEARBY_TEMPLATE("上野駅", "マルエツ・ヨーカドー等"),
    reviews: [
      {
        initial: "A",
        quote:
          "上野駅から徒歩30秒で本当にすぐ。地方からの参加者も迷わず到着できました。4Bと合わせて30名規模の研修で活用しています。大手の半額程度の料金で高コスパです。",
        name: "A様",
        role: "研修事業会社",
      },
      {
        initial: "N",
        quote:
          "撮影スタジオとして利用。Wi-Fiが業務用ルーターで安定していて配信もスムーズ。エレベーターで機材搬入もできるので助かります。建物は古めですが室内は清潔感があります。",
        name: "N様",
        role: "YouTuber",
      },
      {
        initial: "M",
        quote:
          "4Aと4Bを同時に借りて2会場でセミナー開催。隣同士なので運営もしやすく、近くにコンビニもあって便利でした。女子トイレが近いのも参加者に好評。",
        name: "M様",
        role: "セミナー主催者",
      },
    ],
    faqs: COMMON_FAQS,
    mapEmbedSrc:
      "https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d1619.7528028385912!2d139.7783914!3d35.7137818!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x60188fb655956185%3A0x6b3c2c97343c97e9!2z5LiK6YeO6aeFL-iyuOOBl-S8muitsOWupOODu-OCueOCv-OCuOOCqi_jg5bjg6vjg7zjgrnjg5rjg7zjgrnkuIrph47pp4XliY00QSg0MDEp!5e0!3m2!1sja!2sjp!4v1779069961894!5m2!1sja!2sjp",
    mapQuery: "ブルースペース上野駅前4A",
    geo: { lat: 35.7137818, lng: 139.7783914 },
    photos: {
      hero: "/venues/ueno-4a/hero.jpg",
      categories: gallery("ueno-4a", "ブルースペース上野駅前4A", [
        { id: "interior", label: "室内", count: 8 },
        { id: "equipment", label: "備品・設備", count: 10 },
        { id: "exterior", label: "外観・周辺", count: 4 },
      ]),
      accessMap: "/venues/ueno-4a/access-map.jpg",
    },
  },

  "ueno-4b": {
    slug: "ueno-4b",
    name: "ブルースペース上野駅前4B",
    badge: "100インチ大型スクリーン / 4Aと連結可",
    station: "JR上野駅 徒歩1分",
    capacityShort: "18名最適（最大20名）／ 約26㎡",
    address: "東京都台東区上野7-7-11 伸栄ビル402号室",
    postalCode: "110-0005",
    addressLocality: "台東区",
    catchCopy: "100インチ大型スクリーン搭載。配信・収録・セミナーの上野拠点",
    overview:
      "JR上野駅から徒歩1分、9路線・9駅が徒歩12分圏内の超駅近レンタルスペース。100インチ大型スクリーン＋ビジネスプロジェクターに加えて撮影機材一式を完備し、動画配信・ライブストリーミング・YouTube収録に最適です。隣接する4Aと連結すれば最大30名のセミナー・研修・イベントにも対応。空気清浄機と24時間換気で快適性も高く、エレベーター・隣接コインパーキングありで搬入やお車のアクセスもスムーズ。換気良好で安心の評価をいただいている、上野エリアのトップホスト拠点です。",
    uses: [
      "セミナー・大型勉強会",
      "研修・新人教育",
      "動画配信・ライブストリーミング",
      "YouTube・TikTok収録",
      "撮影・モデル撮影",
      "商品撮影",
      "会議・株主総会",
      "面接会場",
      "ボードゲーム会・体験会",
      "飲み会・打ち上げ",
      "4Aと連結で30名イベント",
      "コスプレ撮影",
      "学習塾・英会話教室",
      "ゲーム大会・展示会",
    ],
    amenities: [
      { label: "100インチ大型スクリーン", note: "見やすさ抜群、セミナー最適" },
      { label: "高速光WiFi", note: "業務用ルーターで配信も安定" },
      { label: "プロジェクター", note: "高輝度モデル" },
      { label: "ホワイトボード", note: "ミーティング・ワークショップ" },
      { label: "TV / モニター", note: "資料共有・サイネージに" },
      { label: "撮影機材一式", note: "配信・収録に対応" },
      { label: "冷暖房完備", note: "年間通して快適" },
      { label: "アルコール消毒", note: "衛生対策済み・換気良好" },
      { label: "ゴミ持ち帰り不要", note: "スタッフ対応" },
      { label: "4Aと連結可", note: "最大30名規模に対応" },
      { label: "エレベーター", note: "機材搬入もスムーズ" },
      { label: "長机・椅子", note: "レイアウト変更自由（最大20脚）" },
    ],
    accessRows: [
      { label: "最寄り駅", main: "JR上野駅", sub: "徒歩1分" },
      { label: "副駅", main: "東京メトロ上野駅", sub: "徒歩2分" },
      { label: "住所", main: "東京都台東区上野7-7-11", sub: "伸栄ビル402号室" },
    ],
    nearby: NEARBY_TEMPLATE("上野駅", "マルエツ・ヨーカドー等"),
    reviews: [
      {
        initial: "I",
        quote:
          "100インチスクリーンが圧巻。セミナーで参加者全員が見やすく、資料の細かい部分まで確認してもらえました。設備が充実していて運営側もストレスなく進められます。リピート確定です。",
        name: "I様",
        role: "セミナー講師",
      },
      {
        initial: "F",
        quote:
          "4Aと連結して30名規模で研修利用。広々と使えて研修もスムーズに進行できました。エレベーターで備品搬入もしやすく、女子トイレが近いのも好評でした。",
        name: "F様",
        role: "人材教育",
      },
      {
        initial: "V",
        quote:
          "動画配信で利用。撮影機材一式が揃っていて、Wi-Fiも安定しているので配信トラブル無し。換気もしっかりしていて長時間収録も快適でした。",
        name: "V様",
        role: "ライブ配信",
      },
    ],
    faqs: COMMON_FAQS,
    mapEmbedSrc:
      "https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d1619.7528028385912!2d139.778391!3d35.713782!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x60188fe7cf201021%3A0x7fbf5211fcd08f3c!2z5LiK6YeO6aeFL-iyuOOBl-S8muitsOWupOODu-OCueOCv-OCuOOCqi_jg5bjg6vjg7zjgrnjg5rjg7zjgrnkuIrph47pp4XliY00Qig0MDIp!5e0!3m2!1sja!2sjp!4v1779069961894!5m2!1sja!2sjp",
    mapQuery: "ブルースペース上野駅前4B",
    geo: { lat: 35.713782, lng: 139.778391 },
    photos: {
      hero: "/venues/ueno-4b/hero.jpg",
      categories: gallery("ueno-4b", "ブルースペース上野駅前4B", [
        { id: "interior", label: "室内", count: 8 },
        { id: "equipment", label: "備品・設備", count: 10 },
        { id: "exterior", label: "外観・周辺", count: 4 },
      ]),
      accessMap: "/venues/ueno-4b/access-map.jpg",
    },
  },

  "nishi-shinjuku": {
    slug: "nishi-shinjuku",
    name: "ブルースペース西新宿403",
    badge: "新宿主要3駅アクセス",
    station: "西武新宿駅 徒歩7分 / 新宿駅 徒歩10分",
    capacityShort: "8名最適（最大12名）／ 約20㎡",
    address: "東京都新宿区西新宿7-19-6 東洋ビル403号室",
    postalCode: "160-0023",
    addressLocality: "新宿区",
    catchCopy: "新宿3駅圏内のビジネス特化スペース。会議・面接・商談に",
    overview:
      "東京メトロ丸ノ内線・西新宿駅から徒歩4分。新宿・西武新宿・都庁前・新宿西口・大久保を含む6駅が徒歩10分圏内のビジネスエリアに位置する完全個室レンタルスペースです。8名最適・最大12名のコンパクトな空間で、会議・面接・商談・採用イベント・小規模セミナーに最適。55インチ大型モニター・プロジェクター・Webカメラに加え、クロマキー合成用のグリーンスクリーンも備え、動画撮影・オンライン配信にも対応します。飲食・ケータリングの持ち込みOKなのでボードゲーム会や懇親会にも。明るく清潔感のある内装は応募者・参加者の印象も良く、出張時の打ち合わせ拠点としてもおすすめです。",
    uses: [
      "ビジネス会議・商談",
      "面接会場",
      "採用説明会",
      "Web会議・オンライン配信",
      "研修・新人教育",
      "小規模セミナー",
      "1on1ミーティング",
      "商品撮影・ECモデル撮影",
      "プロフィール撮影",
      "ワークショップ",
      "リモートワーク拠点",
      "ボードゲーム会",
      "クロマキー（グリーンスクリーン）撮影",
    ],
    amenities: [
      { label: "高速光WiFi", note: "配信・Web会議も安定" },
      { label: "プロジェクター", note: "スクリーン投影対応" },
      { label: "ホワイトボード", note: "ミーティング・ワークショップ" },
      { label: "TV / モニター", note: "資料共有・サイネージに" },
      { label: "Web会議用カメラ", note: "オンライン配信に" },
      { label: "電源タップ", note: "PC複数台でも安心" },
      { label: "冷暖房完備", note: "年間通して快適" },
      { label: "アルコール消毒", note: "衛生対策済み" },
      { label: "ゴミ持ち帰り不要", note: "スタッフ対応" },
      { label: "長机・椅子", note: "レイアウト変更自由" },
    ],
    accessRows: [
      { label: "最寄り駅", main: "西武新宿線「西武新宿駅」", sub: "徒歩7分" },
      { label: "副駅1", main: "JR・各線「新宿駅」", sub: "徒歩10分" },
      { label: "副駅2", main: "都営大江戸線「都庁前駅」", sub: "徒歩7分" },
      { label: "住所", main: "東京都新宿区西新宿7-19-6", sub: "東洋ビル403号室" },
    ],
    nearby: NEARBY_TEMPLATE("西新宿駅"),
    reviews: [
      {
        initial: "M",
        quote:
          "出張時の打ち合わせで利用。新宿駅から徒歩圏で迷わず到着でき、Wi-Fiも安定していて仕事がはかどりました。コンパクトながら必要十分の設備が揃っていて使いやすいです。",
        name: "M様",
        role: "法人営業",
      },
      {
        initial: "S",
        quote:
          "面接会場として使用。落ち着いた雰囲気で清潔感があり、応募者にも好印象でした。新宿エリアで条件に合う会場が少ない中、リピート利用確定です。",
        name: "S様",
        role: "採用担当",
      },
      {
        initial: "F",
        quote:
          "EC商品の撮影で利用。明るい採光があり背景も使いやすく、Web掲載写真の品質が向上しました。少人数での撮影には最適です。",
        name: "F様",
        role: "EC運営",
      },
    ],
    faqs: COMMON_FAQS,
    mapEmbedSrc:
      "https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d1619.7528028385912!2d139.695814!3d35.6950219!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x60188d753039ac79%3A0xd23576ba5089cfb2!2z44OW44Or44O844K544Oa44O844K56KW_5paw5a6_NDAz!5e0!3m2!1sja!2sjp!4v1779069961894!5m2!1sja!2sjp",
    mapQuery: "ブルースペース西新宿403",
    geo: { lat: 35.6950219, lng: 139.695814 },
    photos: {
      hero: "/venues/nishi-shinjuku/hero.jpg",
      categories: gallery("nishi-shinjuku", "ブルースペース西新宿403", [
        { id: "interior", label: "室内", count: 8 },
        { id: "equipment", label: "備品・設備", count: 10 },
        { id: "exterior", label: "外観・周辺", count: 1 },
        { id: "layout", label: "間取り・レイアウト", count: 3 },
      ]),
      accessMap: "/venues/nishi-shinjuku/access-map.jpg",
    },
  },

  "shirokane-takanawa": {
    slug: "shirokane-takanawa",
    name: "ブルースペース白金高輪",
    badge: "24時間営業 / 多目的サロン・スタジオ",
    station: "白金高輪駅 徒歩7分",
    capacityShort: "4-6名最適（最大6名）／ 約16㎡",
    address: "東京都港区白金3-1-12 第二浅野ビル403号室",
    postalCode: "108-0072",
    addressLocality: "港区",
    catchCopy: "施術ベッド完備の白金サロンスペース。エステ・ネイル・ポップアップに",
    overview:
      "白金高輪駅から徒歩7分、シックで可愛いインテリアに囲まれた隠れ家のような多目的スペース。最大6名規模のコンパクトな空間に施術ベッド・姿見鏡・スリッパを完備し、サロン・エステ・ネイルなどの施術業に最適です。爆速NURO光Wi-Fi・モニター・ホワイトボード・LEDリングライトを備え、カウンセリング・少人数会議・撮影・オンライン配信にも対応。キッチン付きで女子会やワークショップにも使いやすく、24時間営業なので深夜・早朝の施術や撮影にも柔軟です。落ち着いた白金エリアの立地は、お客様をお迎えする場としても好印象。",
    uses: [
      "サロン・エステ・施術",
      "ネイル・まつエク",
      "ポップアップストア・物販",
      "展示会・販売会",
      "個人塾・家庭教師",
      "少人数会議・1on1",
      "コーチング・カウンセリング",
      "YouTube収録・配信",
      "商品撮影・モデル撮影",
      "ワークショップ・体験会",
      "女子会・誕生日会",
      "リモートワーク拠点",
      "美容レッスン",
      "インタビュー・取材",
      "ボードゲーム会",
    ],
    amenities: [
      { label: "施術ベッド", note: "サロン・エステ・ネイルに（オプション）" },
      { label: "姿見鏡", note: "試着・施術仕上がりチェックに" },
      { label: "スリッパ完備", note: "お客様の靴脱ぎにも対応" },
      { label: "爆速NURO光WiFi", note: "配信・Web会議も超安定" },
      { label: "テレビ / モニター", note: "BGM・サイネージにも" },
      { label: "DVDプレイヤー", note: "映像コンテンツ再生対応" },
      { label: "プロジェクター", note: "スクリーン投影対応（オプション）" },
      { label: "ホワイトボード", note: "塾・ミーティングに" },
      { label: "水回り完備", note: "長時間利用も快適" },
      { label: "エアコン完備", note: "年間通して快適" },
      { label: "2名がけテーブル×2 / 椅子×6", note: "最大6名規模に最適" },
      { label: "24時間営業", note: "深夜・早朝の利用も可能" },
    ],
    accessRows: [
      { label: "最寄り駅", main: "南北線・三田線「白金高輪駅」", sub: "徒歩7分" },
      { label: "副駅", main: "JR「高輪ゲートウェイ駅」", sub: "徒歩圏内" },
      { label: "住所", main: "東京都港区白金3-1-12", sub: "第二浅野ビル403号室" },
    ],
    nearby: NEARBY_TEMPLATE("白金高輪駅", "マルエツ・成城石井等"),
    reviews: [
      {
        initial: "R",
        quote:
          "サロンとして利用。施術ベッドが整っており、清潔感のある空間でお客様にも好評でした。爆速NURO光のWi-Fiは予約管理システムも快適に動かせて助かります。",
        name: "R様",
        role: "エステティシャン",
      },
      {
        initial: "B",
        quote:
          "ポップアップストアで使用。白金エリアの落ち着いた雰囲気にマッチして、お客様の滞在時間も長く取れました。24時間使えるので搬入搬出のスケジュールも柔軟に組めます。",
        name: "B様",
        role: "ブランドオーナー",
      },
      {
        initial: "P",
        quote:
          "少人数の女子会・誕生日会で利用。テレビ・DVDで盛り上がれて、姿見鏡もあるので写真撮影にも便利。白金エリアという立地が参加者にも好評でした。",
        name: "P様",
        role: "プライベート利用",
      },
    ],
    faqs: COMMON_FAQS,
    mapEmbedSrc:
      "https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d1619.7528028385912!2d139.7300219!3d35.6467668!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x60188beff8cffe35%3A0xa35d45da94e7211e!2z44OW44Or44O844K544Oa44O844K555m96YeR6auY6LyqL-iyuOOBl-S8muitsOWupC_jg6zjg7Pjgr_jg6vjgrnjg5rjg7zjgrkv44Os44Oz44K_44Or44K144Ot44OzL-Wwj-imj-aooeOCteODreODs-KAouWhvuODrOODs-OCv-ODqw!5e0!3m2!1sja!2sjp!4v1779069961894!5m2!1sja!2sjp",
    mapQuery: "ブルースペース白金高輪",
    geo: { lat: 35.6467668, lng: 139.7300219 },
    photos: {
      hero: "/venues/shirokane-takanawa/hero.jpg",
      categories: gallery("shirokane-takanawa", "ブルースペース白金高輪", [
        { id: "interior", label: "室内", count: 8 },
        { id: "treatment", label: "施術セッティング", count: 6 },
        { id: "equipment", label: "備品・設備", count: 10 },
        { id: "exterior", label: "外観・周辺", count: 4 },
      ]),
      accessMap: "/venues/shirokane-takanawa/access-map.jpg",
    },
  },
};

export function getVenueContent(slug: string): VenueContent | null {
  return venueContents[slug] ?? null;
}
