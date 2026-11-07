# Physical phone run, 2026-11-07 (option A: LAN through the phone's hotspot)

Performed by Krishna Teja on his own phone. In the W4 plan this task belonged to Jaya Prakash; it
was reassigned on the day. The independent second-machine rerun is still Jaya Prakash's.

| Item | Value |
|---|---|
| Phone | realme 11 Pro+ 5G (RMX3741), realme UI 6.0, Android 15 |
| Browser | Chrome 156.0.8078.79 (Android) |
| Network | phone hotspot `Kt`; laptop `10.107.185.161`; laptop Ethernet disconnected |
| Laptop side | [`phone-run-laptop.log`](phone-run-laptop.log): commit `853956d` (code identical to `fde2efd`), `IAM_PUBLIC_HOST=10.107.185.161`, `IAM_BIND_ADDRESS=0.0.0.0` |
| Secure-context workaround | Chrome flag *Insecure origins treated as secure* for `http://10.107.185.161:{5173,8180,3100}`. `chrome://version` shows `--unsafely-treat-insecure-origin-as-secure` |
| Recording | 12:03:32 to 12:07 IST (06:33 to 06:37 UTC), 3 min 41 s, Android screen recorder |
| Raw video SHA-256 | `79351ab73a2f035dc3c72b06ec6ed3cfa222d88039f21ac9cc1841ae5af5507a` |
| Edited video SHA-256 | `3abb0c37cdfcd9403126db96c15dc3783fad3bdf935ef0ca2d45fa5d9985a729` (71 s) |

The videos are not committed. The edited copy only removes idle time, speeds up typing (4x) and other
movement (1.5x), and blurs the keyboard's e-mail autofill chip and one advertising notification.
No request, response or result was cut.

## Observed on the phone

| # | Action | Observed |
|---|---|---|
| 1 | Sign in with Keycloak as `alice` (page served by `10.107.185.161:8180`, realm IAM-PLATFORM) | signed in; Acme Learning Corp `admin`, Globex University `learner` |
| 2 | Acme, `GET /resources` | **200**, 3 rows, scoped to Acme |
| 3 | Acme, `GET /members` | **200** |
| 4 | Switch to Globex, `GET /resources` | **200**, Globex only |
| 5 | Globex, `GET /members` | **403** `AUTHORIZATION_DENIED`: Acme admin role does not carry over |
| 6 | `GET /sessions` | **200**, 1 row: own `iam-mobile` Keycloak session |
| 7 | Rotate refresh token | "Refresh token rotated" |
| 8 | Sign out | "Not signed in" |
| 9 | Enterprise SSO: redirected to realm IAM-ENTERPRISE, login `enterprise.bob` | back in the app via the broker; Acme Learning Corp `instructor` |
| 10 | Acme, `GET /resources`, then `GET /members` | **200**, then **403**; decision log 12:06:56 `/resources` 200, 12:07:00 `/members` 403 |

Not done on camera: the final sign-out after step 10 (the recording stops while Bob is still signed in).
The LAN configuration was reverted afterwards (`localhost` bindings restored and checked).
