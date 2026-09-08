# No Excuses visual system

This is the visual design contract for future No Excuses website and member-app work. It records the direction approved from the supplied `ne-wall-accent.html` and `ne-wall-page.html` references without treating their sample copy, navigation, data, or interactions as product requirements.

The implementation hierarchy is:

1. `CONTEXT.md`, accepted ADRs, and resolved product issues define behavior, privacy, safety, and terminology.
2. `docs/implementation/screen-state-accessibility-contracts.md` defines app navigation, states, semantic order, and accessible interaction.
3. This document defines presentation. Where a reference conflicts with either source above, preserve this visual language and replace the conflicting content or behavior.

## Design thesis

No Excuses should feel like a private training record made public to exactly the friends whose opinion matters: blunt, disciplined, competitive, and earned. It is not a wellness dashboard, lifestyle brand, or public social network.

The signature is **the proof grid**: dense square imagery, hard status marks, and week dividers that make consistency visible at a glance. The grid presents authorized Verified Proof pairs during their bounded retention period and durable structured outcomes afterward, as described under [The Wall](#the-wall).

## Core palette

The approved accent is the **yellow scheme** from the accent reference. The source file calls that scheme `Signal`; this document uses the product-facing name **Safety yellow** because the requested direction identifies the yellow option as “Safety.” Do not use the orange scheme that the source file labels `Safety`.

| Token | Value | Use |
| --- | --- | --- |
| `color.ground` | `#0A0A0A` | Page and app-shell background |
| `color.surface` | `#111111` | Raised or grouped regions |
| `color.ink` | `#E8E8E8` | Primary text and high-emphasis rules |
| `color.safety` | `#FFD400` | Primary actions, current selection, progress, focus, and verified accents |
| `color.inkOnSafety` | `#0A0A0A` | Text and icons on Safety yellow |
| `color.muted` | `#898989` | Secondary text; verify contrast at the rendered size |
| `color.quiet` | `#565656` | Decorative or disabled detail only; never essential copy |
| `color.rule` | `#2A2A2A` | Borders, separators, and empty cells |

Safety yellow is an accent, not a wash. Use it for one dominant action or state cue in a region, then let charcoal, type, imagery, and spacing carry the rest. It must never be the only indication of status.

Semantic warning, destructive, safety, success, and pending states need their own accessible text and icon/shape treatment. Do not redefine them all as Safety yellow.

## Typography

| Role | Family | Treatment |
| --- | --- | --- |
| Display | Anton, with a condensed system fallback | Uppercase, regular weight, tight line height (`0.86–0.94`), restrained tracking (`0–0.01em`) |
| Body | Archivo, with system sans-serif fallback | Regular 400; 600 for emphasis; comfortable line height (`1.45–1.6`) |
| Utility | Archivo | 700, uppercase, `0.10–0.14em` tracking for short labels, filters, dates, and status keys |
| Numeric | Archivo tabular numerals | Counts, targets, dates, and standings; large display numbers may use Anton |

Headlines are statements, not labels. Use the condensed display face for short, forceful phrases such as `EVERY REP COUNTS.` and `THE WALL REMEMBERS.` Do not set paragraphs, form fields, instructions, or long accessibility text in Anton or all caps.

Recommended responsive display steps are `clamp(3.5rem, 10vw, 9.5rem)` for page theses, `clamp(2.75rem, 7vw, 7rem)` for section statements, and `1.5–2.5rem` for card or week titles. Body copy starts at `1rem`; explanatory lead copy may use `1.125rem`.

Google Fonts in the references are a prototype convenience, not permission to send member data to a third-party font service. Production must package or otherwise serve approved fonts through the selected privacy-safe delivery path and provide metric-compatible fallbacks.

## Shape, rules, and elevation

- Default to square corners and one-pixel rules. The product should feel assembled, not cushioned.
- Use a two-pixel border for selected filters and high-priority controls; use a three-pixel visible focus ring with at least three pixels of offset.
- Avoid soft shadows, glass effects, glossy gradients, floating pills, and decorative rounded cards.
- Keep imagery square unless a screen contract requires a different crop. Never crop away the meaning needed to review Proof.
- Use dashed outlines for an unfilled slot and diagonal hatching for a pending state, always paired with visible status text.
- Use grayscale or subdued image treatment only when it does not obscure reviewable evidence. A Proof detail view must present the source image clearly.

## Spacing and responsive grid

Use a four-pixel base with a practical sequence of `4, 8, 12, 16, 24, 32, 40, 64, 80, 96` pixels.

- Website content: maximum width `1400px`; page gutters `40px` on wide screens, `20–24px` on compact screens.
- Member app: edge gutters `16–20px`; dense internal gaps `6–12px`; major screen sections `24–40px` apart.
- Long marketing sections use large vertical intervals (`64–96px`) separated by rules.
- Two-column layouts collapse to one column when text, actions, or media would become cramped, not at one universal device width.
- At roughly 200-percent text, the app follows the existing contract: one column, Activity photo before Member-presence photo, labeled-list standings, no clipped action or status.

### Website composition

```text
NO EXCUSES                     HOW IT WORKS  PROOF  THE WALL  RULES  LOG IN
──────────────────────────────────────────────────────────────────────────
NO EXCUSES.
JUST PROOF.                         concise explanation + primary action
──────────────────────────────────────────────────────────────────────────
moving proof/accountability line (static when reduced motion is requested)
──────────────────────────────────────────────────────────────────────────
section thesis                    structured demonstration or real content
```

The homepage hero is the thesis: oversized stacked display type, with the second line outlined in Safety yellow. Preserve a clear primary action and a quieter secondary action. Navigation and copy must reflect the actual website information architecture when that work is specified; the reference links are illustrative.

### Member-app composition

The visual layer does not change the accepted task-first semantic order:

```text
global status or pause banner
screen thesis / current accountability week
NEEDS YOU — one dominant action
your weekly progress
friend Proof feed
compact Season standings
HOME | GROUP | SEASON | YOU
```

On wide layouts, the Proof feed may occupy the dominant column with standings in a narrow sticky rail. On compact layouts, preserve the semantic order above and remove stickiness.

## Component language

### Buttons and links

- Primary: Safety-yellow rectangle, black label, minimum `48×48px` target.
- Secondary: transparent charcoal background, high-contrast one-pixel border, light label.
- Tertiary: underlined text or a quiet rectangular action; never rely on a hidden hover affordance.
- Destructive and safety actions use explicit wording and their defined semantic treatment, not the primary-action color by default.
- Use sentence case for app actions. Marketing navigation may use short uppercase utility labels.

### Status marks

Every state combines text with a shape or icon:

| State | Visual grammar | Example text |
| --- | --- | --- |
| Verified completion | Filled Safety-yellow square plus check | `Verified` |
| Provisional or awaiting review | Hatched square plus clock/status icon | `Awaiting review` |
| Questioned | Outlined square plus question mark | `Questioned` |
| Unsupported or rejected | Distinct outlined/error mark | `Unsupported` or `Rejected` |
| Target slot not completed | Dashed empty square | `Not completed` |
| Not applicable or rest | No tile or a clearly labeled neutral state | `No workout planned` |

Do not use `Never sent` as a general synonym for every empty outcome. Use the canonical state that authoritative data supports.

### Proof presentation

Every submitted Workout report contains exactly two photos:

- The Activity photo is dominant.
- The Member-presence photo is secondary but remains large enough to understand and review.
- Each photo keeps its own factual description and role label.
- Actions to react, motivate, verify, question, or recuse remain text-labeled and visually distinct; reaction is never presented as verification.
- A feed card can be visually dense, but the detail route must expose complete structured report facts, image descriptions, times, status, and next action.

The one-photo hero and optional-photo mosaic shown in older prototypes are superseded states and must not be implemented for submitted reports.

### Tables, standings, and filters

- Tables use horizontal rules, compact utility headings, tabular numerals, and no zebra-striping by default.
- At large text or narrow widths, convert tables to labeled lists rather than horizontal scrolling when the existing screen contract requires it.
- Filters are square chips with `aria-pressed` semantics on the web and the equivalent selected state in the app. Include a visible result count.
- Sticky filter bars must not hide focused content and must remain operable with keyboard, switch, voice, and screen reader input.

## The Wall

The Wall is intended as the Group's chronological gallery and comparison surface: current Group members can move through accountability weeks and understand how the Group's participation and progress changed over time.

The supplied Wall reference establishes this presentation direction:

- a large `THE WALL / REMEMBERS.` thesis;
- newest week first, grouped by week with date range and an outcome summary;
- a dense responsive square grid;
- filters for meaningful authoritative states;
- progressively revealed older weeks with an explicit beginning-of-history state;
- no public discovery, sharing, downloading, or cross-Group access.

The Wall's data and privacy contract is bounded even though its chronology may span more time. Therefore:

- A Verified Proof pair and its descriptions remain available for exactly 90 days from verification while every access and consent condition remains satisfied; the Wall is never a permanent photo archive.
- Every current Group member, including a later joiner or rejoiner, may see authorized retained pairs. Other pre-membership activity remains hidden.
- Consent withdrawal, the author's removal of the pair, departure or removal, Account deletion, service termination, Group closure, moderation removal, Unsupported, or Rejected revokes access and starts the approved early-deletion lifecycle.
- A Content report immediately suppresses the pair during moderation. Clearance may restore it only for the remainder of its original retention period and never restarts the clock.
- If deleted media is represented, use only the finalized structured outcome already allowed to remain; never retain or regenerate a thumbnail, blur, palette, embedding, caption, or other recoverable derivative to simulate the deleted photo.
- Counts, gaps, filters, dates, and loading boundaries are computed after authorization and must not reveal hidden activity.

[Issue #89](https://github.com/aeltoum/no-excuses/issues/89) records the resolved retention, consent, membership, moderation, deletion, and accessible-comparison decision. `CONTEXT.md` and the screen-state contract remain authoritative if this presentation guidance drifts from that decision.

## Motion

Spend motion on one choreographed moment per surface:

- Website: headline rise, then copy/action reveal; the ticker may move continuously only when reduced motion is not requested.
- App home: an authoritative state change may stamp into place after acknowledgement; background feed updates never steal focus or animate spatially across the screen.
- Wall: a short stagger may introduce the first visible batch, capped to avoid long cascades. Loading older weeks should not replay the entire grid.

With reduced motion, show the final state immediately or use a subdued opacity change. Motion never communicates a unique status.

## Imagery and content

- Prefer real, member-controlled exercise context over generic stock fitness imagery.
- Preserve the Activity photo's informational content and the Member-presence photo's user-controlled framing.
- Do not visually rank bodies, attractiveness, athletic ability, or intensity.
- Avoid public-social conventions such as follower counts, share totals, trending badges, and infinite engagement prompts.
- Website examples must be clearly illustrative and must use behavior consistent with current product decisions before publication.

The reference files' sample claims are not approved copy. In particular, future work must not inherit `two friends confirm every workout`, `week closes Sunday`, `watch screen or class check-in as Proof`, or `every confirmed photo stays forever` without an approved product change.

## Accessibility floor

This visual system inherits the full screen-state and accessibility contract. At minimum:

- Meet WCAG 2.2 AA contrast for text, controls, focus, and meaningful graphics.
- Keep a visible focus treatment on every interactive element.
- Preserve 48-by-48-pixel minimum app targets and an equivalent comfortable website target.
- Expose headings, lists, tables, filters, counts, image roles, descriptions, and statuses semantically.
- Never encode state using color, image treatment, position, sound, motion, or haptics alone.
- Reflow at large text without losing actions, descriptions, week boundaries, or status labels.
- Announce filter-result changes and appended Wall weeks without moving focus.
- Decorative tickers are hidden from assistive technology; meaningful content is available elsewhere as static text.

## Production checklist

Before a frontend change is accepted, verify that it:

- uses the Safety-yellow token and charcoal system rather than introducing a competing accent;
- preserves the approved navigation and semantic order for the surface;
- uses canonical domain terms and authoritative statuses;
- keeps two-photo Proof roles and descriptions intact;
- does not promise or expose historical media beyond the approved retention and membership boundary;
- includes loading, empty, stale, offline, denied, failure, conflict, pending, and acknowledged states where applicable;
- reflows at roughly 200-percent text, supports reduced motion, and has visible keyboard/switch focus;
- has no horizontal overflow at the supported compact width;
- has been reviewed at compact and wide sizes with real-length content, not only ideal sample copy.

## Reference status

The supplied HTML files are visual source material and are not copied into the repository. They contain prototype-only controls, generated sample data, external font loading, and behavior that conflicts with settled product rules. This document is the durable bridge from their approved appearance to future implementation.
