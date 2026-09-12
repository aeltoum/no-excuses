---
status: accepted
---

# Use an installable PWA for the True MVP client

No Excuses will deliver the active True MVP as an installable Progressive Web App for
iPhone and Android browsers. This removes app-store membership and physical-iPhone access
from the current MVP delivery path while keeping one responsive client for the approved
friend-Group accountability loop. Existing React Native/Expo work remains preserved and
deferred for later native application implementation; ADR-0001 no longer controls active
True MVP delivery.

## Consequences

- PWA implementation must reuse the accepted Supabase, PostgreSQL, email OTP, versioned API,
  privacy, accessibility, and True-MVP product boundaries.
- PWA browser support, installation, responsive behavior, accessibility evidence, and
  release criteria replace native-device and app-store gates for the active MVP only.
- Native-only integrations and native distribution remain deferred, not rejected.
- This decision selects no web framework, dependency, hosting provider, service account,
  deployment configuration, or spending. Those require separately scoped approval.
