import { defineConfig } from "vite";

/**
 * The only thing this file exists for is the base path, and it is conditional on
 * the command for a reason.
 *
 * GitHub Pages serves a project site from a subdirectory —
 * `eukarya-biz.github.io/navara-hw-mykyta/` — so a build with the default
 * `base: "/"` emits absolute `/assets/…` URLs that resolve one level above the
 * site root. The page then loads, finds no bundle, and shows nothing at all: the
 * failure is a blank screen with 404s in the console, not a degraded map.
 *
 * Dev keeps `/`. Setting the subpath unconditionally moves the dev server to
 * `localhost:8080/navara-hw-mykyta/`, which breaks every bookmark and every
 * `localhost:8080` in the notes for no benefit — nothing is being served from a
 * subdirectory locally.
 *
 * The GeoJSON fetches need no equivalent. They are relative (`fetch("data/…")`),
 * so they resolve against the page's own URL and follow the base wherever it
 * goes; it is `public/assets/` and the bundle, which Vite rewrites to
 * base-prefixed absolute URLs, that depend on this being right.
 */
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/navara-hw-mykyta/" : "/",
}));
