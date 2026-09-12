---
status: superseded by ADR-0004
---

# Use React Native and Expo for the mobile client

No Excuses will use React Native with Expo development builds for its shared iOS and Android client. This gives one developer working with Codex a shared TypeScript and React implementation while retaining Swift and Kotlin escape hatches for the camera, private media, notifications, verified links, HealthKit, Health Connect, and any platform behavior required by the private-pilot quality bar. Flutter, Kotlin Multiplatform with shared or native UIs, and separate native applications remain technically credible, but their additional language, toolchain, duplicated-UI, or platform-integration cost does not justify their lower abstraction risk for this pilot.

## Consequences

- Expo Continuous Native Generation, committed configuration and config plugins, local Expo modules, Expo Router, and a feature-oriented modular monolith form the project model. Expo Go is not a supported development target.
- The server is authoritative for accountability state. TanStack Query holds replaceable server cache; React state and reducers hold transient UI state; SQLite holds durable drafts and the narrow upload journal; SecureStore holds credentials and encryption keys; and Proof media remains in private app storage.
- Starting a Workout session requires an online server acknowledgement. Once started, capture and drafting may continue offline. Consequential mutations use client-generated idempotency keys, remain visibly pending until acknowledged, and never appear optimistically finalized.
- Product features depend on app-owned platform interfaces instead of framework-plugin APIs. First-party Expo modules are preferred when they satisfy the contract; HealthKit and Health Connect use small local Expo modules unless a maintained library passes the exact permission, aggregation, lifecycle, privacy, and testing requirements.
- Product UI is shared by default, but a platform-specific component or screen is required when physical-device correctness or accessibility evidence shows the shared implementation cannot meet the quality bar.
- Unsubmitted drafts and Proof media are bound to the capturing device. Network boundaries use versioned wire contracts with generated TypeScript types where practical and runtime validation, without sharing backend persistence or service models with features.
- Dependency versions are pinned and upgraded deliberately with physical-device acceptance. If Continuous Native Generation cannot represent a required native change deterministically, the project moves to checked-in native projects while retaining React Native and the app-owned interfaces; replacing the framework requires evidence from a release-build device test that a requirement remains impossible.
