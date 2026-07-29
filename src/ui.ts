import { MODES, sampleRamp, type Mode } from "./modes";

const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

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
    el("p", "ui-sub", "Japan's seasonal fronts · 気象庁 生物季節観測 1953–2026"),
  );

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

  const hint = el(
    "div",
    "ui-hint",
    "複数選択できます · toggle any combination",
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

  root.append(title, side, bottom);
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
    // One shared vertical scale across the selected modes, so the curves stay
    // comparable rather than each being normalised to its own peak.
    const max = Math.max(
      1,
      ...shown.flatMap((s) => s.profile),
    );
    const xOf = (day: number) => ((day - 1) / 364) * width;
    const yOf = (value: number) => height - (value / max) * (height - 2) - 1;

    for (const { mode, profile } of shown) {
      const accent = accentOf(mode);
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let day = 1; day <= 365; day += 1) ctx.lineTo(xOf(day), yOf(profile[day]));
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = `${accent}1f`;
      ctx.fill();

      ctx.beginPath();
      for (let day = 1; day <= 365; day += 1) {
        const x = xOf(day);
        const y = yOf(profile[day]);
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
      if (document.activeElement !== scrub) {
        scrub.value = String(Math.round(state.day));
      }

      for (const { mode, active, total } of state.series) {
        const on = state.selected.has(mode.id);
        const value = countEls.get(mode.id);
        if (value) {
          value.textContent = on ? `${active} / ${total}` : "—";
          value.style.color = on ? accentOf(mode) : "#5b6875";
        }
        countEls.get(mode.id)?.parentElement?.classList.toggle("is-off", !on);
        pillEls.get(mode.id)?.classList.toggle("is-active", on);
      }

      drawGraph(state);
    },
  };
}
