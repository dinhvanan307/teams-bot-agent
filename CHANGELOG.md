# Changelog

## 0.2.0 — 2026-10-22

- Preserve application base path in Teams package links; derive manifest and health version from package.json; reject query, fragment and messaging endpoint confusion.
- Add local readiness checks, drain admission, active-handler tracking and bounded graceful shutdown with forced-exit status.
- Add secret `_FILE` loading, fail-closed production state/key requirements, encrypted backup verification and offline restore into a new state directory.
- Add a platform-neutral Node release ZIP, per-file checksums, Git provenance, pinned tested Node, reference Linux service/journal/Nginx configuration and runbooks.
- Add operations regression tests and GitHub Actions for build/test/release. Keep host and real Teams/AI integration explicitly NOT_TESTED pending the acceptance plan.

## 0.1.0

Local prototype: Teams message handler and tenant guard, four text AI adapters, encrypted local runtime settings, preview and mock API tests. No accepted production deployment or real Teams integration is asserted.
