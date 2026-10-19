# Upwork call history

Generated 10-19 12:33 (Asia/Yerevan) from 13,813 logged calls, 10-13 12:22 → 10-19 12:16.
Regenerate with `npm run -s calls -- report`. Source: `public.upwork_calls` (permanent), else `public.mcp_log` (7 days).

## Current limits

| Limit | Value |
|---|---|
| Calls per day | 2800 (hard cap 2800) |
| Calls per hour | 200 |
| Searches per day | 1400 |
| Job opens per day | 120 |
| Same job re-opened | at most once per 6 h, never after a refusal |

## Per day (Yerevan time)

| Day | Calls | Searches | Job opens | Other | Max / hour | Max / 10 min | Max opens / hour | Throttled | Restricted | Other errors |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-13 | 1268 | 898 | 359 | 11 | 170 | 40 | 61 | 0 | 0 | 0 |
| 2026-10-14 | 1309 | 915 | 380 | 14 | 174 | 51 | 59 | 0 | 0 | 0 |
| 2026-10-15 | 4362 | 2455 | 1313 | 594 | 467 | 278 | 125 | 540 | 56 | 149 |
| 2026-10-16 | 1692 | 1029 | 612 | 51 | 295 | 79 | 135 | 49 | 0 | 11 |
| 2026-10-17 | 4284 | 2863 | 1365 | 56 | 236 | 59 | 82 | 737 | 176 | 5 |
| 2026-10-18 | 569 | 524 | 43 | 2 | 76 | 19 | 16 | 0 | 0 | 0 |
| 2026-10-19 | 329 | 312 | 17 | 0 | 74 | 16 | 17 | 0 | 0 | 0 |

## Throttle and restriction episodes

Rates are counted over all calls before the first error of each episode.

| Start | End | Kind | Errors | Calls 10 min before | 1 h before | 24 h before | Opens 1 h before | Opens 24 h before | Searches 1 h before | First message |
|---|---|---|---|---|---|---|---|---|---|---|
| 10-15 14:28 | 10-15 14:56 | throttle (find_jobs.get) | 2 | 44 | 152 | 2721 | 51 | 745 | 100 | find_jobs: {"error_code":"PERMISSION","reason":"This job can't be opened right now. It may |
| 10-15 15:35 | 10-15 23:19 | throttle (find_jobs.get), restricted (find_jobs.search) | 594 | 44 | 195 | 2929 | 58 | 805 | 136 | find_jobs: {"error_code":"PERMISSION","reason":"This job can't be opened right now. It may |
| 10-16 16:19 | 10-17 04:29 | throttle (find_jobs.get) | 289 | 47 | 47 | 1530 | 22 | 553 | 23 | find_jobs: {"error_code":"PERMISSION","reason":"This job can't be opened right now. It may |
| 10-17 05:53 | 10-17 05:53 | throttle (find_jobs.get) | 1 | 46 | 206 | 2869 | 64 | 995 | 141 | find_jobs: {"error_code":"PERMISSION","reason":"This job can't be opened right now. It may |
| 10-17 12:40 | 10-17 12:40 | throttle (find_jobs.get) | 1 | 31 | 203 | 4279 | 60 | 1422 | 142 | find_jobs: {"error_code":"PERMISSION","reason":"This job can't be opened right now. It may |
| 10-17 13:43 | 10-17 21:28 | throttle (find_jobs.get), restricted (find_jobs.search) | 671 | 34 | 209 | 4493 | 59 | 1482 | 141 | find_jobs: {"error_code":"PERMISSION","reason":"This job can't be opened right now. It may |

## What has been safe so far

Days with no throttle or restriction: 2026-10-13, 2026-10-14, 2026-10-18, 2026-10-19.

- Highest daily total on a clean day: 1309 calls.
- Highest job opens on a clean day: 380.
- Highest calls in one hour on a clean day: 174.

