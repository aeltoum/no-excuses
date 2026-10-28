# `--proof-bleed` tokens after single-peer review is removed

Issue: #275. Source: `origin/main` at time of writing. Assumed end state: posts become Verified on submit; no single-peer Verify, no `pending` review state; Question stays 24h with Accept / Reject / Can't assess voting on questioned posts.

## Every use of the tokens

`--proof-bleed` and `--proof-radius` appear only in `apps/web/src/styles.css` plus one design doc. No TSX references them.

| Location | What |
|---|---|
| `apps/web/src/styles.css:4612-4614` | Comment: photo and review base share one width; change `--proof-bleed` to keep review buttons matching |
| `apps/web/src/styles.css:4615-4618` | `:root { --proof-bleed: 12px; --proof-radius: 12px; }` |
| `apps/web/src/styles.css:4619-4623` | `@media (min-width: 600px)` sets `--proof-bleed: 0px` |
| `apps/web/src/styles.css:4624-4627` | `.proof-frame, .proof-decide { margin-inline: calc(-1 * var(--proof-bleed)); }` |
| `apps/web/src/styles.css:4633` | `.proof-frame` `border-radius: var(--proof-radius)` |
| `apps/web/src/styles.css:4636-4639` | `.proof-frame:has(+ .proof-decide)` squares bottom corners |
| `apps/web/src/styles.css:4652` | `.proof-decide` bottom corners `var(--proof-radius)` |
| `docs/design/no-excuses-visual-system.md:162-169` | "Proof post" rule: photo + review base one object, both from `--proof-bleed` / `--proof-radius`; Verify/Accept chalk, Question/Reject red |

## UI those tokens style

- `.proof-frame`: photo frame. `apps/web/src/Wall.tsx:636` (every Wall post), `apps/web/src/Weekly.tsx:1711` (uploading/failed optimistic post).
- `.proof-decide` fieldset: `apps/web/src/Wall.tsx:677-724`, rendered when `needsReview(item) || needsVote(item)` (`Wall.tsx:440-443`). Children: `.lamp-good` (`Wall.tsx:685`, Verify/Accept), `.lamp-no` (`Wall.tsx:698`, Question/Reject), hidden `.lamp` spans (`Wall.tsx:693,711`), `.proof-decide-hint` (`Wall.tsx:714-723`). Styles `styles.css:4641-4697`.

## What goes dead vs. stays

Stays (voting UI keeps the base under the photo):
- `--proof-bleed`, `--proof-radius`, their media query, `.proof-frame` / `.proof-decide` margin and radius rules (`styles.css:4615-4652`). `.proof-frame` is still used on every post; `.proof-decide` still renders for `needsVote`.
- `.lamp-good`, `.lamp-no`, `.proof-decide button`, `.proof-decide-hint` styles (Accept/Reject still use them).
- `.proof-questioned` (`styles.css:1586`): Questioned status, and Weekly failed upload (`Weekly.tsx:1704`).

Dead once single-peer review and `pending` go:
- `Wall.tsx:440-441` `needsReview` and every `needsReview(item) ? ... : ...` branch: `Wall.tsx:677,681,688-689,694,701-708,712,716-720` collapse to the vote arm; fieldset aria-label becomes "Your vote".
- Verify-specific hint copy `Wall.tsx:717,720` ("Verify unlocks...", "Questioning opens a 48-hour Group vote." - also wrong at 24h).
- Pending status labels `Wall.tsx:625-629` (`Review · remaining(reviewClosesAt)`, "Awaiting review"); `item.canReview`, `item.reviewClosesAt` reads, and `remaining()` if it has no other caller.
- `act()` review path: `action === "review"` in `instant` (`Wall.tsx:238`), the review optimistic branch (`Wall.tsx:252-255`), and the verify stamp trigger (`Wall.tsx:265-268`).
- Verify stamp: `stamped` state (`Wall.tsx:142`), `.proof-stamp` render (`Wall.tsx:668-672`) and style (`styles.css:1618-1629`), unless kept as a submit animation.
- `toReview` (`Wall.tsx:444`) narrows to vote-only; still live.
- `.proof-pending` (`styles.css:1582-1585`): dead on Wall, but still used by Weekly "Uploading..." chip (`Weekly.tsx:1704`) - keep or rename.
- Hidden `.lamp` spans + `.proof-decide .lamp { display:none }` (`Wall.tsx:693,711`, `styles.css:4688-4691`) are already dead markup kept for tests; removable independently.
- Docs to update: comment `styles.css:4612-4614` and `:4640-4641` ("Verify is the chalk primary"), `docs/design/no-excuses-visual-system.md:166-169` and Vocabulary line on "Verify workout / Question workout on first review".

## Conclusion

The `--proof-bleed` tokens themselves do not become dead: `.proof-frame` (every post) and `.proof-decide` (vote base on questioned posts) still consume them. Only the Verify/review branches, pending labels, and verify stamp become dead code. Note: "Question workout" as a first-review action also disappears with single-peer review; how a post enters Questioned (e.g. a separate Question control on Verified posts) is a product decision this note does not settle.
