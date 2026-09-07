# Evidence ledger

`requirements.csv` is the stable index for all 40 contracts in the implementation
requirements and acceptance matrix. One row does not claim that a contract is implemented;
it records status and points to current evidence or the milestone that must produce it.

Allowed statuses are `planned`, `in-progress`, `pass`, `fail`, `blocked`, and
`not-applicable`. A `pass` must link inspectable evidence bound to a release and environment.
Update affected rows in every pull request and record invalidation when code, schema,
contracts, dependencies, environment, or governing documents change.

The reusable Gate 1 record is `.github/pull_request_template.md`.
