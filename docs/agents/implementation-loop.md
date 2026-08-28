# Serial CDP implementation loop

Use this loop for user-visible implementation that can be exercised in a browser. CDP is the browser-automation transport contract; the repository's selected stack determines the concrete adapter after that stack is approved.

## Single lane

The orchestrator owns the loop and activates exactly one role at a time:

```text
ORCHESTRATOR -> WORKER -> ORCHESTRATOR -> VALIDATOR -> ORCHESTRATOR
                     ^                                  |
                     +-------------- FAIL --------------+
                                                        |
                                                    PASS -> DONE
```

Each role finishes and hands off before the next role starts. Use one worker and one validator. A failed validation returns to the same worker with the validator's complete failure packet. Keep implementation, validation, and repair turns serial throughout the task.

## CDP contract

Use the repository's existing CDP-capable browser automation adapter. If none exists, or the application cannot be started with a documented repository command, stop at the stack-decision gate in `AGENTS.md`; do not select or install Playwright, Puppeteer, a browser binary, a package manager, or a server as an incidental part of the task.

Every browser pass must:

- use the exact application URL and a recorded viewport;
- drive the interface through user-observable controls, preferring roles, labels, and visible text over implementation-coupled selectors;
- wait for observable page state instead of fixed sleeps;
- inspect uncaught page errors, console errors, and failed relevant network requests;
- capture a screenshot or equivalent inspectable artifact for each verdict;
- preserve authentication boundaries and avoid reading browser storage or secrets.

Start each validator pass from a fresh tab or a documented reset state. Close tabs and processes created by the loop when the orchestrator reaches `DONE` or `BLOCKED`.

## 1. Orchestrator: frame

Read the governing issue or specification and the repository instructions. Define a checkable acceptance list, the browser entry URL, relevant viewports, and the repository checks that must stay green. For a bug, require a pre-change browser reproduction when the environment permits it.

Record the iteration number and dispatch the worker only when the acceptance list has no unresolved product or stack decision. Framing is complete when the worker packet can name every required observable outcome.

## 2. Worker: implement

The worker is the only role allowed to edit source files.

1. Inspect the current implementation and reproduce the target behavior through CDP when required.
2. Make the smallest coherent change that satisfies the acceptance list.
3. Run relevant non-browser checks and a focused CDP smoke pass.
4. Inspect the resulting diff and return this packet to the orchestrator:

```text
WORKER PACKET
Iteration:
Objective:
Changed files:
Repository checks and results:
Application start command and URL:
CDP smoke scenario and result:
Known risks or unverified conditions:
```

The worker hands off only when the tree is ready for independent validation. The worker does not declare the task complete.

## 3. Validator: verify

The validator is read-only: it does not edit files, rewrite the acceptance list, or repair defects. Validate the current working tree independently through CDP.

Exercise every acceptance item, the changed path's primary adjacent behavior, and any relevant error, empty, loading, keyboard, focus, or responsive state. Run the required repository checks, then return exactly one verdict:

```text
VALIDATION PACKET
Iteration:
Verdict: PASS | FAIL | BLOCKED
Environment: URL, viewport, and reset state
Acceptance results:
Console and network findings:
Evidence artifacts:
Defects: reproduction steps, expected result, actual result, and severity
Blocked condition:
```

`PASS` requires evidence for every acceptance item, green required checks, and no unexplained relevant console or network failure. `FAIL` requires at least one reproducible defect. `BLOCKED` is reserved for an external dependency, unavailable environment, or unresolved decision that prevents a verdict.

## 4. Orchestrator: decide

- On `PASS`, inspect the final diff and evidence, clean up the browser session, and report `DONE`.
- On `FAIL`, copy the complete validation packet back to the same worker. The next iteration repairs only the reported defects and any directly caused regression, then returns through the validator again.
- On `BLOCKED`, exhaust safe in-scope diagnostics, clean up the browser session, and report the exact missing input or external condition.

The orchestrator never weakens acceptance criteria to obtain a pass. If the same defect survives two targeted repairs, pause the edit cycle for root-cause diagnosis before dispatching the worker again.

## Completion record

The final handoff names the accepted iteration, changed files, checks run, CDP scenarios and viewports, evidence artifact paths, and any explicitly deferred risk. The task is complete only after a validator `PASS`; a worker smoke pass alone is insufficient.
