/**
 * The findings, as a feed.
 *
 * These used to be three labels pinned over the map — one over Hokkaido, two out
 * at sea either side of the spine. That device could only ever hold three
 * statements, it covered the terrain it was pointing at, and it appeared and
 * disappeared with a *pill* rather than with the season, so a fact about 梅雨's
 * arrival was on screen in January.
 *
 * A feed fixes all three. Each entry carries the day it becomes true, so the
 * findings arrive in the order the year makes them, and they can be about things
 * the camera cannot show: the framing excludes the Ryukyus, so 南西諸島に雪はない
 * could never be a map label, but it is one of the two halves of what 雪 has to
 * say and it is a perfectly good card.
 *
 * Every number here is established in README.md, and most of them come from the
 * three build scripts' own output rather than from prose — so this file is a
 * presentation of the dataset, not a second source for it. Keep it that way: if
 * a figure is not already in the README, it does not belong in a card.
 *
 * Plain data with no imports, the same posture modes.ts takes, so nothing here
 * can drift into depending on the view.
 */
export type Fact = {
  id: string;
  /**
   * The pill that must be on for this card to appear. A finding about a season
   * the viewer has switched off is noise, and this is the same rule the map
   * labels followed.
   */
  modeId: string;
  /**
   * Day-of-year the card enters the feed — 1..365, matching the clock main.ts
   * advances. Chosen to be the day the finding is *about* where it has one
   * (九州北部's 梅雨入り, 稚内's 終雪) and otherwise a day the season is on screen,
   * because a card that arrives before its season does has nothing to point at.
   */
  day: number;
  /** The headline. Usually the number, because the number is the finding. */
  ja: string;
  /** One clause of English underneath — the mechanism or the comparison. */
  en: string;
};

/**
 * Sorted by `day`. ui.ts relies on that ordering to take the newest few without
 * sorting per frame, so keep it sorted when adding to it.
 *
 * Fifteen entries over a ~40 s loop is a card every ~2.7 s, and the rolling
 * window of four holds each one on screen for about eleven. That pacing is why
 * the loop was slowed from 24 s nominal: at the old rate a card was replaced
 * before it could be read.
 */
export const FACTS: Fact[] = [
  {
    id: "yuki-monsoon",
    modeId: "yuki",
    // Deep winter, when the whole deck is painted and the streaks are at their
    // most legible — the one card that explains the shape of everything else.
    day: 8,
    ja: "シベリアの寒気が日本海を渡る",
    en: "cold air off the continent picks up moisture over the warm current, and unloads it on the windward side",
  },
  {
    id: "yuki-kanazawa",
    modeId: "yuki",
    day: 22,
    ja: "金沢 157 cm · 東京 8 cm",
    en: "one degree of latitude apart, nineteen times the snowfall",
  },
  {
    id: "yuki-zero",
    modeId: "yuki",
    day: 43,
    ja: "22 地点は最深積雪 0 cm",
    en: "of 142 — it falls there every year, and never lies",
  },
  {
    id: "sakura-elevation",
    modeId: "sakura",
    day: 95,
    ja: "標高 100 m ごとに 2〜3 日遅く",
    en: "so the front bends around the Alps instead of crossing them as a line",
  },
  {
    id: "sakura-earlier",
    modeId: "sakura",
    day: 106,
    ja: "30 年で 4.7 日早く",
    en: "median, at 90 of 96 stations · 1953–1982 against 1996–2025",
  },
  {
    id: "sakura-subtropical",
    modeId: "sakura",
    day: 118,
    ja: "南西諸島だけ逆に遅く",
    en: "名護 +9.0 days — warm winters no longer supply the chilling that breaks dormancy",
  },
  {
    id: "yuki-wakkanai",
    modeId: "yuki",
    // 稚内's 終雪. The one season that runs off both ends of the timeline, and
    // this is the day it finally lets go.
    day: 130,
    ja: "稚内 10月19日 → 5月10日",
    en: "203 days — the only season here that crosses the new year",
  },
  {
    id: "tsuyu-hokkaido",
    modeId: "tsuyu",
    // 九州北部's 梅雨入り, the day the mainland turns on.
    day: 155,
    ja: "北海道に梅雨はない",
    en: "the front runs south to north, and then stops at the Tsugaru Strait",
  },
  {
    id: "tsuyu-sheet",
    modeId: "tsuyu",
    // 東北北部's 梅雨入り — eleven days after the card above, which is the finding.
    day: 166,
    ja: "本土は 11 日で梅雨入り",
    en: "九州北部 6月4日 → 東北北部 6月15日 · 桜 takes 110 days over the same ground",
  },
  {
    id: "tsuyu-fuzzy",
    modeId: "tsuyu",
    // 7月19日, the day five regions end together.
    day: 200,
    ja: "明けの方が決めにくい",
    en: "1951–2025: 2 梅雨入り could not be determined, against 26 梅雨明け",
  },
  {
    id: "kouyou-descends",
    modeId: "kouyou",
    day: 263,
    ja: "大雪山から下りてくる",
    en: "colour starts once minimum temperatures fall below about 8 °C, so it begins on the peaks",
  },
  {
    id: "kouyou-later",
    modeId: "kouyou",
    day: 290,
    ja: "30 年で 11.8 日遅く",
    en: "median, at 66 of 69 stations — autumn has moved more than spring has",
  },
  {
    id: "icho-shared",
    modeId: "icho",
    day: 300,
    ja: "紅葉と銀杏は同じ地点",
    en: "overlapping windows at one station, so each marker sits a little off its point",
  },
  {
    id: "kouyou-stretching",
    modeId: "kouyou",
    day: 314,
    ja: "生長期間は両端に伸びている",
    en: "spring 4.7 days earlier, autumn 11.8 days later",
  },
  {
    id: "yuki-none",
    modeId: "yuki",
    // The mirror of 北海道に梅雨はない, and the reason this feed exists: the camera
    // frames Kyushu→Hokkaido, so this fact is about places off the edge of the
    // frame and no map label could have carried it.
    day: 339,
    ja: "南西諸島に雪はない",
    en: "15 stations record no 雪 at all — 沖縄, 奄美, 種子島, 屋久島, 小笠原",
  },
];
