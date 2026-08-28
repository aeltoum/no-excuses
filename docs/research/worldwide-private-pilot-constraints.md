# Worldwide private-pilot constraints

**Status:** Research finding for Wayfinder issue [#37](https://github.com/aeltoum/no-excuses/issues/37)<br>
**Researched:** 2026-08-28<br>
**Scope:** An English-language, invitation-only, 18+ Validation pilot on iOS and Android

This is technical planning guidance, not legal advice. “Worldwide” has no single legal meaning, and this review is not a country-by-country legal opinion. The implementation owner should obtain qualified advice before admitting testers in a jurisdiction whose requirements cannot be cleared by the controls below.

## Resolution

No Excuses can pursue worldwide participation, but it cannot promise service in every country. For the pilot, **worldwide** should mean: any invited adult may enroll unless (1) Apple, Google, or the selected managed services cannot serve their account or location, (2) export or sanctions rules prohibit service, or (3) a documented jurisdiction hold remains uncleared.

The pilot must therefore ship with:

- private beta distribution through email-based TestFlight and Google Play testing groups;
- a country-level eligibility record and an operator-managed jurisdiction-hold mechanism, without collecting precise location;
- an 18+ neutral age gate before account creation and a defined underage-removal path;
- privacy-by-design controls for fitness/activity data, private-group photos and videos, and membership history;
- consent and notice records by purpose and version, not one blanket checkbox;
- user access, correction, export, account deletion, media deletion, and consent-withdrawal workflows;
- a single documented primary data region for the pilot, plus contractually valid transfer mechanisms and a country/processor/subprocessor register;
- encryption in transit and at rest, least-privilege authorization, private object storage, audit trails, and a jurisdiction-aware incident runbook;
- in-app UGC reporting, blocking, moderation, and operator contact paths even though Groups are private; and
- WCAG 2.2 AA as the product acceptance baseline, supplemented by VoiceOver, TalkBack, text scaling, reduced-motion, contrast, caption/transcript, and switch/keyboard testing.

Two jurisdiction holds are justified before vendor selection and legal clearance:

1. **Russian Federation:** Russian personal-data law applies to foreign operators processing Russian citizens under a contract or consent and generally prohibits collecting Russian citizens’ personal data into databases outside Russia. It also regulates cross-border transfers. No Russian primary data plane has been selected, so Russian residents should not be enrolled until local collection, regulator notification, transfers, and operator obligations are cleared. [Russian Federal Law No. 152-FZ, Articles 1, 12, and 18(5)](https://government.ru/docs/all/98196/)
2. **China mainland:** Apple may require a valid ICP filing for availability in China mainland, and China’s PIPL requires a permitted cross-border mechanism for personal information sent abroad. The Android Google Play route and the eventual backend also need live in-country validation. China-mainland enrollment should remain on hold until distribution, filing, transfer, and selected-service reach are cleared. [Apple China-mainland availability fields](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information), [PIPL Article 38](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm)

These are conditional pilot holds, not permanent product exclusions. Any additional exclusion must identify the official platform, vendor, export, or legal source and the condition required to remove it.

## What the product handles

The domain model makes the privacy risk higher than a generic habit tracker:

- account, Group membership, invitations, roles, notification preferences, targets, votes, messages, and retained accountability history;
- structured strength, cardio, class, sport, step, and performance-baseline data;
- exactly two Proof photos per Workout report, including one Member-presence photo, with capture/session times and short descriptions;
- Proof videos with captions or transcripts for Consequence completions;
- optional step data from an authorized aggregate activity source; and
- operator access for deletion, Media reports, underage removal, and safety or accessibility support.

Exercise records and step data may reveal health status and should be treated as sensitive even where a particular law might classify a particular field differently. A photo is personal data when it identifies a person; it is not biometric data merely because a face or body is visible. It becomes biometric data under GDPR when technically processed for unique identification. The MVP already forbids face detection, body recognition, biometric comparison, and appearance scoring; preserve that boundary. [GDPR definitions and Articles 4 and 9](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=celex%3A32016R0679)

## Distribution and platform constraints

### iOS: TestFlight external testing

Use a private external TestFlight group and invite named testers by email. Do not use a public TestFlight link for the private pilot.

- TestFlight permits up to 10,000 external testers per app. The first external build is reviewed against the App Review Guidelines, later builds may also be reviewed, and each build expires after 90 days. A release calendar must prevent pilot interruption. [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview)
- Testers must be able to obtain TestFlight and accept an invitation. Managed Apple Accounts in reserved domains cannot test builds. Apple’s terms state that beta apps may not be available in all countries. [TestFlight terms](https://www.apple.com/legal/internet-services/itunes/testflight/)
- The public App Store is available in 175 countries or regions, not every sovereign territory, and account region controls the storefront. This is the correct outer bound to monitor even though the pilot uses TestFlight. [App Store availability](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/manage-availability-for-your-app-on-the-app-store)
- TestFlight review requires beta description, review contact information, and a functioning demo path. Review metadata and backend must be ready before external enrollment. [TestFlight test information](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information)

Because No Excuses requires sensitive fitness information and account-based private-group features, plan to submit from the operating legal entity rather than an individual Apple developer account. Apple Guideline 5.1.1(ix) says apps that require sensitive user information should be submitted by the legal entity providing the service. [App Review Guidelines 5.1.1](https://developer.apple.com/app-store/review/guidelines/)

### Android: Google Play testing

Prefer Google Play **internal testing** while the pilot has at most 100 Android testers. Move to a closed track only when the pilot exceeds that limit.

- Internal testing supports up to 100 testers, requires each tester to use a Google or Google Workspace account, and allows an internal tester from any location even when the production, open, or closed release is unavailable there. [Google Play testing tracks](https://support.google.com/googleplay/android-developer/answer/9845334)
- Closed testing supports larger email lists or Google Groups, but country availability applies. The app is not searchable; each tester needs the opt-in link. [Google Play testing tracks](https://support.google.com/googleplay/android-developer/answer/9845334), [country targeting](https://support.google.com/googleplay/android-developer/answer/7550024)
- An app active exclusively in internal testing is exempt from the public Data safety section. Closed, open, and production tracks require the Data safety form and a privacy-policy URL. Treat the declarations as implementation deliverables anyway so moving tracks is not blocked. [Google Play Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)

Internal testing’s “any location” language does not guarantee that every person can access Google Play, obtain a compatible device, pass export restrictions, or reach the backend. Enrollment must be rehearsed with one nominated tester in each intended country before inviting a Group.

### Store declarations and user-generated content

Both platforms impose requirements that are material before pilot readiness:

| Constraint | Required product/operations behavior |
| --- | --- |
| **Private UGC** | Proof media, descriptions, messages, and reactions are UGC even inside a Group. Apple requires filtering, reporting, blocking abusive users, timely response, and published contact information. Google requires accepted user terms, defined prohibited content, ongoing moderation, in-app reporting, and blocking where users interact. Build Media report, member block, operator review, removal, and audit paths before review. [Apple Guideline 1.2](https://developer.apple.com/app-store/review/guidelines/), [Google UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937) |
| **Account deletion** | Apple requires account deletion initiation in-app and deletion of associated UGC. Google requires both an in-app route and a functional web deletion-request route, including downstream service-provider deletion. Temporary deactivation is insufficient. [Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [Google account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) |
| **Privacy disclosure** | Publish an accessible privacy policy in-app and on the web. Inventory first- and third-party data behavior. Keep App Privacy and Google Data safety answers generated from the same data inventory so releases cannot drift from runtime behavior. [Apple app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/), [Google User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311) |
| **Age declarations** | Declare an adult-only target audience, complete both content-rating questionnaires accurately, and ensure Apple’s rating is overridden upward if the EULA minimum age exceeds the calculated rating. Store ratings do not replace the in-product gate. [Apple age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/), [Google target audience](https://support.google.com/googleplay/android-developer/answer/9867159) |
| **Permissions** | Request camera, microphone, notification, photo, and activity-source access only at the feature that needs it, with a clear purpose. Denial must not block unrelated features. Google requires prominent disclosure when sensitive access is not reasonably expected. [Apple Guideline 5.1](https://developer.apple.com/app-store/review/guidelines/), [Google prominent disclosure](https://support.google.com/googleplay/android-developer/answer/11150561) |
| **SDK privacy** | Each SDK is part of the app’s data behavior. iOS submissions must contain valid privacy manifests and approved reasons for covered APIs; Google declarations must include SDK collection and sharing. Maintain an SDK register and reject unneeded analytics, advertising, fingerprinting, or replay SDKs. [Apple privacy manifests](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files), [Apple required-reason APIs](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api) |

## Privacy and cross-border requirements

### A strict common baseline

The architecture should implement the following for every tester, regardless of country. This is simpler and safer than branching basic rights by geography and covers the recurring duties in GDPR, UK GDPR, Brazil’s LGPD, Canada’s PIPEDA, Australia’s APPs, and state laws such as California’s CCPA when they apply.

1. **Accountability:** identify the controller/legal entity, privacy contact, processors, subprocessors, data regions, purposes, legal basis, retention, recipients, and transfers in a living processing register.
2. **Purpose limitation and minimization:** collect only country/region for eligibility, not precise location; do not retain exact birth date after age assessment; strip EXIF and hidden device/location metadata from Proof media; do not collect contacts when a single-use invitation link is sufficient; and do not add ads or behavioral analytics to the pilot.
3. **Layered notice:** show concise just-in-time explanations before sensitive collection, with an accessible full privacy notice naming categories, purposes, recipients, regions, retention, rights, and complaint contact.
4. **Lawful-basis and consent ledger:** record notice version, terms version, purpose, legal basis, consent or withdrawal timestamp, and source. Keep necessary core processing separate from optional activity-source connection, notifications, research feedback, and future analytics. Consent withdrawal must be as easy as granting it.
5. **Rights:** provide self-service correction, portable machine-readable export, account deletion, media deletion where allowed by the settled domain rules, consent withdrawal, and an operator queue for access, objection, restriction, and complaints. Authenticate requesters and log fulfillment without retaining the request payload indefinitely.
6. **Retention:** encode the approved domain periods as deletion jobs: discard unselected camera candidates immediately; delete withdrawn, Unsupported, or Rejected Proof photos immediately; delete accepted Proof photos and Proof videos after seven days; remove access immediately on departure; and anonymize retained finalized history to “Former member” when required by an approved deletion request. Deletion must cascade through originals, derivatives, object versions, caches, search, analytics, and processors. Backups need a documented expiry and must not silently restore deleted data.
7. **Security:** deny public object access; use short-lived, membership-authorized media URLs; enforce server-side Group and from-joining-forward authorization on every read; encrypt in transit and at rest; separate production/pilot operator roles; require MFA for operator access; rotate secrets; log privileged reads and moderation/deletion actions; and prohibit sensitive data in logs, crash reports, notifications, email, or invitation URLs.
8. **Incidents:** maintain an incident classifier and contact matrix because notification triggers and clocks differ. Preserve evidence, revoke affected access, notify processors, and track affected jurisdictions and data categories. Do not wait for a complete forensic report before starting legal clock assessment.

The GDPR applies to a non-EU operator when it offers even free services to people in the Union or monitors their behavior. It requires a lawful basis, transparency, data-subject rights, data protection by design, appropriate security, breach handling, and protected international transfers. Fitness records may be special-category health data, requiring an Article 9 condition in addition to an Article 6 basis. [GDPR Articles 3, 6, 9, 12–22, 25, 32–35, and 44–49](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=celex%3A32016R0679)

A non-EU/UK operator may also need an EU and UK representative. The exceptions are fact-specific; do not assume that recurring processing of fitness data and member media is “occasional” and low-risk. Put representative assessment and contact fields in the launch checklist. [ICO guidance on EU and UK representatives](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/receiving-personal-information-from-the-eea/)

Brazil’s LGPD applies to processing performed in Brazil and to offerings directed to people located there. It provides notice and rights, treats health and biometric data as sensitive, requires security, and limits international transfer. Brazil has its own approved standard contractual clauses; EU clauses alone are not a substitute. [Official English LGPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/outros-documentos-e-publicacoes-institucionais/lgpd-en-lei-no-13-709-capa.pdf), [ANPD transfer regulation and clauses](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/regulation-on-international-transfer-of-personal-data.pdf)

Canada’s PIPEDA, where commercial activity makes it applicable, centers accountability, identified purposes, meaningful consent, collection/use/retention limits, safeguards, openness, and access. Australia’s APP regime similarly adds overseas-recipient accountability, security, deletion/de-identification when no longer needed, access, and correction for covered entities. The strict baseline above satisfies the needed architectural capabilities even though entity-level exemptions still require legal assessment. [PIPEDA principles](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/), [Australian Privacy Principles](https://www.oaic.gov.au/privacy/australian-privacy-principles/read-the-australian-privacy-principles)

California’s CCPA is unlikely to apply to a small private pilot unless the operating business crosses its revenue/data/sale thresholds, but its access, deletion, correction, sensitive-data, and sale/sharing controls are already covered by the baseline. Reassess applicability rather than hard-coding a pilot exemption. [California Attorney General CCPA overview and thresholds](https://oag.ca.gov/privacy/ccpa)

### Transfer and residency contract

One global region does not remove transfer obligations. A tester may upload in one country, the primary database may be in another, operators may access from a third, and subprocessors/backups may be elsewhere.

Before selecting a backend, object store, authentication, messaging, crash, support, or analytics service, require all of the following:

- a signed data-processing agreement that identifies controller/processor roles;
- a complete current subprocessor list, processing locations, and change notice;
- a selectable primary region for database, object storage, logs, backups, and support data;
- EU adequacy or 2021 SCC support plus transfer-impact/supplementary-measure information; UK adequacy or the IDTA/Addendum and transfer-risk support; and ANPD-approved Brazil transfer terms where applicable;
- encryption in transit and at rest, customer-access controls, MFA, role separation, audit logs, incident notice, vulnerability handling, and deletion/export APIs;
- documented deletion propagation and maximum backup-retention periods;
- confirmation that the service does not sell pilot data, use it for advertising, train models on it, or acquire rights beyond providing the service;
- confirmed service, billing, support, and API availability in every cleared pilot country, including sanctions/export restrictions; and
- an exit path that exports data and deletes the provider copy without breaking user-rights evidence.

EU transfers outside the EEA require adequacy or safeguards such as SCCs, and supplementary measures may be necessary after transfer assessment. UK restricted transfers similarly require adequacy, safeguards such as the IDTA/Addendum, or a valid exception. [European Commission transfer rules](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en), [EDPB supplementary-measures recommendations](https://www.edpb.europa.eu/documents/recommendation/recommendations-012020-on-measures-that-supplement-transfer-tools-to_en), [ICO international transfers](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/)

Start with one primary region to reduce copies and operational complexity. Keep region choice behind storage/service interfaces and attach residency metadata to tenant/Group records so a later country shard can be introduced without rewriting the domain. Do not enable global media CDN caching until its locations, purge behavior, and transfer terms pass the same review.

## Age gating and consent

The 18+ product boundary is the simplest defensible global child-safety rule, but a terms sentence alone is insufficient.

### Required flow

1. Before account creation or accepting a Group invitation, show a neutral age screen asking whether the person is at least 18.
2. If “no,” stop without creating an account or collecting media, activity, device, or analytics data. Retain at most a short-lived abuse-prevention event that cannot be used for marketing.
3. If “yes,” store only the attestation, timestamp, country/region, and policy version—not full date of birth or identity documents.
4. Provide a report path for an underage account. On confirmation, end access, remove media, delete personal activity, and replace identity in retained finalized history with “Former member,” matching the domain model.
5. Review whether self-declaration remains proportionate before each broader pilot. If stronger assurance becomes necessary, use a provider that returns only an over-18 token; do not retain passport images or biometric age estimates.

COPPA applies to child-directed services and general-audience services with actual knowledge of collection from a child under 13. The FTC permits a neutral age screen and says a general-audience operator may rely on entered age unless it later learns otherwise. [FTC COPPA guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)

The UK Children’s Code can apply when children are likely to access an app even if they are not the target audience. The operator must document why the adult-only design, invitations, marketing, content, and assurance make child access unlikely; otherwise the Code’s standards apply. [ICO Children’s Code introduction](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/introduction-to-the-childrens-code), [ICO age-assurance guidance](https://ico.org.uk/about-the-ico/what-we-do/information-commissioners-opinions/age-assurance-for-the-children-s-code)

India’s DPDP Act defines a child as under 18 and requires verifiable parental consent for child processing. The core substantive provisions, including territorial scope, notice, consent, duties, rights, children, transfers, and security, are scheduled to take effect 18 months after the 13 November 2025 notification—13 May 2027. The implementation may cross that date, so build the 18+ gate and baseline now and re-check the official commencement status before launch. [DPDP Act](https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf), [official commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf), [DPDP Rules 2025](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf)

### Sensitive and optional consent

- Use the core-service contract or other legally reviewed basis for account, Group, accountability, and proof processing; do not label every core operation “consent” if withdrawal cannot occur without ending the service.
- Where GDPR special-category treatment applies to fitness/activity data, record the separate Article 9 condition. If relying on explicit consent, make withdrawal available and define what happens to active competitions and derived results.
- Obtain separate, just-in-time device permission for camera, microphone, notifications, and activity-source data.
- Connecting HealthKit or Health Connect must be optional and purpose-limited to the minimum aggregate step data. HealthKit permission is per data type and may be revoked or limited; Google requires declared Health Connect data types and Play approval. [Apple HealthKit privacy](https://developer.apple.com/documentation/healthkit/protecting-user-privacy), [Health Connect data types and declarations](https://developer.android.com/health-and-fitness/health-connect/data-types)
- Store sharing choices and permission state independently. Device permission does not itself authorize every backend use or disclosure to Group members.
- Do not use health/fitness, proof media, or private-group behavior for advertising, data brokerage, model training, or unrelated analytics.

## Encryption, export, and security

Legal and platform rules generally demand risk-appropriate security, not a particular universal cipher. The plan should nevertheless require modern TLS for every connection, provider encryption at rest, OS-protected local secrets, no sensitive cleartext cache, and tested authorization boundaries. Google explicitly requires modern cryptography such as HTTPS for personal and sensitive data, and Android disables cleartext by default for modern targets. [Google User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311), [Android cleartext guidance](https://developer.android.com/privacy-and-security/risks/cleartext-communications)

Apple requires an export-compliance determination for apps that use encryption, including TestFlight builds. OS-provided HTTPS is typically exempt from documentation upload, while non-exempt or proprietary encryption may require declarations, US classification, and a French declaration. Record the decision and set `ITSAppUsesNonExemptEncryption` accurately; do not invent custom cryptography. [Apple export-compliance overview](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance), [Apple encryption-documentation table](https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption), [BIS mass-market encryption guidance](https://www.bis.gov/learn-support/encryption-controls/mass-market)

The United States FTC Health Breach Notification Rule may apply if No Excuses maintains identifiable health information and has the technical capacity to draw it from multiple sources—for example, user-entered workouts plus an activity source. The incident runbook must include an HBNR applicability decision and notification path before enabling source integration. [FTC Health Breach Notification Rule guidance](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0)

## Accessibility

There is no single worldwide statute that makes one technical standard universally mandatory for this pilot. Legal scope depends on the operator and service. For example, the US ADA applies to state/local government services and businesses open to the public, while the EU Accessibility Act covers listed products and services such as e-commerce and exempts service-providing microenterprises. A free private fitness pilot is not automatically in either scope; that is a legal conclusion to reassess if the operator, audience, or monetization changes. [US DOJ web-accessibility guidance](https://www.ada.gov/resources/web-guidance/), [EU Directive 2019/882](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX%3A32019L0882)

Accessibility is still an approved product constraint and a safety requirement. Adopt **WCAG 2.2 AA** as the acceptance baseline and translate it to native-mobile behavior. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

Required testing should include:

- full critical-flow completion with VoiceOver and TalkBack, including camera capture, media selection, voting, deletion, report/block, and Technical pause;
- semantic names, roles, states, values, reading and focus order, and announcements for timers, uploads, errors, provisional results, and changing vote state;
- 200% text scaling and platform largest accessibility sizes without clipped actions or hidden evidence;
- color contrast, no color-only status, reduced motion, visible focus, 44-by-44-point-equivalent targets, and non-drag alternatives;
- captions or transcripts for meaningful Proof-video audio and text alternatives/descriptions that do not reveal more about the member than they supplied;
- switch/keyboard access and orientation/responsive checks; and
- manual assistive-technology testing plus automated checks and at least one disabled-user review of the core loop. Apple and Android both publish platform-specific evaluation guidance. [Apple VoiceOver criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/voiceover-evaluation-criteria/), [Android accessibility testing](https://developer.android.com/guide/topics/ui/accessibility/testing)

An accessibility defect that prevents a deadline action must be able to create the already-defined Technical pause without changing unrelated deadlines or accountability outcomes.

## Architecture acceptance criteria

The later implementation plan should not call the MVP pilot-ready until all of the following can be demonstrated:

- [ ] The operating legal entity, privacy owner, support contact, controller role, and Apple/Google account ownership are named.
- [ ] TestFlight external and Google internal/closed distribution paths are rehearsed with real accounts; build expiry and update operations are documented.
- [ ] A country eligibility register records **cleared**, **hold**, or **platform/service unavailable**, the source, review date, owner, and removal condition.
- [ ] Russia and China-mainland remain held until their stated conditions are cleared; no other exclusion exists without a cited rationale.
- [ ] An invited under-18 person cannot create an account, and confirmed-underage removal produces the domain-defined deletion/anonymization result.
- [ ] The data inventory, purpose/legal-basis register, privacy notice, Apple App Privacy response, Google Data safety response, permissions, SDK manifest, and runtime traffic agree.
- [ ] Every personal-data store and processor supports authenticated access, correction, export, deletion, retention, and audit requirements.
- [ ] Account deletion is initiated in-app and on the web and cascades through auth, records, media, derivatives, processors, and expired backups while preserving only disclosed lawful exceptions and domain-approved anonymized history.
- [ ] Proof media is private, metadata-stripped, membership-authorized, inaccessible after membership loss, and deleted on the exact approved schedule.
- [ ] Cross-border mechanisms, DPAs, subprocessors, region placement, support access, backup locations, and transfer assessments are approved before real data enters a service.
- [ ] TLS, at-rest encryption, MFA, least privilege, secret management, audit logging, restore/deletion behavior, incident detection, and notification runbooks pass rehearsal.
- [ ] UGC terms, prohibited-content rules, in-app media/user reporting, blocking, moderation, operator contact, and response targets pass App Review/Play policy checks.
- [ ] The complete critical path passes WCAG 2.2 AA review plus manual VoiceOver, TalkBack, text scaling, reduced-motion, caption/transcript, and switch/keyboard tests.
- [ ] Official platform policies, country reach, export status, vendor terms, transfer mechanisms, and India’s DPDP commencement are re-checked immediately before pilot enrollment.

## Planning consequence

The technical plan may continue with a worldwide English-language destination, provided it treats geography as a live operational control rather than a marketing promise. A service or stack is acceptable only if it satisfies the vendor gate above for every cleared country. Country-specific infrastructure is not justified for the first pilot except where clearing a desired jurisdiction requires it; Russia and China mainland remain conditional holds until that cost and complexity is explicitly accepted.
