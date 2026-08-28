# Activity-data integration capabilities

Research for [Research activity-data integration capabilities](https://github.com/aeltoum/no-excuses/issues/38), current through 2026-08-28.

## Question

Which official iOS and Android APIs, permissions, provenance fields, aggregation rules, and platform limitations can provide the minimal member-authorized step and cardio inputs required by Top Steps and Cardio Leap, while supporting Load Progression without inventing unsupported device capabilities?

This note implements the platform boundary established by the earlier [Crown performance inputs research](https://github.com/aeltoum/no-excuses/blob/4ca37a6eac315c12a0431f16427c913bbd9b3c11/docs/research/crown-performance-inputs.md): platform aggregates are ranking inputs rather than anti-cheat proof, missing data is ineligible rather than zero, Cardio Leap compares matching benchmarks, and Load Progression uses ordinary Verified Workout-report data.

## Decision summary

1. **Use the operating-system health store as an optional, read-only mobile integration:** Apple HealthKit on iOS and Health Connect on Android. Both stores are device-local and require member authorization, so the mobile client must query them and send only normalized results to the No Excuses backend; there is no server-side equivalent of either API. HealthKit is Apple's central repository for iPhone and Apple Watch, while Health Connect is an Android, Google Play-dependent on-device platform. [[HealthKit overview](https://developer.apple.com/documentation/healthkit)] [[Health Connect architecture](https://developer.android.com/health-and-fitness/health-connect/architecture)]
2. **Top Steps has a reliable cross-platform API shape:** query the exact Group-week interval using HealthKit's merged cumulative step statistic or Health Connect's deduplicated `StepsRecord.COUNT_TOTAL`, with no source filter. HealthKit merges matching sources before calculating a statistic; Health Connect explicitly deduplicates Activity aggregates according to the member's source-priority list. [[Apple statistics](https://developer.apple.com/documentation/healthkit/hkstatistics)] [[Android aggregation](https://developer.android.com/health-and-fitness/health-connect/aggregate-data)]
3. **Cardio Leap has a narrower common denominator:** a workout/session type, start and end, recorded duration, recorded distance, and source provenance. HealthKit exposes those through `HKWorkout` and its quantity statistics; Health Connect uses `ExerciseSessionRecord` plus `DistanceRecord` over the session interval. Neither platform guarantees identical pause, distance, indoor/outdoor, equipment, or activity-classification semantics across every writer. No Excuses must therefore own the comparable benchmark identity and accept only matching, supported record pairs. Routes, heart rate, calories, speed samples, and location are unnecessary. [[Apple workouts](https://developer.apple.com/documentation/healthkit/hkworkout)] [[Android workouts](https://developer.android.com/health-and-fitness/health-connect/experiences/workouts)]
4. **Load Progression must remain independent of health-store data.** The common APIs document workout/session summaries, not a portable set-level model containing exercise, equipment, variation, repetitions, and numerical resistance. **Product inference:** use the existing Verified Workout report as the sole Load Progression input; request no HealthKit or Health Connect permission for it. Adding a wearable SDK, planned-workout API, or vendor-specific strength format would expand scope without supplying a reliable iOS/Android common denominator.
5. **Treat every imported result as source-attributed, not sensor-verified.** Both stores accept records written by apps. Apple exposes source/device and a writer-set user-entry flag; Android exposes a platform-assigned data origin plus writer-supplied device and recording method, including `UNKNOWN` and `MANUAL_ENTRY`. Those fields aid explanation and testing, but do not independently attest that activity occurred. [[Apple object provenance](https://developer.apple.com/documentation/healthkit/hkobject)] [[Apple user-entered metadata](https://developer.apple.com/documentation/healthkit/hkmetadatakeywasuserentered)] [[Android metadata](https://developer.android.com/health-and-fitness/health-connect/metadata)]
6. **Make foreground, member-triggered sync the pilot baseline.** It avoids Android's additional background-read permission and HealthKit's locked-device/background-delivery constraints. Recompute the complete interval on every sync, require one successful post-close sync during the accepted 24-hour settlement window, show last-sync status, and freeze results at finalization. Background refresh can be an optimization later, never the correctness path. [[Android synchronization](https://developer.android.com/health-and-fitness/health-connect/sync-data)] [[Apple privacy and locked data](https://developer.apple.com/documentation/healthkit/protecting-user-privacy)]

## 1. Common integration contract

Keep platform details behind one mobile-side activity-source boundary. It needs only these operations:

- report platform availability and the currently readable feature set;
- request the smallest read-permission set for Top Steps or Cardio Leap when the member enables that feature;
- return a Top Steps aggregate for an inclusive-start, exclusive-end interval;
- list eligible cardio sessions in a bounded interval and return a normalized result for a selected session;
- distinguish a successful read with no compatible data from an API error, while preserving the platform's authorization ambiguity; and
- return a sync timestamp plus the minimum source/audit summary.

The backend should provide the Group-week start and end as absolute instants derived from the Group's configured time zone. A local calendar week can contain a daylight-saving transition, so the client must not recreate the interval as a fixed 168 hours. Health Connect documents `TimeRangeFilter.between` as `[start, end)` and accepts `Instant`; Apple's date predicate and statistics APIs likewise accept explicit start/end dates and define how samples overlap the target interval. [[Android time-range filter](https://developer.android.com/reference/androidx/health/connect/client/time/TimeRangeFilter)] [[Apple sample-date predicate](https://developer.apple.com/documentation/healthkit/hkquery/predicateforsamples%28withstart%3Aend%3Aoptions%3A%29)]

The server payload should contain only the normalized competitive input and operational evidence needed to explain it:

- member, source family (`healthkit` or `health_connect`), and schema version;
- requested interval and the platform-reported result;
- successful sync time;
- for Top Steps, the unrounded count and contributing source identifiers when the platform supplies them;
- for Cardio Leap, platform record identifier or an application-scoped irreversible pointer, activity mapping, start/end, recorded duration, recorded distance, source application, recording classification when available, and the No Excuses benchmark identity; and
- eligibility/status reason, such as `readable`, `no_compatible_data`, `limited_history`, `revoked_or_unreadable`, `source_unavailable`, or `sync_error`.

Do not upload routes, coordinates, heart rate, calories, cadence, raw step samples, device serial-like identifiers, or the member's unrelated health history. Group-visible output remains the existing rounded step score or Cardio Leap percentage, source family, and freshness/eligibility state—not raw health records or device details.

## 2. iOS: HealthKit

### APIs and permissions

Enable the HealthKit capability, check `HKHealthStore.isHealthDataAvailable()`, and provide `NSHealthShareUsageDescription`. Request read authorization only when the member enables a Crown source. Apple requires fine-grained authorization by data type and advises requesting types when needed. [[HealthKit setup](https://developer.apple.com/documentation/healthkit/setting-up-healthkit)] [[HealthKit authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)]

Minimum read types:

- **Top Steps:** `HKQuantityType(.stepCount)`.
- **Cardio Leap:** `HKWorkoutType.workoutType()` and only the distance quantity types admitted by the eventual activity catalog, for example walking/running, cycling, or swimming distance.
- **Load Progression:** none.

Do not request write access. Do not request workout routes or location. The pilot does not need the background-delivery entitlement if correctness depends on foreground sync.

### Top Steps query

Use an `HKStatisticsQuery` or statistics-query descriptor for step count over the exact Group-week instants with `.cumulativeSum`. Do not use `.separateBySource` to calculate the competitive total: HealthKit's default statistic merges all matching sources first, while `separateBySource` is explicitly for callers that want to perform their own merge. A statistics collection query is useful for provisional display buckets, but the awarded result should be recomputed as one exact-interval aggregate. [[HealthKit statistics](https://developer.apple.com/documentation/healthkit/hkstatistics)] [[Statistics collection queries](https://developer.apple.com/documentation/healthkit/executing-statistics-collection-queries)]

For diagnostics, a bounded, separate source query may identify contributing applications/devices. It must not replace or be summed into the merged competitive total.

### Cardio query

Query `HKWorkout` records in the bounded interval, then normalize only supported activity types. A workout supplies activity type and recorded duration and acts as a container for associated samples; `statistics(for:)` exposes supported quantity statistics such as distance. Apple's documentation notes that workout duration may be the start/end interval, an explicitly supplied duration, or a value calculated from workout events. That is why duration semantics must be part of a Cardio Leap benchmark identity rather than assumed equivalent across writers. [[`HKWorkout`](https://developer.apple.com/documentation/healthkit/hkworkout)] [[Workout duration](https://developer.apple.com/documentation/healthkit/hkworkout/duration)]

HealthKit objects expose `uuid`, `sourceRevision`, optional `device`, and metadata. `HKSourceRevision` identifies the source plus version/OS/product information; `HKDevice` can contain device details. Keep detailed device fields on-device unless support needs them, because they do not improve the score and increase privacy exposure. [[HealthKit object](https://developer.apple.com/documentation/healthkit/hkobject)] [[Source revision](https://developer.apple.com/documentation/healthkit/hksourcerevision)] [[HealthKit device](https://developer.apple.com/documentation/healthkit/hkdevice)]

### Authorization and operational limits

Apple intentionally prevents an app from learning whether read permission was denied. A denied read returns only samples the app itself saved, and a member may instead grant a limited recent-history window. Since No Excuses writes no health samples, an empty result can mean no data, denial, or a limited window. The UI and eligibility model must say “No readable data” rather than claim a specific cause. Where available, `earliestAuthorizedSampleDate` can identify the earliest readable boundary, but it does not remove the per-type ambiguity. [[HealthKit authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)]

HealthKit observer queries can alert the app when matching samples are added or deleted, and background delivery requires an additional entitlement. However, HealthKit encrypts the store while the phone is locked, which can prevent background reads, and background query delivery is not supported in Simulator. These constraints reinforce foreground settlement sync as the pilot requirement. [[Observer queries](https://developer.apple.com/documentation/healthkit/executing-observer-queries)] [[HealthKit privacy](https://developer.apple.com/documentation/healthkit/protecting-user-privacy)]

## 3. Android: Health Connect

### Availability, APIs, and permissions

Use the Jetpack Health Connect client and check SDK/provider and feature availability at runtime. Health Connect requires an Android 9-or-newer mobile device with Google Play services; it is built into Android 14 and later and is a Play Store app on Android 13 and earlier. Work profiles are unsupported. Therefore, “Android supported” cannot imply “Crown activity source available.” [[Health Connect availability](https://developer.android.com/health-and-fitness/health-connect/availability)]

Minimum manifest/runtime read permissions:

- **Top Steps:** `android.permission.health.READ_STEPS`.
- **Cardio Leap:** `android.permission.health.READ_EXERCISE` and `android.permission.health.READ_DISTANCE`.
- **Load Progression:** none.

Do not request write, exercise-route, heart-rate, speed, calories, location, historical-data, or background-read permission for the baseline pilot. The three data-type permissions must match the types declared for Play review. Google requires a Play Console Health Apps declaration, Data Safety disclosure, a privacy policy, and a feature-specific justification for every requested type; it expressly instructs apps not to request broader access than necessary. [[Health Connect data types](https://developer.android.com/health-and-fitness/health-connect/data-types)] [[Publishing Health Connect apps](https://developer.android.com/health-and-fitness/health-connect/publish)]

### Top Steps query

Call `HealthConnectClient.aggregate()` with `StepsRecord.COUNT_TOTAL`, the exact `Instant` range, and an empty `dataOriginFilter`. Google recommends aggregation rather than raw cumulative records to avoid double counting. For Activity data, the Aggregate API removes overlaps according to the member's source-priority list; only the member can change that list. Filtering origins or summing raw records would abandon those documented semantics. [[Reading steps](https://developer.android.com/health-and-fitness/health-connect/read-data)] [[Aggregating data](https://developer.android.com/health-and-fitness/health-connect/aggregate-data)]

The result exposes the set of contributing `DataOrigin` values. Persist a minimized application-origin summary for audit, not raw records. The aggregate API has no recording-method filter, so it cannot both preserve the official priority-based total and promise to remove all manually classified or unknown records. [[Aggregation result](https://developer.android.com/reference/kotlin/androidx/health/connect/client/aggregate/AggregationResult)] [[Aggregate request](https://developer.android.com/reference/kotlin/androidx/health/connect/client/request/AggregateRequest)]

Health Connect's own on-device step collection requires Android 14, SDK Extension 20 or later, and at least one app with `READ_STEPS`; otherwise another application or device must write steps. An available Health Connect provider therefore does not guarantee a usable step total. An unfiltered aggregate automatically includes supported on-device steps. [[Reading mobile steps](https://developer.android.com/health-and-fitness/health-connect/read-data)]

### Cardio query

Read `ExerciseSessionRecord` in the bounded interval, then query or aggregate `DistanceRecord` over the same session interval and restrict it to the session's `DataOrigin`. The workout guide models exercise type/start/end on the session and distance as a separate associated record read over that time range. **Product inference:** because this is a temporal association rather than a cross-platform workout-to-distance foreign key, reject ambiguous overlapping sessions and sessions without a single explainable distance result. [[Health Connect workouts](https://developer.android.com/health-and-fitness/health-connect/experiences/workouts)] [[Health Connect data types](https://developer.android.com/health-and-fitness/health-connect/data-types)]

Per-record `Metadata` exposes a platform-assigned record `id`, last-modified time, platform-populated `DataOrigin`, optional client ID/version and device, and writer-supplied recording method. Recording method can be unknown, manual, automatically recorded, or actively recorded. Device classification is mandatory for new automatic/active writes but remains writer-supplied and older records may be weaker. Use these fields to explain/reconcile a session, not to call it verified. [[Metadata reference](https://developer.android.com/reference/androidx/health/connect/client/records/metadata/Metadata)] [[Metadata requirements](https://developer.android.com/health-and-fitness/health-connect/metadata)]

### Authorization and operational limits

Android exposes the currently granted permission set, and members may revoke permissions at any time. Check permission state before every sync and handle partial grants without crashing. This differs from Apple's read-denial ambiguity, so the shared state model must preserve a generic unreadable state while Android may offer a more specific remediation. [[Health Connect permissions](https://developer.android.com/health-and-fitness/health-connect/ui/permissions)]

By default, an app can read only the 30 days preceding its first permission grant. The additional history permission can extend that range when the installed provider supports the feature. Because the accepted Performance baseline spans eight weeks, build baselines prospectively after connection rather than request broader history for the pilot; a member's first comparable result establishes the baseline and is not eligible to win. [[Health Connect read restrictions](https://developer.android.com/health-and-fitness/health-connect/read-data)] [[History permission](https://developer.android.com/reference/androidx/health/connect/client/permission/HealthPermission)]

Foreground reads may be interrupted and Health Connect does not notify a foreground-only app of new data. Background reads require a separate permission/feature. Re-reading the entire bounded interval on app activation or explicit sync is simpler and correctly reflects later insertions, updates, deletions, and source-priority changes before finalization. [[Health Connect synchronization](https://developer.android.com/health-and-fitness/health-connect/sync-data)]

## 4. Platform comparison and accepted limits

| Concern | HealthKit | Health Connect | Pilot contract |
| --- | --- | --- | --- |
| Top Steps | Merged cumulative `stepCount` statistic | Priority-deduplicated `StepsRecord.COUNT_TOTAL` | Use unfiltered platform aggregate for exact Group-week instants |
| Cardio session | `HKWorkout` plus quantity statistics | `ExerciseSessionRecord` plus time-associated `DistanceRecord` | Normalize only supported, unambiguous session records |
| Read denial | Deliberately indistinguishable from absent data; history may be limited | Granted set is inspectable; history defaults to 30 days | Missing/limited/unreadable means ineligible, never zero |
| Provenance | Object UUID, source revision, optional device, metadata | Record ID, last modified, data origin, optional device, recording method | Audit/explanation only; never anti-cheat proof |
| Manual classification | Writer-set `HKMetadataKeyWasUserEntered` | Writer-set manual/automatic/active/unknown method | Do not promise manual-data exclusion from official aggregates |
| Background | Observer/background delivery available, but locked-store and device-test constraints apply | Additional feature and user permission required | Foreground settlement sync is required; background is optional |
| Strength detail | No portable set/load contract in the required workout summary | No iOS-equivalent portable set/load contract | Use Verified Workout report for Load Progression |

The integration is optional per member. A member whose device, provider, permissions, history, writer coverage, or sync state cannot supply the category input can still use No Excuses but is ineligible for that Crown category. This is consistent with the accepted rule that missing data is not a zero.

## 5. Cardio Leap eligibility boundary

Health-store data can supply the measured result, but not every comparability field. No Excuses must create and retain a benchmark identity containing:

- normalized activity modality;
- benchmark type (`fixed_distance` or `fixed_duration`) and exact target;
- indoor/outdoor or named equipment/environment class where it changes measurement semantics;
- active-time/pause semantics;
- source family and, when necessary, source/device class; and
- canonical units.

An imported session is eligible only when it supplies a positive recorded distance and duration, maps unambiguously to a supported activity, has no conflicting overlap, and matches the member's baseline identity. The current and baseline result must use the same benchmark identity. No route is required to calculate either accepted formula:

```text
fixed distance: (baseline seconds - current seconds) / baseline seconds * 100
fixed duration: (current distance - baseline distance) / baseline distance * 100
```

Platform activity types and metadata are classification aids, not enough by themselves to prove “same treadmill,” “same rowing machine,” “moving time,” or “same pool setup.” The member must confirm those No Excuses-owned fields when importing the session. Unsupported or ambiguous sessions remain visible as unusable for Cardio Leap rather than silently coerced.

## 6. Sync and finalization contract

1. The member explicitly connects Top Steps and/or Cardio Leap and grants the relevant read types.
2. The app performs a foreground read, reports the interval and sync time, and labels the result provisional.
3. Each later sync recomputes the complete interval. It does not increment a server total from device events.
4. During the 24-hour settlement window, the member must complete one successful foreground sync after the Group-week end. A missing, interrupted, stale, limited, or unreadable result makes that category ineligible.
5. The server calculates the Crown result from the latest accepted normalized input and freezes it at finalization. Later health-store edits do not silently rewrite finalized Group history.

This contract tolerates late wearable-to-phone delivery, edits/deletions, Android priority changes, and background restrictions without requiring always-on health access.

## 7. Testing constraints and minimum matrix

Create adapter contract tests from deterministic normalized fixtures before testing either platform. Then cover the same product states on both platforms: unavailable source, permission not requested, partial grant, denial/revocation, no records, stale records, limited history, zero versus absent aggregate, API interruption, late data, edit/delete, manual/unknown provenance, multiple overlapping sources, source-priority changes, overlapping cardio sessions, unsupported activity, unit conversion, and Group-week boundaries across daylight-saving changes and travel.

Platform integration testing must include:

- **iOS:** a real compatible device with HealthKit and at least two realistic sources (for example iPhone plus Apple Watch or another writer); grant, deny, revoke, and limited-history authorization; foreground reads while unlocked; late source sync and deletion; and locked/background behavior if background delivery is ever added. Apple states background HealthKit query delivery is not supported in Simulator, so that path requires device testing. [[Apple observer-query testing](https://developer.apple.com/documentation/healthkit/executing-observer-queries)]
- **Android:** Android 13-or-earlier with the Health Connect app, Android 14-or-later with the system provider, an unsupported/no-Google-Play-services device state, provider versions with and without relevant optional features, and work-profile rejection. Use Google's Health Connect Toolbox to insert/inspect/update/delete records and the official `FakeHealthConnectClient` for unit tests and permission/API failures. Google's published test cases explicitly cover onboarding, unavailable provider, unlinking, permission denial, raw reads, and aggregates. [[Health Connect testing library](https://developer.android.com/health-and-fitness/health-connect/test/unit-tests)] [[Health Connect Toolbox](https://developer.android.com/health-and-fitness/health-connect/test/health-connect-toolbox)] [[Health Connect test cases](https://developer.android.com/health-and-fitness/health-connect/test/test-cases)]
- **Cross-platform acceptance:** identical fixtures must normalize to the same step count, cardio units, benchmark identity, eligibility reason, and percentage result; platform-specific provenance may remain additive and private.

Run finalization tests with the device offline at week close, then with a successful post-close sync inside and outside the settlement window. Verify that a missing aggregate is never converted to zero and that finalized awards remain immutable after source edits.

## 8. Consequences for technical planning

- Any chosen mobile stack must support a small native HealthKit adapter and a small native Health Connect adapter, including runtime permissions and lifecycle-aware foreground reads. A cross-platform library is acceptable only if it exposes these exact capabilities and does not broaden permissions.
- No direct Fitbit, Garmin, Strava, Samsung Health, Apple Watch, Wear OS, or other vendor integration is needed for the pilot. Those services may contribute through the member's platform health store when supported.
- Top Steps and Cardio Leap require independent opt-in and permission rationale so a member can connect one without the other.
- The onboarding/settings/state plan must include source unavailable, not connected, partially authorized, no readable data, limited history, synced, stale, revoked, and sync error states. On iOS, wording must not claim the app knows that read access was denied.
- The privacy plan must disclose the off-device transmission and Group visibility of derived Crown results and obtain the member's express authorization before sharing. Apple limits HealthKit use to health/fitness purposes and requires express consent before disclosure to a third party; Google requires consistent privacy-policy and Play declarations. [[Apple HealthKit privacy rules](https://developer.apple.com/documentation/healthkit/protecting-user-privacy)] [[Google Play publishing](https://developer.android.com/health-and-fitness/health-connect/publish)]

## Sources

Only Apple Developer documentation, Android Developer/Jetpack documentation, and Google's first-party Android Help documentation were used. Product inferences are labeled and are bounded by the documented API behavior above.
