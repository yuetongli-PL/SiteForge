# Reddit Browser Bridge Route Queue

Generated: 2026-06-09T01:25:15.356Z

Summary:
- Candidate routes: 1042
- Selected routes: 96
- Concrete routes: 597
- Route-template-only entries: 445
- Browser Bridge eligible routes: 362
- Public routes: 218
- Auth/private routes: 73
- Auth entry routes: 10
- Moderator-limited routes: 61
- Browser boundary routes: 3
- Write-disabled routes: 157
- API-disabled routes: 520

Execution boundary:
- The queue is derived from sanitized authorized route/link/form/control summaries.
- Browser Bridge may use operator-authorized cookies at runtime, but cookies and browser profile data are not persisted.
- Write and mutation routes are retained for coverage and disabled by default.
- Official API reads remain on the Reddit OAuth runtime boundary.
