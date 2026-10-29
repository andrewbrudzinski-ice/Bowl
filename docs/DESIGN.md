# Design system

The look is **black, neutral charcoal and metallic gold**, in Plus Jakarta Sans. Everything visual comes from a small set of tokens in
`src/app/globals.css`; components use those tokens (Tailwind utilities such as `bg-surface`, `text-muted`, `border-line`, or the CSS
classes `.card`, `.btn`, `.tbl`, …), so changing the look is a matter of editing the tokens.

## Themes

| Theme | How it is chosen | Palette |
| --- | --- | --- |
| **Dark** (default) | Every device, unless the person chose otherwise | near-black `#0b0b0b`, charcoal surfaces, soft-white text, gold accent |
| **Light** | Appearance → Light (stored as `sweeper-theme=light` in the browser) | soft gray `#ececec`, near-white surfaces, deeper gold |
| **Auto** | Appearance → Auto (stored as `sweeper-theme=system`) | follows the device's light/dark setting |

`<html data-theme>` is set before first paint by a script in `src/app/layout.tsx`; dark is simply the absence of an attribute. The
switch is `src/components/theme-toggle.tsx` (account menus and the Account page). Print always uses the light palette.

## Tokens (`globals.css`)

- Surfaces: `--color-bg`, `--color-surface` (cards), `--color-raised` (inset tiles, inputs' neighbors), `--color-hover`, `--color-field` (inputs).
- Text: `--color-fg`, `--color-muted` (secondary), `--color-faint` (tertiary/labels).
- Lines: `--color-line` (hairlines), `--color-line-strong` (input borders). Semi-transparent so they work on any surface.
- Status: `--color-win`, `--color-loss`, `--color-warn`, `--color-info`.
- Accent: `--accent` (fill), `--accent-ink` (text drawn on the fill), `--accent-text` (accent as text on the page; a deeper gold in light mode).
- Shadows: `--shadow-sm/md/lg`. Chart series colors: `--chart-1…12` (`chartColor(i)` in `src/components/chart-colors.ts`).

**Contrast:** every text/background pair meets WCAG AA (4.5:1) in both themes. Check it with `node e2e/a11y.mjs` (axe-core on ~38 pages, dark and
light, phone width; it also runs in CI and fails on any violation). If you change a color, run it.

## Accent and leagues

Each league can pick its own accent (League settings → General). The default is gold (`BRAND_ACCENT` in `src/domain/brand.ts`); earlier
defaults (the original blue, the short-lived amber) are treated as "no custom accent". A custom accent sets `--accent`, a readable
`--accent-ink`, and a text-safe `--accent-text` for that league's pages (`src/components/theme.ts`). Gold buttons, progress and logo chips get
their metallic look from a sheen gradient layered over the accent (`.btn-primary`, `.metal`, `.metal-x`), so it works for any color.

## Type

Plus Jakarta Sans, self-hosted (`src/app/fonts`, OFL license included), variable weight, tabular figures for scores (`.num`, `.score`).
Scale: display `.h-display` (36–56px) · page title `.h-page` (28px) · section `.h-section` (16px) · body 15px · small 13px · label 12px
(kicker `.eyebrow` 11.5px uppercase). Tight tracking on large sizes.

## Components

`src/components/ui.tsx` (Card, CardHead with optional sub-line, PageHeader, Stat, Badge, Alert, EmptyState, Tabs, KV, TeamMark, Avatar,
FormChips) plus the CSS classes in `globals.css` (`.btn`, `.input/.select/.textarea`, `.tbl`, `.tab`, `.seg`, `.badge-*`, `.alert-*`).
Team and bowler marks are neutral tiles with a small color dot (the team's own color). Interactive elements transition over 0.2s, press with a
slight scale, and show a clear focus ring.

## Generated images

App icons (`/icons/[size]`, `apple-icon`, `icon`), the link-preview card (`opengraph-image`, `twitter-image`) and the matchup scorecard
(`/l/[slug]/matchup/[id]/scorecard`) are drawn with `next/og`. Two rules learned the hard way:

1. A **number as a direct child** of an element makes the renderer throw ("Expected <div> to have explicit display: flex…"). Wrap values in `String(…)`.
2. Text uses static `.woff` copies of the font (`src/server/og-fonts.ts`); they must ship with serverless builds (`outputFileTracingIncludes` in
   `next.config.mjs`, verified by `npm run check:bundle`). The smoke test fetches a scorecard so a regression fails CI.
