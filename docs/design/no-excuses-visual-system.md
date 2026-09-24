# No Excuses visual system

This document is the presentation contract for the No Excuses True MVP PWA. The
[signed-off PWA spec](./no-excuses-spec.html) is the visual reference. Its locked barbell
direction is the current visual authority.
Prototype copy and sample data in that reference are illustrative, not product requirements.

The authority order remains:

1. `CONTEXT.md`, accepted ADRs, and resolved product issues define behavior, privacy, safety,
   and terminology.
2. `docs/implementation/screen-state-accessibility-contracts.md` defines navigation, states,
   semantic order, and accessible interaction.
3. This document defines presentation. If the visual reference conflicts with either higher
   authority, keep this visual language while following the authoritative behavior.

## Design thesis

No Excuses should feel like a private crew training record: direct, sturdy, and earned, not a
wellness dashboard or public social network. Every screen sits on a dark rubber gym floor.
The signature is the **barbell**: each workout loads one plate on both sides of the bar; the
same form appears on Home, in logging previews, for targets, in friend progress, and in chalk
for count-only history.

## Colour

| Token | Value | Meaning |
| --- | --- | --- |
| `rubber` | `#1A1B1D` | App background, with restrained rubber speckle |
| `chalk` | `#F2F2EE` | Primary text, primary controls, active states, and count-only plates |
| `muted` | `#8C8F93` | Secondary text; use only where rendered contrast remains AA |
| `rule` | `#2C2E31` | Row dividers, quiet boundaries, and neutral details |
| `surface` | `#232427` | Inputs, grouped controls, and sheets |
| `error` | `#E5484D` | Error boundaries and error emphasis |
| `bar` | `#9B9EA3` | Bar shaft |
| `barGrip` | `#B4B7BB` | Central grip |
| `barCollar` | `#C9CCCF` | Plate collars |
| `emptySlot` | `#55585C` | Dashed, unfilled target slots |

Chalk is the primary high-contrast accent. Error and other semantic states retain explicit
text and shape or icon cues; colour alone never communicates state.

### Activity plates

| Activity | Value | Plate meaning |
| --- | --- | --- |
| Strength | `#D63A2F` | Self-reported strength workout |
| Cardio | `#2F6FD6` | Self-reported cardio workout |
| Class | `#E8C22E` | Self-reported class workout |
| Sport | `#2E9E55` | Self-reported sport workout |
| Mixed | `#E9E9E4` | Self-reported mixed workout |

Plate colour describes activity type, not verification, quality, intensity, or outcome.
Always expose the activity name in text or an accessible label. Where activity-type data is
absent, render a chalk plate without changing layout; never infer a type from other data.

## Typography

Both families are self-hosted WOFF2 assets:

- **Archivo** 400, 500, 600, and 700 is the body, control, label, and utility face. Body copy
  is `16px/1.5`; supporting copy is `15px`; field labels and row counts are `14px`; captions
  and compact labels are `12–13px`. Use tabular numerals for aligned counts.
- **Big Shoulders Display** 700, 800, and 900 is the display and numeric face. Screen titles
  are 800 at `46px/0.95`; section and sheet titles use 800 at `26–34px/1`; compact count marks
  use 800 at `20–30px`; the primary target number uses 900 at `110px/0.85`. Responsive
  implementations may scale these steps down to preserve reflow, but must keep their hierarchy.

Use the display face for short headings and prominent counts, not paragraphs, instructions,
fields, or long accessible text. Use system sans-serif fallbacks. Do not request fonts from
Google Fonts or another third party: member visits and screen use must not leak through font
requests. `font-display: swap` keeps text available during font loading.

## Shape, rules, and spacing

The system is compact, sturdy, and lightly rounded:

- Controls and inputs use a `6px` radius.
- Grouped cards and activity selectors use an `8px` radius.
- Sheet top corners use `16px`; the sheet bottom meets the viewport edge.
- Small indicators and the sheet grab handle may use `2px`; plates use a slight `3–5px`
  rounding appropriate to their size. Avatars and history rack plates remain circular.
- Rows and lists use a single bottom rule instead of enclosing boxes. Avoid ornamental card
  borders, glossy gradients, glass effects, and broad soft shadows.

Use a four-pixel base with the practical sequence `4, 8, 12, 16, 20, 24, 32, 40, 64`.
Member-app edge gutters are `20px`; dense internal gaps are `6–12px`; major sections are
`24–40px` apart. Preserve one-column reflow and no horizontal overflow at large text and
compact widths.

## Barbell

The SVG Barbell has big and mini presentations but one grammar:

- A workout adds one matching plate to each side. Plates load symmetrically from each collar
  outward. The mirrored pair represents one workout, not two.
- Render `max(count, target, 1)` slots per side so over-target workouts remain visible and a
  zero target still has a stable bar. Shrink plate width and gaps as slot count grows rather
  than wrapping, clipping, or making the page scroll horizontally.
- Filled target slots precede unfilled slots. Unfilled target slots have a neutral dashed
  outline and no fill. Never show a dashed slot as completed.
- Use activity colours only when authoritative activity types are present. Missing activity
  types fall back to chalk plates with no layout change. Count-only and finalized-history bars
  are chalk.
- The visible count and accessible name state progress as `2 of 4 workouts`; colour and plate
  geometry are supplementary. When the Home bar links to Target, extend the accessible name
  with the action, for example `2 of 4 workouts. Change weekly target`.
- Keep shaft, grip, collars, filled plates, and empty slots visually distinct at both sizes.
  The bar remains one row for long names, ten-member lists, targets above four, and over-target
  counts.

## Sheet

The Sheet is the shared bottom-sheet dialog for workout logging, history detail, install help,
and account deletion:

- Align it to the viewport bottom, cap its width on wide screens, use a surface background,
  `16px` top corners, a quiet scrim, and an internal scroll region that respects safe areas.
- Give it a visible grab handle, title, and—when dismissible—a labelled close control.
- Use dialog semantics, an accessible title, initial focus inside the sheet, a focus trap, and
  return focus to the opener after close.
- A dismissible sheet closes through its close control, Escape, or scrim. A non-dismissible
  destructive step disables Escape and scrim dismissal; its explicit safe exit is the only
  way out. The visual grab handle does not promise swipe behavior.
- Keep forms and lists unboxed inside the sheet. Use grouped controls and row rules, preserve
  entered choices on retryable failure, and keep status/error messages perceivable.

## Five-tab bar

Authenticated member navigation has exactly five destinations in this order:

`Home | Group | Target | History | Account`

Each tab uses its approved inline icon and sentence-case label. The bar is fixed to the screen
flow at the bottom, respects the bottom safe area, and retains usable labels at compact widths.
The current tab uses chalk icon/text plus a single `3px` chalk indicator. Other tabs use muted
icon/text. Expose the current destination semantically (`aria-current="page"` on web); never
use colour or the moving indicator as its only cue. Every tab meets the `48×48px` target floor.

## Motion

Tab navigation owns the system's one choreographed navigation moment: the `3px` active-tab
indicator glides to the selected tab with `transform 280ms cubic-bezier(.3,.7,.2,1)`, while
the incoming page fades in and rises from `12px` over `220ms`. Do not add competing route
wipes, cascades, or spatial background updates.

After a workout is successfully logged, closing the sheet and showing the new plate are direct
state feedback, not a second navigation choreography. Motion never carries unique meaning or
moves focus. Under `prefers-reduced-motion: reduce`, remove movement and transition duration:
the indicator, page, sheet, and new plate swap to their final states immediately; skeleton
animation also stops.

## Media and privacy

Presentation never broadens media access or retention:

- A submitted Workout report has exactly two photos: the Activity photo is primary and the
  Member-presence photo is secondary. Preserve each role, factual description, meaningful
  crop, and complete detail-view facts.
- A Verified Proof pair remains available for exactly 90 days from verification only while
  every authorization, membership, consent, and moderation condition remains satisfied.
- Consent withdrawal, author removal, departure or removal, Account deletion, service
  termination, Group closure, moderation removal, Unsupported, or Rejected revokes access and
  starts the approved early-deletion lifecycle. A Content report suppresses the pair while
  moderation is pending; clearance never restarts the retention clock.
- After media deletion, show only finalized structured outcomes already allowed to remain.
  Never retain or regenerate thumbnails, blurs, palettes, embeddings, captions, or another
  recoverable derivative. Counts, gaps, dates, filters, and loading boundaries must not reveal
  hidden activity.
- No public discovery, cross-Group access, download, or sharing treatment may be introduced by
  presentation. Do not visually rank bodies, attractiveness, ability, or workout intensity.

[Issue #89](https://github.com/aeltoum/no-excuses/issues/89) records the resolved media
retention, consent, membership, moderation, deletion, and comparison rules. Higher-authority
domain and screen-state documents control if this summary drifts.

## Accessibility floor

This system inherits the complete screen-state and accessibility contract. At minimum:

- Meet WCAG 2.2 AA contrast for text, controls, focus indicators, and meaningful graphics.
- Keep a visible three-pixel focus ring with three pixels of offset on every interactive
  element; focus must remain visible above sticky navigation and sheets.
- Preserve `48×48px` minimum app targets.
- Expose headings, lists, controls, counts, image roles and descriptions, and statuses
  semantically. Announce meaningful async result changes without moving focus.
- Never encode state using colour, plate shape, image treatment, position, sound, motion, or
  haptics alone.
- Reflow at roughly 200-percent text without clipping actions, descriptions, week boundaries,
  tab labels, or status labels, and without horizontal page scrolling.
- Keep loading, empty, failure, retry, disabled, focus, and reduced-motion states legible and
  operable with keyboard, switch, voice, and screen-reader input.

## Acceptance checklist

Before accepting frontend presentation work, verify that it:

- uses the rubber/chalk tokens and exact activity plate meanings above;
- uses self-hosted Archivo and Big Shoulders Display at the approved hierarchy;
- follows the radius, row-rule, Barbell, Sheet, and five-tab rules;
- preserves authoritative navigation, semantic order, domain language, and status meanings;
- keeps activity colour supplemental and uses chalk for absent type data;
- preserves two-photo roles and the media privacy boundary;
- covers applicable loading, empty, failure, retry, over-target, high-target, compact, large-
  text, keyboard-focus, and reduced-motion states;
- has no horizontal overflow and has been reviewed with real-length content at compact and
  wide sizes.
