# Tailwind CSS v4 for styling, with the M0 tokens as the theme

The engineering plan left styling open: CSS variables with CSS modules, or Tailwind if M0 preferred it. The M0 design is built on shadcn/ui's neutral theme, whose tokens are Tailwind v4 OKLCH values, so the UI uses Tailwind v4 through `@tailwindcss/vite`. The design's CSS variables, plus Legible's semantic ones (Scope, Risk, Ask, diff colors, syntax), live in `packages/ui/src/styles/index.css` and are mapped to utilities with `@theme inline`, the same way shadcn does it. That gives `bg-unrequested-bg`, `text-critical`, `bg-add` and so on. The light theme swaps the variables under `[data-theme='light']`, so components never mention a theme.

Components use utilities directly. Repeated controls are shadcn-style primitives in `packages/ui/src/components/ui.tsx` (Button, Badge, Callout, Tabs, Switch, Input, Select and others), with variants written in `class-variance-authority` and classes merged with `clsx` + `tailwind-merge` (`cn`).

## Consequences

- There's no hand-written component CSS. The stylesheet holds tokens, the type scale (11/12/13/15/22 px from M0), and two small utilities for Electron's window-drag regions.
- Tailwind scans `packages/ui/src` (`@source`), because the renderer's Vite root is in `apps/desktop`.
- Tests select elements by role, test id or data attribute (`data-kind`, `data-selected`), never by class name.
- oxfmt sorts Tailwind classes against this stylesheet ([ADR 0011](./0011-oxlint-and-oxfmt.md)).
