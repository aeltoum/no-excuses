# Private-pilot technical quality bar

This document sets the implementation-neutral technical readiness gates for the worldwide, English-language No Excuses private mobile pilot on iOS and Android. It does not select a client, backend, data store, vendor, deployment model, or monitoring product, and it is not legal advice.

These gates supplement the [implementation requirements and acceptance matrix](requirements-and-acceptance-matrix.md). Distribution through private testing tracks remains subject to the applicable store rules: Apple's first external TestFlight build undergoes TestFlight App Review, and Google Play testing tracks remain subject to Play policies ([Apple TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview), [Google permissions policy and testing tracks](https://support.google.com/googleplay/android-developer/answer/9214102?hl=en)).

## Readiness authority and evidence

- The developer alone signs technical readiness. The Private-pilot operator supplies recorded rehearsal evidence and operates the approved support workflows but has no readiness veto and gains no authority over peer accountability decisions.
- There is no readiness waiver for an open Critical or High security, privacy, authorization, or data-integrity finding, or for a defect that prevents completion of a core flow in a required accessibility mode.
- A non-core Medium defect may remain open only with a documented owner, workable member or operator workaround, explicit expiry date, and scheduled retest date. Expiry without a passing retest blocks readiness.
- All 40 contracts in the implementation requirements and acceptance matrix must have inspectable evidence from their named acceptance methods. The readiness rehearsal, isolated restore, alert delivery, rare operator workflows, and physical-device acceptance passes must all succeed before the live pilot.
- Physical-device acceptance covers the current major iOS release and the current major Android release only, using one representative physical device per platform. The selected devices and network profile must be recorded with the evidence; expanding OS support requires a new acceptance decision.

## Quality gates

### Security

Before rehearsal data is admitted:

- No cleartext transport or broad App Transport Security exception is allowed. Stored and transmitted personal or sensitive data must use risk-appropriate protection ([Apple App Review Guidelines 1.6 and 5.1](https://developer.apple.com/app-store/review/guidelines/), [Google Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en-GB), [Apple ATS](https://developer.apple.com/documentation/security/preventing-insecure-network-connections), [Android cleartext communications](https://developer.android.com/privacy-and-security/risks/cleartext-communications)).
- A documented threat model covers Group isolation, membership and operator authority, media, deletion, activity sync, diagnostics, backups, and recovery.
- Applicable OWASP MASVS mobile controls and ASVS server/API controls are mapped to evidence; exhaustive cross-Group and cross-role denial tests pass. MASVS explicitly requires risk-based scoping and does not cover remote endpoints on its own ([MASVS control groups and testing profiles](https://mas.owasp.org/MASVS/), [MASVS assessment scope](https://mas.owasp.org/MASVS/04-Assessment_and_Certification/), [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)).
- No open Critical or High security, privacy, or authorization finding is waivable under the readiness rule above.

### Privacy and deletion

- Access ends immediately when membership or account access ends.
- Account and associated user data are removed from active systems and processor copies within seven calendar days. Store-facing privacy and deletion behavior must also satisfy Apple's account-deletion and privacy-policy rules and Google's in-app, web, and Data safety requirements ([Apple App Review Guidelines 5.1.1](https://developer.apple.com/app-store/review/guidelines/), [Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [Google account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN), [Google Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en-GB_ALL)).
- Logically deleted data expires from backups within 30 calendar days. A restore must reapply deletion records before any restored environment becomes accessible, and deleted Proof must never reappear.
- Restricted audit records may remain for 90 days, but direct identity must be removed or replaced with a stable pseudonym within seven calendar days. The mapping, if one is strictly required, remains separately restricted and follows the applicable deletion clock.
- Clock-controlled tests prove immediate access revocation, active and processor deletion, backup expiry, audit pseudonymization, retry and alert behavior, and non-reappearance after restore. Applicable privacy law can impose additional duties; GDPR Articles 12, 17, 32, and 33 are external floors rather than substitutes for these project gates ([GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)).

### Accessibility

- ACCESS-01 through ACCESS-04 remain mandatory: every core flow succeeds with the platform screen reader, roughly 200-percent text, reduced motion, and supported alternative input; meaningful state is not color-only; and controls meet the project's 48-by-48 minimum target size.
- Manual completion on the representative iOS and Android physical devices is required; automation is supplemental. A failure to complete a core flow in any required mode is non-waivable.
- Non-core Medium accessibility defects follow the owner, workaround, expiry, and retest rule. The product may use WCAG 2.2 and WCAG2ICT as behavioral guidance but must not claim native-app WCAG certification ([WCAG 2.2](https://www.w3.org/TR/WCAG22/), [WCAG2ICT](https://www.w3.org/TR/wcag2ict-22/), [Android accessibility](https://developer.android.com/design/ui/mobile/guides/foundations/accessibility), [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).

### Data integrity

- Golden fixtures and reconciliation must show zero unexplained authoritative-state mismatches. Duplicate, delayed, reordered, offline, retried, and concurrent inputs produce exactly one authorized visible outcome; finalization never occurs early or twice.
- Proof is acknowledged only after durable storage. If durable acceptance cannot be confirmed, submission fails visibly and remains safely retryable.
- Any unresolved defect affecting authoritative accountability, access, deletion, or Validation-pilot measures blocks readiness. The existing requirement for at least 95 percent usable product-event data for evaluable member-weeks remains separate evidence, not permission for an authoritative mismatch.
- An authoritative-data repair uses a tested, versioned script authored by the developer, witnessed by the operator, and proven with before-and-after reconciliation. Its immutable audit evidence records scope, reason, author, witness, time, script version, counts, and invariant results without granting the operator authority to alter accountability outcomes.
- Integrity, restoration, and regular control testing must be risk-appropriate; applicable GDPR Article 32 obligations are an external floor ([GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)).

### Reliability

- No percentage availability SLO or error-budget process applies to this pilot. Readiness instead requires a successful end-to-end rehearsal and no known reproducible crash, unresponsive state, or dead end in a core journey.
- Automated core-journey health checks run every five minutes. Every repeated core crash, unresponsive state, or failed journey is investigated even when the service has otherwise recovered.
- A confirmed core outage that lasts more than 30 minutes or threatens an accountability deadline triggers a Service pause scoped to the affected deadlines. The pause preserves remaining time, creates no accountability consequence, and does not stop unrelated deadlines.
- Apple requires review submissions to be complete and free from obvious technical problems; Android's published crash and ANR thresholds are platform bad-behavior boundaries, not acceptable pilot targets ([Apple App Review Guidelines 2.1](https://developer.apple.com/app-store/review/guidelines/), [Android crash rate](https://developer.android.com/topic/performance/vitals/crash), [Android ANR rate](https://developer.android.com/topic/performance/vitals/anr)).

### Recovery

- The structured-data recovery point objective is at most 15 minutes.
- Core service is restored within four hours; non-core service is restored within one business day.
- Acknowledged Proof has no accepted-then-lost window because durable storage precedes acknowledgement.
- Before the live pilot, an isolated restore rehearsal records measured recovery point and recovery time and verifies record counts, invariants, authorization boundaries, retention clocks, deletion state, audit continuity, and non-reappearance of deleted Proof. Vendor claims alone are not evidence.
- Applicable GDPR Article 32 and NIST CP-9 guidance require risk-appropriate restoration and tested backup reliability but do not choose these numeric project thresholds ([GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng), [NIST SP 800-53 Rev. 5.1, CP-9](https://csrc.nist.gov/CSRC/media/Projects/risk-management/800-53%20Downloads/800-53r5/SP_800-53_v5_1-derived-OSCAL.pdf)).

### Performance

On each representative physical device under the recorded constrained-network profile:

- p95 cold start is at most three seconds;
- p95 visible response or progress begins within one second;
- p95 ordinary core read or action acknowledgement is at most two seconds; and
- p95 non-media action completion is at most five seconds.

Media transfer is measured separately, resumes safely after interruption, and never silently discards state. Android's launch and rendering guidance and Apple's responsiveness guidance provide external problem boundaries, not replacements for these end-to-end thresholds ([Android startup](https://developer.android.com/topic/performance/vitals/launch-time), [Android rendering](https://developer.android.com/topic/performance/vitals/render), [Apple responsiveness](https://developer.apple.com/documentation/xcode/improving-app-responsiveness)).

### Support response

- The monitored private support channel has a named primary operator and developer backup, tested paging, and a recorded handoff path that covers the worldwide pilot commitment.
- Every critical support issue is acknowledged within four hours, contained within eight hours, and receives a status update at least every four hours until containment.
- An ordinary issue is acknowledged within one business day and receives an investigation plan within two business days.
- Rehearsal must exercise every rare operator workflow, including handoff and failed-action recovery, and meet every response clock. Apple and Google require reachable support and timely or effective handling of user-generated-content concerns but do not set these numeric targets ([Apple App Review Guidelines 1.2 and 1.5](https://developer.apple.com/app-store/review/guidelines/), [Google Play UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en)).

### Observability

- Core synthetic checks run every five minutes. Outage, deletion failure, access anomaly, and integrity or reconciliation failure alerts are delivered to the responsible human within 15 minutes of detection.
- Authentication, membership and access revocation, finalization, media lifecycle, deletion, operator action, backup, restore, and authoritative repair transitions carry correlated, restricted audit evidence.
- Diagnostic telemetry is retained for 14 days. Restricted security and operator audit evidence is retained for 90 days and pseudonymized within seven calendar days as required by the privacy gate.
- Telemetry contains no tokens, passwords, keys, session identifiers, Proof, descriptions or transcripts, health data, location, or unnecessary identity. Collection, disclosure, and access remain purpose-limited because diagnostics can themselves be regulated or store-declared data ([Google Data safety data types](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en-GB_ALL), [Apple privacy manifests](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests), [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)).

## Distribution prerequisite outside this quality bar

Apple and Google policies require reporting and moderation controls for user-generated content and, in some interaction models, user blocking. The current product baseline does not yet prove that it satisfies those rules, and this technical quality bar cannot waive or silently expand the product decision ([Apple App Review Guidelines 1.2](https://developer.apple.com/app-store/review/guidelines/), [Google Play UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en)).
