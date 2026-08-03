import { FACTS, type Fact } from "./facts";
import { MODES, MONTH_STARTS, sampleRamp, type Mode } from "./modes";

/**
 * Opacity by position in the feed, newest first — and, by its length, how many
 * cards the feed holds at once.
 *
 * Depth by *position* rather than by age in the data: the top card is the one
 * being read and the ones under it are context receding. Set inline by `place`
 * rather than in ui.css, because a card's position is a flex `order` and
 * `:nth-child` would key off DOM order instead.
 *
 * Four entries: enough that a finding is still on screen while the next two
 * arrive — about eleven seconds at the loop's pace, against a card every ~2.7 —
 * and few enough that the column clears the timeline at the bottom of the frame
 * without needing to scroll.
 */
const FEED_FADE = [1, 0.78, 0.52, 0.3];

/** Derived, so the window and the fade can never disagree about its size. */
const FEED_LIMIT = FEED_FADE.length;

export function doyToLabel(day: number) {
  const clamped = Math.min(Math.max(Math.round(day), 1), 365);
  let month = 11;
  while (month > 0 && MONTH_STARTS[month] >= clamped) month -= 1;
  return { month: month + 1, day: clamped - MONTH_STARTS[month] };
}

export function accentOf(mode: Mode) {
  return `#${sampleRamp(mode.ramp, 0.35).toString(16).padStart(6, "0")}`;
}

export type UiState = {
  day: number;
  selected: Set<string>;
  playing: boolean;
  /** Per-mode active count, total count, and day-of-year profile. */
  series: {
    mode: Mode;
    active: number;
    total: number;
    profile: number[];
  }[];
};

export type Ui = {
  onModeToggle(fn: (modeId: string) => void): void;
  onScrub(fn: (day: number) => void): void;
  onTogglePlay(fn: () => void): void;
  render(state: UiState): void;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createUi(container: HTMLElement): Ui {
  const root = el("div", "ui");

  const title = el("div", "ui-title");
  title.append(
    el("h1", undefined, "日本の季節前線"),
    el(
      "p",
      "ui-sub",
      "Japan's seasonal fronts · 気象庁 生物季節観測 1953–2026 · " +
        "梅雨入り明け 1951–2025 · 地上気象観測平年値 1991–2020",
    ),
  );

  /**
   * The findings, as a column of cards under the title.
   *
   * This replaces three labels absolutely positioned over the map — see
   * facts.ts for why that device was retired. What matters here is that the feed
   * is a *pure function* of the day and the selection, computed fresh in
   * `render`: no accumulated state, so scrubbing backwards removes cards, the
   * year wrap in main.ts empties the column by itself, and there is no reset
   * hook to forget to call.
   */
  const feed = el("div", "ui-feed");
  const feedNodes = new Map<string, HTMLElement>();
  const modeById = new Map(MODES.map((mode) => [mode.id, mode]));
  /** First render mounts what is already due without animating it in — see below. */
  let feedMounted = false;

  function buildCard(fact: Fact) {
    const mode = modeById.get(fact.modeId);
    const node = el("div", "ui-card");
    if (mode) node.style.setProperty("--accent", accentOf(mode));
    const { month, day } = doyToLabel(fact.day);
    const head = el("div", "ui-card-head");
    head.append(
      el("span", "ui-card-date", `${month}月${day}日`),
      el("span", "ui-card-mode", mode?.label ?? fact.modeId),
    );
    node.append(
      head,
      el("div", "ui-card-ja", fact.ja),
      el("div", "ui-card-en", fact.en),
    );
    return node;
  }

  /**
   * Puts a card in its place: how far down the column it sits, and how far it has
   * receded.
   *
   * Position comes from flex `order` rather than from DOM order, which is the
   * one decision here worth defending. Reconciling by insertion cannot keep the
   * column in sequence: a backwards scrub changes the visible set in *both*
   * directions at once — old cards return while new ones leave — and inserting
   * only the arrivals then interleaves them wrongly (observed: two 桜 cards
   * landing under two 雪 cards from a month earlier). Re-appending every node in
   * the right order each frame would fix the sequence but re-inserts live nodes,
   * which cancels their transitions mid-flight. `order` is a plain style, so a
   * card's rank can change without it ever moving in the DOM.
   */
  function place(node: HTMLElement, rank: number) {
    node.style.order = String(rank);
    node.style.opacity = String(FEED_FADE[rank] ?? 0);
    node.style.transform = "none";
  }

  /**
   * Reconciles the column against the facts that are true on this day.
   *
   * A rolling window rather than the whole year's worth: the four newest, the
   * older ones receding, so the column reads as a feed and cannot outgrow the
   * frame.
   */
  function drawFeed(state: UiState) {
    // FACTS is sorted by day, so the newest few are simply the tail.
    const due = FACTS.filter(
      (fact) => fact.day <= state.day && state.selected.has(fact.modeId),
    );
    const shown = due.slice(-FEED_LIMIT);
    const ids = new Set(shown.map((fact) => fact.id));

    for (const [id, node] of feedNodes) {
      if (ids.has(id)) continue;
      node.remove();
      feedNodes.delete(id);
    }

    shown.forEach((fact, index) => {
      // `shown` is oldest-first, and rank 0 is the newest card at the top.
      const rank = shown.length - 1 - index;
      const existing = feedNodes.get(fact.id);
      if (existing) {
        place(existing, rank);
        return;
      }

      const node = buildCard(fact);
      feedNodes.set(fact.id, node);
      feed.append(node);

      // The clock starts at day 60, so several winter cards are already due on
      // the first frame. Animating those in would open the piece with a flurry
      // of cards about a season the viewer has not watched arrive, so the first
      // pass mounts them as settled history and only later arrivals animate.
      if (!feedMounted) {
        place(node, rank);
        return;
      }

      // Mounted in the state it transitions *from* — a transition needs two
      // frames holding different values to run at all. On a frame rather than on
      // the next render, because main.ts stops rendering while the clock is
      // paused, and a card that arrived on the last rendered frame — which is
      // exactly what ending a drag produces — would otherwise never settle.
      //
      // The arrival is a slide and deliberately *not* a fade from zero. A card
      // whose visibility depends on a transition running is a card that is
      // invisible whenever one does not: a throttled document (verified — a
      // hidden tab pins the transition at a few percent and the whole feed
      // reads as blank), reduced-motion, a stalled compositor. Starting at the
      // card's real opacity means the worst a frozen transition can do is leave
      // it six pixels high.
      node.style.order = String(rank);
      node.style.opacity = String(FEED_FADE[rank] ?? 0);
      node.style.transform = "translateY(-6px)";
      requestAnimationFrame(() => place(node, rank));
    });

    feedMounted = true;
  }

  // Readout and pills sit on the right, over open Pacific: the archipelago runs
  // diagonally through the lower-left, so a centred control bar would cover
  // Shikoku and Kyushu.
  const side = el("div", "ui-side");
  const dateEl = el("div", "ui-date");

  const counts = el("div", "ui-counts");
  const countEls = new Map<string, HTMLElement>();

  const pills = el("div", "ui-pills");
  const pillEls = new Map<string, HTMLButtonElement>();

  for (const mode of MODES) {
    const row = el("div", "ui-count-row");
    const swatch = el("span", "ui-swatch");
    swatch.style.background = accentOf(mode);
    const value = el("span", "ui-count-value");
    row.append(swatch, el("span", "ui-count-label", mode.label), value);
    countEls.set(mode.id, value);
    counts.append(row);

    const pill = el("button", "ui-pill") as HTMLButtonElement;
    pill.type = "button";
    pill.dataset.mode = mode.id;
    pill.title = `${mode.labelEn} — ${mode.direction}`;
    pill.style.setProperty("--accent", accentOf(mode));
    pill.append(
      el("span", "ui-pill-ja", mode.label),
      el("span", "ui-pill-en", mode.labelEn),
    );
    pillEls.set(mode.id, pill);
    pills.append(pill);
  }

  // The clock starts stopped (see main.ts), so the first line has to be the one
  // that starts it. Scrubbing is the second thing a viewer reaches for, and
  // stays on the second line.
  const hint = el("div", "ui-hint");
  hint.append(
    el("div", undefined, "▶ で一年が動きます · press play to run the year"),
    el("div", undefined, "ドラッグで日付を移動 · drag the timeline"),
    el("div", undefined, "複数選択できます · toggle any combination"),
  );
  side.append(dateEl, counts, pills, hint);

  const bottom = el("div", "ui-bottom");
  const playBtn = el("button", "ui-play") as HTMLButtonElement;
  playBtn.type = "button";
  const graph = el("canvas", "ui-graph") as HTMLCanvasElement;
  const scrub = el("input", "ui-scrub") as HTMLInputElement;
  scrub.type = "range";
  scrub.min = "1";
  scrub.max = "365";
  scrub.step = "1";
  const months = el("div", "ui-months");
  for (const m of ["1月", "3月", "5月", "7月", "9月", "11月"]) {
    months.append(el("span", undefined, m));
  }
  const track = el("div", "ui-track");
  track.append(graph, scrub, months);
  bottom.append(playBtn, track);

  root.append(title, feed, side, bottom);
  container.append(root);

  const toggleHandlers: ((modeId: string) => void)[] = [];
  const scrubHandlers: ((day: number) => void)[] = [];
  const playHandlers: (() => void)[] = [];

  pills.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest(
      ".ui-pill",
    ) as HTMLButtonElement | null;
    if (button?.dataset.mode) {
      toggleHandlers.forEach((fn) => fn(button.dataset.mode as string));
    }
  });
  scrub.addEventListener("input", () => {
    scrubHandlers.forEach((fn) => fn(Number(scrub.value)));
  });
  playBtn.addEventListener("click", () => playHandlers.forEach((fn) => fn()));

  /* --- scrubbing the whole timeline zone ---------------------------------- */

  /**
   * The graph is the thing that *looks* like a timeline, so it should be the
   * thing you can grab. The range input alone gave an 11-pixel thumb under a
   * 46-pixel chart, and the chart was inert.
   *
   * The whole `.ui-track` band — graph, slider and month row — becomes the
   * control, and the input keeps its job as the *keyboard* control: ui.css takes
   * it out of hit-testing so a drag is never handled twice, and `pointer-events`
   * does not affect tab focus or arrow keys, which still arrive as `input`
   * events on the same channel below.
   */
  /** Whether a pointer is currently steering the clock; gates `pointermove`. */
  let dragging = false;

  /**
   * Pointer x → day, measured against the canvas rather than the track so it is
   * the same mapping `drawGraph`'s `xOf` inverts. Anything else and the cursor
   * line would sit slightly off the pointer that placed it.
   */
  function dayAt(clientX: number) {
    const rect = graph.getBoundingClientRect();
    if (rect.width === 0) return 1;
    const t = (clientX - rect.left) / rect.width;
    return Math.min(Math.max(Math.round(1 + t * 364), 1), 365);
  }

  function scrubTo(clientX: number) {
    const day = dayAt(clientX);
    scrubHandlers.forEach((fn) => fn(day));
  }

  track.addEventListener("pointerdown", (event) => {
    dragging = true;
    // Capture, so a drag that leaves the 65-pixel band — which is easy, it is a
    // horizontal gesture in a short strip — keeps steering the clock instead of
    // stopping dead at the edge.
    track.setPointerCapture(event.pointerId);
    // Otherwise a drag across the overlay selects the month labels.
    event.preventDefault();
    scrubTo(event.clientX);
  });
  track.addEventListener("pointermove", (event) => {
    if (dragging) scrubTo(event.clientX);
  });
  // `lostpointercapture` rather than `pointerup` + `pointercancel`: capture is
  // released implicitly by both of those and by the element going away, and this
  // fires for all of them. One listener that cannot leave the drag stuck on.
  track.addEventListener("lostpointercapture", () => {
    dragging = false;
  });

  let graphKey = "";

  function drawGraph(state: UiState) {
    const dpr = window.devicePixelRatio || 1;
    const width = graph.clientWidth;
    const height = graph.clientHeight;
    if (width === 0 || height === 0) return;
    const key = `${width}x${height}:${dpr}`;
    if (key !== graphKey) {
      graph.width = Math.round(width * dpr);
      graph.height = Math.round(height * dpr);
      graphKey = key;
    }
    const ctx = graph.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const shown = state.series.filter((s) => state.selected.has(s.mode.id));
    // The station modes share one vertical scale, so they stay comparable with
    // each other rather than each being normalised to its own peak.
    const stationMax = Math.max(
      1,
      ...shown.filter((s) => !s.mode.regional).flatMap((s) => s.profile),
    );
    const xOf = (day: number) => ((day - 1) / 364) * width;
    // Takes a 0..1 fraction rather than a raw count, because the four modes do not
    // all arrive in the same unit.
    const yOf = (unit: number) => height - unit * (height - 2) - 1;

    /**
     * A day's value as a fraction of the top of the graph.
     *
     * 梅雨 counts 12 地方 against the others' ~90 地点, which is not the same
     * quantity: on the shared count scale it would be a flat line pinned to the
     * axis, invisible in exactly the gap it exists to fill. So it is plotted as a
     * share of its own denominator instead — all 12 regions inside 梅雨 reaches the
     * top of the graph, the same place the station curves reach at their own peaks.
     */
    const unitOf = (s: UiState["series"][number], day: number) =>
      s.mode.regional
        ? s.profile[day] / Math.max(s.total, 1)
        : s.profile[day] / stationMax;

    // 梅雨 first, so it sits behind the station curves the way its band did.
    const ordered = [...shown].sort(
      (a, b) => Number(!!b.mode.regional) - Number(!!a.mode.regional),
    );

    for (const series of ordered) {
      const accent = accentOf(series.mode);
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let day = 1; day <= 365; day += 1) {
        ctx.lineTo(xOf(day), yOf(unitOf(series, day)));
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = `${accent}1f`;
      ctx.fill();

      ctx.beginPath();
      for (let day = 1; day <= 365; day += 1) {
        const x = xOf(day);
        const y = yOf(unitOf(series, day));
        if (day === 1) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `${accent}d9`;
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }

    const cursorX = xOf(Math.round(state.day));
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, height);
    ctx.strokeStyle = "#ffffff59";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  return {
    onModeToggle: (fn) => toggleHandlers.push(fn),
    onScrub: (fn) => scrubHandlers.push(fn),
    onTogglePlay: (fn) => playHandlers.push(fn),
    render(state) {
      const { month, day } = doyToLabel(state.day);
      dateEl.textContent = `${month}月${day}日`;
      playBtn.textContent = state.playing ? "⏸" : "▶";
      // Unconditional now. This used to be guarded by
      // `document.activeElement !== scrub`, so that `render` could not fight a
      // native thumb drag — and there is no native thumb drag any more, because
      // ui.css takes the input out of hit-testing and the track drives the clock
      // itself. Any guard here is in fact a bug: main.ts stops the clock when
      // scrubbed, so the frame that ends a drag is the *last* frame for a while,
      // and a guard that skipped it would leave the thumb behind until playback
      // resumed.
      scrub.value = String(Math.round(state.day));

      for (const { mode, active, total } of state.series) {
        const on = state.selected.has(mode.id);
        const value = countEls.get(mode.id);
        if (value) {
          // The unit is spelled out because it is no longer the same for every
          // row: three modes count observation stations and 梅雨 counts 地方, and
          // `8 / 12` in the same column as `43 / 96` would otherwise read as a
          // collapse rather than a different denominator.
          value.textContent = on ? `${active} / ${total} ${mode.unit}` : "—";
          value.style.color = on ? accentOf(mode) : "#5b6875";
        }
        countEls.get(mode.id)?.parentElement?.classList.toggle("is-off", !on);
        pillEls.get(mode.id)?.classList.toggle("is-active", on);
      }

      drawFeed(state);
      drawGraph(state);
    },
  };
}
