# Gate 1 evidence — True MVP Weekly target command

- Scope: True MVP active `set Weekly target` loop step; issue #117.
- Authority: `app_private.set_weekly_target_command` updates only caller's current Membership recurring target.
- Lock invariant: existing Member-week target remains unchanged; update applies when later week creation reads recurring target.
- Access: service-role command only; public, anonymous, and authenticated direct execution revoked.
- Automated evidence: `tests/true-mvp-weekly-target.test.ts`, contract tests, delivery tests, migration replay, full `pnpm check`.
