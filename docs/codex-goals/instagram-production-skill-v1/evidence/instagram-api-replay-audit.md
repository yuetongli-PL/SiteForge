# Instagram API Replay Audit

- Status: verified
- Verified operations: 4/4
- Active API capabilities: 3
- Sensitive material: sanitized_summary_only; cookie/auth/profile/raw private material is not persisted in this audit.

| Operation | Endpoint Template | Replay Verified | Adapter Bound | Runtime Tested |
|---|---|---:|---:|---:|
| `instagram-web-profile-info` | `/api/v1/users/web_profile_info/?username={account}` | yes | yes | yes |
| `instagram-feed-user` | `/api/v1/feed/user/{userId}/?count={count}&max_id={cursor?}` | yes | yes | yes |
| `instagram-friendships-following` | `/api/v1/friendships/{userId}/following/?count={count}&max_id={cursor?}` | yes | yes | yes |
| `instagram-friendships-followers` | `/api/v1/friendships/{userId}/followers/?count={count}&max_id={cursor?}` | yes | yes | yes |
