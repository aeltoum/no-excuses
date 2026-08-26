# Crown performance inputs

Research for [Research trustworthy Crown performance inputs](https://github.com/aeltoum/no-excuses/issues/23), current through 2026-08-26.

## Question

Which first-party activity-data sources and semantics can provide trustworthy deduplicated weekly step totals for the private pilot; which published strength-estimation method and repetition range can compare ordinary verified sets without prompting true maximum-effort tests; and which data fields and formulas can normalize fixed-distance and fixed-duration cardio improvement?

## Decision summary

1. **Top Steps can use Apple HealthKit and Android Health Connect as platform-aggregated inputs, not as anti-cheat proof.** HealthKit statistics merge samples from multiple sources by default, while Health Connect's Aggregate API deduplicates Activity data according to the user's source-priority list. Both platforms expose provenance. **Product inference:** because third-party apps can write records and supply classification metadata, neither interface is evidence that the recorded performance physically occurred. [[Apple HealthKit statistics](https://developer.apple.com/documentation/healthkit/hkstatistics)] [[Android write semantics](https://developer.android.com/health-and-fitness/health-connect/write-data)]
2. **The pilot cannot simultaneously guarantee an official deduplicated Android total and exclude every manually entered step.** Health Connect exposes recording method on raw records, but its deduplicated Aggregate API returns totals rather than per-record recording metadata. **Product inference:** reading and filtering raw records gives up the documented user-priority deduplication performed by the Aggregate API. [[Android recording metadata](https://developer.android.com/health-and-fitness/health-connect/metadata)] [[Android aggregate semantics](https://developer.android.com/health-and-fitness/health-connect/aggregate-data)]
3. **No published estimated-1RM method makes an arbitrary ordinary 3–10-repetition set a trustworthy strength measure.** The relevant research equations consume a repetition-maximum or repetitions-to-fatigue set. Prediction worsens as repetitions rise, depends on the exercise and equipment, and requires controlled technique. A set deliberately kept short of fatigue does not contain the missing repetitions-in-reserve input. [[Reynolds, Gordon, and Robergs 2006](https://www.unm.edu/~rrobergs/478RMStrengthPrediction.pdf)]
4. **Cardio Leap is supportable as within-person benchmark improvement, not as a cross-person comparison of raw performance.** Compare the same activity and benchmark definition, recorded by the same source/device class where practical. For fixed distance, compare elapsed active time; for fixed duration, compare distance. Time- and distance-based trials are distinct protocols with different pacing behavior. [[Abbiss et al. 2016](https://pubmed.ncbi.nlm.nih.gov/26868360/)]
5. **The accepted 0.1-percentage-point rounding rule is display precision, not evidence that a change is real.** Controlled cycling trials report within-participant variation and meaningful-change thresholds of several percentage points, depending on protocol and population. A later product decision must define a noise/tie rule by benchmark family or describe small changes only as provisional. [[Borg et al. 2018](https://pubmed.ncbi.nlm.nih.gov/29395633/)] [[Funnell, Mears, and James 2023](https://pubmed.ncbi.nlm.nih.gov/37979194/)]

## 1. Weekly step totals

### Recommended source semantics

Use the platform's unfiltered aggregate over the exact start and end instants of the Group's Accountability week:

- On Apple platforms, query `stepCount` with a cumulative statistics query. HealthKit statistics merge matching samples from all sources by default; `separateBySource` is available for audit views but should not be summed to produce the Crown total. Apple documents weekly statistics collection queries anchored to a chosen weekday and time. [[HealthKit statistics](https://developer.apple.com/documentation/healthkit/hkstatistics)] [[HealthKit weekly query example](https://developer.apple.com/documentation/healthkit/executing-statistics-collection-queries)]
- On Android, request `StepsRecord.COUNT_TOTAL` through `aggregate()` without a `DataOrigin` filter. Google explicitly recommends aggregation for cumulative steps to reduce double counting, and the Aggregate API applies the user's Activity source priorities when overlapping sources exist. [[Read Health Connect steps](https://developer.android.com/health-and-fitness/health-connect/read-data)] [[Health Connect aggregation](https://developer.android.com/health-and-fitness/health-connect/aggregate-data)]
- Derive the interval from the Group's configured time zone, not the phone's current zone. Health Connect records carry start/end instants and experienced zone offsets, and Google warns that missing or incorrect offsets can change history aggregation when a user travels. HealthKit's collection query is likewise anchored with a calendar and time zone. [[Health Connect `StepsRecord`](https://developer.android.com/reference/androidx/health/connect/client/records/StepsRecord)] [[HealthKit weekly query example](https://developer.apple.com/documentation/healthkit/executing-statistics-collection-queries)]

This produces the closest available equivalent to the total shown by the member's system health store. It does **not** mean totals from different phones and wearables have identical sensor accuracy.

### Provenance and manual-entry limits

HealthKit samples expose the source app/device, and Apple defines `HKMetadataKeyWasUserEntered` for a writer to flag user-entered data. A HealthKit query can predicate on metadata, so the pilot can reject records explicitly flagged as user-entered while retaining a cumulative query. **Product inference:** because Apple instructs the writer to set the flag, it is provenance metadata rather than independent attestation. [[HealthKit source queries](https://developer.apple.com/documentation/healthkit/hksourcequery)] [[HealthKit user-entered metadata](https://developer.apple.com/documentation/healthkit/hkmetadatakeywasuserentered)] [[HealthKit metadata predicates](https://developer.apple.com/documentation/healthkit/hkquery/predicateforobjects%28withmetadatakey%3Aoperatortype%3Avalue%3A%29)]

Health Connect automatically records the writer's package as `DataOrigin`, but the writer supplies recording method and device metadata. New records must say whether they are manual, automatic, active, or unknown, yet Google's API still permits `UNKNOWN` and relies on the writer to classify the record correctly. [[Health Connect data format](https://developer.android.com/health-and-fitness/health-connect/data-format)] [[Health Connect metadata requirements](https://developer.android.com/health-and-fitness/health-connect/metadata)]

The Android Aggregate API can filter by `DataOrigin`, but it does not document a recording-method filter. **Product inference:** the product therefore has three imperfect choices:

1. **Recommended pilot rule:** use the unfiltered platform aggregate and describe it as “Health Connect total.” Reject direct manual entry into No Excuses, but do not promise that all manual data written by other apps is excluded.
2. Allowlist particular origins. This narrows coverage, and a single origin can still contain more than one recording method.
3. Read raw records, discard `MANUAL_ENTRY` and `UNKNOWN`, and implement custom overlap resolution. This no longer reproduces Health Connect's user-controlled priority semantics and should not be called the Health Connect total.

No option turns the health store into anti-cheat evidence. The defensible integrity promise is: **the score came from the member-authorized system health store, used the platform's merge rules, and was not typed into No Excuses**.

### Coverage and availability

HealthKit is Apple's central health repository across iOS, iPadOS, and watchOS. Access is per data type and optional. Apple deliberately prevents an app from distinguishing read denial from absent data, and users may grant only a limited recent-history window. Missing steps must therefore mean “not eligible / not synced,” never zero. [[HealthKit overview](https://developer.apple.com/documentation/healthkit)] [[HealthKit authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)]

Health Connect requires an Android 9-or-newer mobile device with Google Play services. It is built into Android 14 and newer; on Android 13 and older the user must install the Health Connect app. Work profiles are unsupported. [[Health Connect availability](https://developer.android.com/health-and-fitness/health-connect/availability)]

Health Connect's native on-device step capture additionally requires Android 14 with SDK Extension 20 or newer. Otherwise, Health Connect availability alone does not imply any app or device is writing steps. [[Health Connect mobile steps](https://developer.android.com/health-and-fitness/health-connect/read-data)]

By default, Health Connect reads only the 30 days preceding first permission. An eight-week baseline therefore requires either the additional history permission or, preferably for data minimization, storing weekly derived Crown results prospectively after connection. [[Health Connect read restrictions](https://developer.android.com/health-and-fitness/health-connect/read-data)]

### Live and final standings

Both stores may change after an initial read: Apple lets users and apps add, delete, and merge data outside No Excuses; Health Connect exposes insert/delete change synchronization. HealthKit may also be unreadable in the background while the device is locked, and Health Connect background reads require a separate permission. [[HealthKit overview](https://developer.apple.com/documentation/healthkit)] [[HealthKit privacy and locked data](https://developer.apple.com/documentation/healthkit/protecting-user-privacy)] [[Health Connect synchronization](https://developer.android.com/health-and-fitness/health-connect/sync-data)]

Product constraints:

- Mark standings “provisional” and show a last-synced time.
- Recompute from the store rather than incrementing a server total from client events.
- At week close, allow a defined sync grace period and require one successful post-close read before finalizing a member's total; otherwise mark that member ineligible rather than assuming the last provisional number is complete.
- Freeze the awarded Crown after finalization. Later store edits can be retained for audit but must not silently rewrite Group history.

## 2. Strength Leap

### What published equations actually measure

Reynolds, Gordon, and Robergs tested 1-, 5-, 10-, and 20-repetition maxima in chest press and leg press. Their 5RM input produced the best 1RM predictions, accuracy worsened with higher repetition counts, and they concluded that prediction equations should be exercise-specific. They also cautioned against applying their leg-press equation to different equipment or movement timing. [[Reynolds, Gordon, and Robergs 2006](https://www.unm.edu/~rrobergs/478RMStrengthPrediction.pdf)]

The same study cross-validated familiar published formulas, including:

```text
Brzycki estimated 1RM = load / (1.0278 - 0.0278 × repetitions)
Epley estimated 1RM   = load × (1 + 0.033 × repetitions)
```

Both were specified for no more than ten repetitions. The paper found Epley among the smallest-residual equations for its leg-press data, while Brzycki was among the most accurate for its chest-press data; neither was universally best. All equations were based on a repetition maximum or repetitions to fatigue, not an ordinary set stopped with unknown capacity remaining. [[Reynolds, Gordon, and Robergs 2006](https://www.unm.edu/~rrobergs/478RMStrengthPrediction.pdf)]

More recent cross-validation remains movement-specific: a 2025 study of recreationally active young men recommended modified equations for bench press and leg extension using weights that produced 4–10 repetitions to failure. It did not validate one generic equation for arbitrary lifts, machines, populations, or non-fatiguing sets. [[Roberts et al. 2025](https://pubmed.ncbi.nlm.nih.gov/39495260/)]

### Conflict with the accepted Crown rule

The desired Strength Leap currently asks for all three of the following:

- an ordinary verified set of 3–10 repetitions;
- no app-directed maximum-effort test or exercise to failure;
- a percentage increase in estimated maximum strength.

The research does not support that combination. Repetitions and load alone cannot distinguish a true 5RM from the same five repetitions performed with five more repetitions in reserve. Applying Brzycki or Epley would give both sets the same estimated maximum.

The product must choose one of these interpretations before Strength Leap is implementation-ready:

1. **Keep “strength” and accept a local maximum test:** use a standardized 5RM set performed to technical repetition maximum, with matching exercise, variation, equipment, range of motion, resistance unit, and technique. Compare the current result with the member's best eligible 5RM in the baseline window. This avoids a true 1RM but still asks for maximum repetitions at that load, so it conflicts with the accepted no-maximum-test direction.
2. **Keep ordinary sets and rename the measure:** award a **Load Progression** Crown for increasing resistance at the same exercise, variation, equipment, and completed repetition count. Formula: `(current load - baseline load) / baseline load × 100`. This is a transparent training-progression proxy, not an estimated maximum or proof of physiological strength gain.
3. **Limit e1RM to validated protocols:** support only exercise/equipment combinations with an appropriate published equation and matching test protocol. This is defensible but too narrow for a general three-category pilot and creates a growing formula catalog.

There is no research-backed reason to pick 3–10 over 4–10 or exactly 5 except product coverage. The strongest evidence found here favors a 5RM and strict protocol; it does not make a casual 3-repetition set eligible.

### Verification limits

The existing Workout report can verify that the member reported an exercise, sets, repetitions, and resistance. A Proof photo cannot establish full range of motion, loading accuracy, tempo, assistance, equipment equivalence, or repetitions in reserve. Consequently, even the chosen strength score remains a Group-trust proxy rather than a measured laboratory outcome.

## 3. Cardio Leap

### Eligible benchmark shapes

Two benchmark types are established and mathematically coherent:

- **Fixed distance:** same activity and distance, with completion time as the outcome. `improvement % = (baseline seconds - current seconds) / baseline seconds × 100`.
- **Fixed duration:** same activity and active duration, with distance as the outcome. `improvement % = (current distance - baseline distance) / baseline distance × 100`.

The original Cooper field test used distance covered during a fixed 12-minute interval, while controlled exercise research also uses fixed-distance and fixed-duration self-paced time trials. The two trial shapes can produce different pacing behavior, so they must never share a baseline. [[Cooper 1968](https://pubmed.ncbi.nlm.nih.gov/5694044/)] [[Abbiss et al. 2016](https://pubmed.ncbi.nlm.nih.gov/26868360/)]

### Required comparable fields

An eligible pair needs:

- member identity;
- activity modality (for example running, walking, cycling, rowing, or swimming);
- benchmark type (`fixed_distance` or `fixed_duration`);
- target distance in a canonical length unit or target active duration in seconds;
- measured result: active elapsed seconds or distance in a canonical length unit;
- workout start/end and pause semantics sufficient to derive active duration consistently;
- source app, recording method, and device class for eligibility/audit;
- the exact activity variation needed for comparability, such as indoor treadmill versus outdoor run, stationary versus outdoor cycling, pool length/stroke where applicable, and assisted versus unassisted activity;
- the source record identifier so an edited or deleted workout can be reconciled before finalization.

These fields exist in the platform models at different layers. HealthKit workouts expose activity type, duration, start/end, source/device, and quantity statistics such as distance. Health Connect exercise sessions expose start/end, exercise type, metadata, laps/segments/route, while distance is a separate associated record aggregated over the session interval. [[Apple `HKWorkout`](https://developer.apple.com/documentation/healthkit/hkworkout)] [[Android workout model](https://developer.android.com/health-and-fitness/health-connect/experiences/workouts)]

Routes are not needed to compute either formula. Apple routes contain timestamped latitude, longitude, and altitude, and Android routes likewise contain location points and accuracy data. The pilot should not request or retain route permission merely to calculate distance and time. [[Apple workout routes](https://developer.apple.com/documentation/healthkit/creating-a-workout-route)] [[Android workout model](https://developer.android.com/health-and-fitness/health-connect/experiences/workouts)]

### Comparability and measurement noise

Require the current and baseline performance to match on member, modality, benchmark type, benchmark target, indoor/outdoor or equipment variation, and active-time semantics. Prefer the same source/device class. A treadmill distance and GPS distance, or moving time and wall-clock time, are different benchmarks even when the displayed activity name matches.

Do not infer that a 0.1% change is meaningful. In a controlled 10/20 km cycling study, the improvement required to exceed measurement variability ranged from about 3% to 12.9% across distance and participant background before familiarization, and about 3% to 6.4% after familiarization. A controlled 15-minute cycling trial found a mean within-participant coefficient of variation of 2.1%. These numbers demonstrate protocol-specific noise; they are not universal thresholds for running, walking, or device-recorded workouts. [[Borg et al. 2018](https://pubmed.ncbi.nlm.nih.gov/29395633/)] [[Funnell, Mears, and James 2023](https://pubmed.ncbi.nlm.nih.gov/37979194/)]

For the pilot, retain 0.1 percentage point as display rounding only. Before awarding Cardio Leap, choose one of:

- a benchmark-family minimum improvement threshold supported by validation evidence;
- a same-displayed-score tie plus an explicit “small differences may be measurement noise” rule; or
- ranking all positive changes while describing the Crown as a playful workout-record result, not a claim of physiological improvement.

The last option fits a friend-based MVP but is the weakest measurement claim.

## 4. Privacy and data minimization

Apple requires fine-grained permission, clear disclosure, a privacy policy, and express permission before sharing HealthKit-derived data with a third party. Google Play requires each Health Connect data type to support a specific user-facing feature and disallows broader access than necessary. [[Apple HealthKit privacy](https://developer.apple.com/documentation/healthkit/protecting-user-privacy)] [[Google Health Connect publishing](https://developer.android.com/health-and-fitness/health-connect/publish)]

For these Crowns, the smallest useful permission/data surface is:

- Top Steps: step-count read permission only.
- Cardio Leap: exercise-session and distance read permissions; do not request route, heart rate, calories, speed samples, or location unless a later decision makes one essential.
- Strength Leap: no health-store permission is justified by this research; use the existing verified Workout report unless a later supported equipment source is chosen.

Transmit and retain only the Group-visible weekly total or Leap score plus the minimum audit fields needed to explain eligibility: source family, sync status/time, benchmark identity, and source-record identifier or non-reversible pointer. Do not expose routes, detailed timestamps, heart rate, device model, or raw workout samples to the Group.

## 5. Product decisions unblocked by this research

The following can be specified now:

- Top Steps means the HealthKit/Health Connect platform aggregate for the Group-week interval, recomputed until finalization.
- Missing, denied, limited, stale, or post-close-unsynced data makes a member ineligible; it never becomes zero and never affects targets or streaks.
- The product may reject data explicitly marked manual but cannot promise that platform totals are sensor-attested or manipulation-proof.
- Cardio Leap uses the two formulas above only between matching benchmark identities and does not require route access.
- The eight-week baseline should be built prospectively where possible; Health Connect's default history window is shorter than eight weeks.

Two decisions remain necessary:

1. **Strength meaning:** relax the no-maximum-test rule for a controlled 5RM, rename the category to Load Progression for ordinary sets, or narrow eligibility to a small catalog of validated exercise protocols.
2. **Cardio noise:** decide whether Crown ranking treats every displayed improvement as competition, introduces benchmark-specific minimum-change thresholds, or treats near-equal results as ties.

## Sources

Only first-party platform documentation and primary/official exercise research were used. The principal sources are linked inline so each material constraint can be traced to its owner.
