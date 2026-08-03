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
 * Twenty-one entries over a ~40 s loop is a card every ~1.9 s, and the rolling
 * window of four holds each one on screen for about seven and a half. That
 * pacing is why the loop was slowed from 24 s nominal: at the old rate a card
 * was replaced before it could be read.
 *
 * The pacing is not uniform, and it is the reason a card cannot simply be
 * dropped wherever a finding happens to belong. `TSUYU_HOLD` in main.ts runs
 * days 148–212 at 0.4×, so those 64 days are 14 of the loop's 40 seconds —
 * a third of the reading time for a sixth of the year. It used to carry three
 * cards and now carries six, which is where the four newest findings went and
 * why 猛暑 could finally have more than two: its season opens under 梅雨 in the
 * south in late June, so a 猛暑 card can sit inside the hold and still have
 * something on screen to point at.
 *
 * What that does *not* buy is room in the other two stretches. Days 1–148 and
 * 212–365 each run about 13 s and each carry seven or eight cards, so a new
 * finding there costs every card around it screen time. A card that has to go
 * outside the hold has to be worth that, which is the bar 桜前線は一本の木では
 * ない met and the reason nothing else was added at either end.
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
    // Led with the behaviour rather than with the count. "22 地点は最深積雪 0 cm"
    // is the same finding, but it asks the reader to work out what a maximum
    // depth of zero implies before it can land; this states the implication and
    // keeps the number underneath as the evidence for it.
    day: 43,
    ja: "降っても、積もらない",
    en: "22 of the 142 stations record snow every year and a maximum depth of zero",
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
    id: "sakura-species",
    modeId: "sakura",
    // 根室's 開花 — the last station the front reaches, and the whole point of
    // the card: it gets there on a different tree from the one it started on.
    // Placed outside the hold, which costs the six 桜/雪 cards around it screen
    // time, because the alternative is a card about the front's end arriving a
    // fortnight after the front has ended.
    day: 138,
    ja: "桜前線は一本の木ではない",
    en: "ソメイヨシノ over most of Japan, 寒緋桜 in Okinawa, エゾヤマザクラ in Hokkaido — three species, one line",
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
    id: "natsu-capes",
    modeId: "natsu",
    // 猛暑's first card, and it arrives while the field is still only the
    // southern basins — which is the right moment for a card about the places
    // that never light up at all, because the viewer can still see them not
    // lighting up one by one as the rest of the country fills in.
    day: 180,
    ja: "岬と島には夏が来ない",
    en: "潮岬, 室戸岬, 銚子, 八丈島 — latitudes that are hot everywhere else, held under the line by the sea around them",
  },
  {
    id: "natsu-yamagata",
    modeId: "natsu",
    // The other half of the same absence, and the one that makes the shape of
    // the season legible: the field has a hard northern edge, and it is a
    // latitude rather than a coastline.
    day: 192,
    ja: "山形 38.3°N が北限",
    en: "仙台 and 石巻 sit at the same latitude and never get there — 猛暑 stops at Tohoku, which is 雪's map with the colours swapped",
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
    id: "tsuyu-1993",
    modeId: "tsuyu",
    // Deliberately right behind the card above, as its instance: 26 undetermined
    // 明け across 75 years is a statistic, and one summer holding ten of them is
    // what the statistic was hiding.
    day: 209,
    ja: "1993 年だけで十地方",
    en: "one summer accounts for ten of those 26 — every region except 沖縄 and 奄美",
  },
  {
    id: "natsu-inland",
    modeId: "natsu",
    // Two days before the peak, when all 101 stations are above the line at
    // once and the contrast this card is about is at its widest.
    day: 220,
    ja: "京都 33.8 °C · 那覇 32.1 °C",
    en: "the hottest place in Japan is not the southernmost — a basin ringed by hills has nothing to moderate it",
  },
  {
    id: "natsu-none",
    modeId: "natsu",
    // Late in the season, by which point the empty north has been on screen for
    // six weeks and the card names something the viewer is already looking at.
    //
    // Twenty-seven days after the one above rather than ten: days 212–259 run at
    // the clock's full rate, so ten days here is under a second of screen time.
    // A third 猛暑 card would have to sit inside that same stretch and there is
    // no room for it — see the pacing note at the top of this file.
    day: 247,
    ja: "北海道に真夏日はない",
    en: "56 of 157 stations never reach a 30 °C monthly mean — all of Hokkaido, the high ground, and the capes",
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
    id: "icho-later",
    modeId: "icho",
    // Was 紅葉と銀杏は同じ地点, which explained why the two autumn markers sit
    // slightly off their station rather than saying anything about Japan. A note
    // about the drawing is not a finding, and it was the only card 銀杏 had — so
    // the one mode with no finding of its own now carries the one number that is
    // genuinely its own.
    day: 300,
    ja: "銀杏も 10.0 日遅い",
    en: "median at 62 of 68 stations — the ginkgo moved with the maple, not with the cherry",
  },
  {
    id: "kouyou-stretching",
    modeId: "kouyou",
    // The closing card, and the only one that is about the whole dataset rather
    // than about one season. Stated as a movement rather than as the two numbers
    // again — both have already been cards by now, and repeating them reads as a
    // summary slide.
    day: 314,
    ja: "春と秋は逆向きに離れていく",
    en: "spring pulls 4.7 days earlier and autumn pushes 11.8 later — the growing season is stretching at both ends",
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
