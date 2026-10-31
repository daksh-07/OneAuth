# Design system: "Calm Signal"

## Directions considered
1. **Calm Signal** (chosen): cool slate neutrals, a single blue signal colour used sparingly, semantic colours reserved for state. Reads as trustworthy infrastructure without being cold.
2. **Graphite Warmth**: warm greys with a copper accent. Distinctive, but copper fights the amber warning colour, which carries real meaning here (temporary access).
3. **Ink & Emerald**: near-black with an emerald accent. Strong, but emerald must mean "verified/success", so using it as the brand colour would blur state.

## Brand mark
An identity node (accent) inside an **open** ring, with one device node sitting in the opening: access granted through a deliberate gap, not a padlock. It's legible at 16px, and `app/icon.svg` provides the app icon. The hero "trust graph" extends the motif: one identity, a phone that approves, an owned laptop (solid link), and a temporary screen (dashed, animated link in amber).

## Tokens (`app/globals.css`)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `canvas` | #F8FAFC | #080D16 | Page background |
| `surface` | #FFFFFF | #111827 | Cards and panels |
| `sunken` | #F1F4F8 | #0C121D | Wells, icon tiles, hover |
| `raised` | #FFFFFF | #172033 | Dialogs, toasts |
| `fg` | #101828 | #F9FAFB | Primary text |
| `muted` | #5D6679 | #98A2B3 | Secondary text (darkened from #667085 to pass AA on `sunken`) |
| `line` / `line-strong` | #E4E7EC / #CDD3DC | #263244 / #34425A | Borders |
| `accent` | #2563EB | #4F8CFF | Primary actions, focus, selection |
| `accent-fg` | #FFFFFF | #050B16 | Text on accent (dark text in dark mode: white fails on #4F8CFF) |
| `success` / `warning` / `danger` | #047857 / #A14A06 / #C81E1E | #34D399 / #FBBF24 / #F87171 | State only |

Every text/background pair used is verified ≥ 4.5:1 by `tests/unit/contrast.test.ts` in both themes. A test also keeps the media-query and manual dark blocks identical.

Theme: follows the system by default. A manual Light/Dark override is stored in an `oa_theme` cookie and applied server-side (no flash, no inline script).

## Typography
Geist Sans (OFL) for UI and Geist Mono for codes. Scale: 11, 12, 13, 14, 15, 17, 20, 24, 28, 34, 44, 56px. Headings use −0.02em to −0.035em tracking and `text-wrap: balance`. Numbers use `tabular-nums`. Pairing codes are mono with +0.12em tracking for readability across a room.

## Spacing, radius, elevation
- 4px base rhythm (Tailwind spacing). Cards pad 20px (`p-5`); hero sections 64–96px vertically.
- Radius: controls 8px, cards 14px, panels and sheets 20px, pills full.
- Shadows: `low` (resting cards), `mid` (floating nodes, QR), `high` (dialogs, toasts, FAB). The tint follows the theme.

## Layout
- Breakpoints: Tailwind defaults (`sm` 640, `md` 768, `lg` 1024).
- App: below `lg`, a top bar plus bottom navigation with a raised central **Connect** button. At `lg` and above, a 256px sidebar with the Connect button at the top. Content max width is 1024px.
- Each screen has one primary purpose and one primary action.

## Motion
`fade-up` (360ms) for page entry, `scale-in` (220ms) for state changes and dialogs, `pulse-ring` while a pairing request waits, and a dashed flow on temporary links. Everything is disabled under `prefers-reduced-motion`. No animation implies success before the server confirms it: success screens render only after the API returns.

## Components
`components/ui`: Button / ButtonLink (primary, secondary, ghost, danger; sm, md, lg; loading), Panel / PanelHeader / PageHeader, Badge (5 tones, dot), Notice (info, success, warning, danger), Field / Input (label, hint and error wiring), Dialog (centred on desktop, bottom sheet on mobile), Toast, EmptyState, Skeleton, RelativeTime / Countdown (one shared clock).
`components/app`: AppShell, DeviceIcon, ActivityList, RevokeDeviceButton, SignOutButton, SharedDeviceToggle, NoAccess.

## Not yet built
Command search (⌘K), file browser, file grid and list, upload progress, storage meter, tooltip primitive, responsive table. These arrive with the Cloud work.
