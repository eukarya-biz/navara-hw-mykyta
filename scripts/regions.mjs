/**
 * JMA's twelve 梅雨 地方, and which of the 102 生物季節観測 stations sits in each.
 *
 * Separated from build-tsuyu.mjs because it is data, not logic, and because the
 * partition is the one part of that build a reviewer has to check by hand.
 *
 * The definitions come from 気象庁「地域名」 and geography does not predict them:
 *
 * - 山口県 is in 九州北部, not 中国 — so 下関 crosses the strait.
 * - 熊本 and 大分 are 九州*北部* despite sitting mid-Kyushu.
 * - 奄美 is only 奄美市・大島郡・十島村, so 種子島 and 屋久島 are 九州南部.
 * - The 伊豆諸島 are 東京都, so 大島, 三宅島 and 八丈島 are 関東甲信 — which puts
 *   八丈島 at 33.1°N on 関東甲信's date, four weeks after 九州南部 at the same
 *   latitude. Correct by definition, wrong to the eye, and kept.
 *
 * Any nearest-anchor heuristic gets all four of those wrong and fails silently,
 * which is why this is written out. build-tsuyu.mjs asserts that every station in
 * phenology.geojson appears in exactly one list below.
 */

/**
 * Ordered as JMA orders them, which is also south to north, which is also the
 * column order in tsuyu_iriake.csv. `anchor` is the 管区/地方気象台 seat, and is
 * where the region is drawn: it must be a station name present in
 * phenology.geojson, so no coordinate is invented anywhere in this pipeline.
 */
export const REGIONS = [
  {
    code: "01",
    id: "okinawa",
    name: "沖縄",
    nameEn: "Okinawa",
    anchor: "那覇",
    prefectures: ["沖縄"],
    stations: [
      "那覇",
      "名護",
      "久米島",
      "南大東島",
      "宮古島",
      "与那国島",
      "西表島",
      "石垣島",
    ],
  },
  {
    code: "02",
    id: "amami",
    name: "奄美",
    nameEn: "Amami",
    // 奄美's only phenology station. Its 梅雨 announcements come from 鹿児島, but
    // the region is its own row in the CSV, so it is its own feature here.
    anchor: "名瀬",
    prefectures: ["鹿児島 (奄美市・大島郡・十島村)"],
    stations: ["名瀬"],
  },
  {
    code: "03",
    id: "kyushuS",
    name: "九州南部",
    nameEn: "Southern Kyushu",
    anchor: "鹿児島",
    prefectures: ["宮崎", "鹿児島 (奄美を除く)"],
    stations: ["鹿児島", "宮崎", "延岡", "種子島", "屋久島"],
  },
  {
    code: "04",
    id: "kyushuN",
    name: "九州北部",
    nameEn: "Northern Kyushu",
    anchor: "福岡",
    prefectures: ["山口", "福岡", "大分", "佐賀", "熊本", "長崎"],
    stations: ["福岡", "佐賀", "長崎", "福江", "厳原", "熊本", "大分", "下関"],
  },
  {
    code: "05",
    id: "shikoku",
    name: "四国",
    nameEn: "Shikoku",
    anchor: "高松",
    prefectures: ["徳島", "香川", "愛媛", "高知"],
    stations: ["高松", "松山", "高知", "徳島", "宇和島"],
  },
  {
    code: "06",
    id: "chugoku",
    name: "中国",
    nameEn: "Chugoku",
    anchor: "広島",
    prefectures: ["鳥取", "島根", "岡山", "広島"],
    stations: ["広島", "岡山", "鳥取", "松江", "米子", "浜田", "西郷"],
  },
  {
    code: "07",
    id: "kinki",
    name: "近畿",
    nameEn: "Kinki",
    anchor: "大阪",
    prefectures: ["滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山"],
    stations: [
      "大阪",
      "京都",
      "神戸",
      "奈良",
      "和歌山",
      "彦根",
      "舞鶴",
      "豊岡",
      "洲本",
      "潮岬",
    ],
  },
  {
    code: "08",
    id: "tokai",
    name: "東海",
    nameEn: "Tokai",
    anchor: "名古屋",
    prefectures: ["岐阜", "静岡", "愛知", "三重"],
    stations: ["名古屋", "岐阜", "津", "静岡", "浜松", "尾鷲", "高山"],
  },
  {
    code: "09",
    id: "kantoKoshin",
    name: "関東甲信",
    nameEn: "Kanto-Koshin",
    anchor: "東京",
    prefectures: [
      "茨城",
      "栃木",
      "群馬",
      "埼玉",
      "千葉",
      "東京",
      "神奈川",
      "山梨",
      "長野",
    ],
    stations: [
      "東京",
      "横浜",
      "宇都宮",
      "前橋",
      "水戸",
      "熊谷",
      "銚子",
      "館山",
      "甲府",
      "長野",
      "松本",
      "飯田",
      "大島",
      "三宅島",
      "八丈島",
    ],
  },
  {
    code: "10",
    id: "hokuriku",
    name: "北陸",
    nameEn: "Hokuriku",
    anchor: "新潟",
    prefectures: ["新潟", "富山", "石川", "福井"],
    stations: ["新潟", "富山", "金沢", "福井", "輪島", "高田", "相川", "敦賀"],
  },
  {
    code: "11",
    id: "tohokuS",
    name: "東北南部",
    nameEn: "Southern Tohoku",
    anchor: "仙台",
    prefectures: ["宮城", "山形", "福島"],
    stations: ["仙台", "山形", "福島", "酒田", "新庄", "白河", "小名浜"],
  },
  {
    code: "12",
    id: "tohokuN",
    name: "東北北部",
    nameEn: "Northern Tohoku",
    // A geographic pick, unlike the other eleven: 仙台管区気象台 announces both
    // halves of 東北, so this region has no seat of its own to borrow.
    anchor: "青森",
    prefectures: ["青森", "岩手", "秋田"],
    stations: ["青森", "八戸", "秋田", "盛岡", "宮古"],
  },
];

/**
 * Hokkaido — 梅雨 is not defined here, and that is the point.
 *
 * JMA publishes no 梅雨入り or 梅雨明け for 北海道: 梅雨前線は北海道付近では不明瞭と
 * なることが多い. So these sixteen stations belong to no region above, and listing
 * them makes the absence a checked invariant rather than an inference — 86 + 16
 * must equal the 102 features in phenology.geojson.
 */
export const NO_TSUYU = {
  name: "北海道",
  nameEn: "Hokkaido",
  note: "北海道に梅雨はない",
  stations: [
    "稚内",
    "紋別",
    "網走",
    "留萌",
    "旭川",
    "根室",
    "岩見沢",
    "札幌",
    "釧路",
    "帯広",
    "倶知安",
    "室蘭",
    "広尾",
    "浦河",
    "江差",
    "函館",
  ],
};

/**
 * JMA's published 1991–2020 normals as day-of-year, in REGIONS order.
 *
 * This is the guard on the positional CSV parse: tsuyu_iriake.csv is read by
 * column offset, so if JMA ever inserts or reorders a column the parse would
 * quietly attribute one region's dates to another. Asserting the parsed 平年 row
 * against these twelve pairs is what makes that a build failure instead.
 *
 * Transcribed from the 平年 row of the per-region pages, e.g. 東海 6月6日頃 →
 * 7月19日頃 = 157 → 200.
 */
export const EXPECTED_NORMALS = [
  [130, 172], // 沖縄       5/10 → 6/21
  [132, 180], // 奄美       5/12 → 6/29
  [150, 196], // 九州南部   5/30 → 7/15
  [155, 200], // 九州北部   6/4  → 7/19
  [156, 198], // 四国       6/5  → 7/17
  [157, 200], // 中国       6/6  → 7/19
  [157, 200], // 近畿       6/6  → 7/19
  [157, 200], // 東海       6/6  → 7/19
  [158, 200], // 関東甲信   6/7  → 7/19
  [162, 204], // 北陸       6/11 → 7/23
  [163, 205], // 東北南部   6/12 → 7/24
  [166, 209], // 東北北部   6/15 → 7/28
];

/** Substring each CSV region header must contain, in column order. */
export const EXPECTED_HEADERS = REGIONS.map((region) => region.name);
