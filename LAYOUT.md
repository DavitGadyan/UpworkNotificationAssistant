# Layout inventory - Chladni -> JobPulse

Read from `design-reference/image_original1-8.png`. The screenshots are 2x (3200px wide), so
measured values below are halved to CSS px.

## Template tokens (read off the images)

| | Template (from the image) | Yours |
|---|---|---|
| mode | light, monochrome with status colours | light |
| ground | #EDEDED page / #F0F2F4 light gray | #F0F2F4 |
| surface | #FFFFFF app frame and cards | #FFFFFF |
| ink | #191A1B | #191A1B |
| accent | #4930FF blue (unread dot, "Linked"/"Unassigned" pill) | #1F6FEB (neutral) / #14A800 (`data-theme="upwork"`, local only) |
| accent2 | #3828AF | #14A800 / #108A00 |
| status | green #22C55E, amber #C9A24A, red #E5484D, all on 10% tint pills | same roles, tokens `--color-good/warn/bad/info` |
| display font | Orbitron (uppercase page titles, card titles, big %) | Space Grotesk (uppercase titles kept) |
| body font | Inter | Inter |
| corner radius | cards ~20px, buttons ~12px, pills ~6px, rail is a full capsule | 20 / 12 / 6 / 999 |
| nav pattern | floating vertical icon rail (capsule, soft shadow), active item = white circle; avatar at the bottom; top bar with "/" search pill, black square "+" button and a bell with a blue dot | same |
| card style | white, 1px #E6E8EB border, no shadow; inner rows split by 1px dividers | same |

## Screens

### Screen 1 - Explorer with map (image 1, viewport)
| # | Region | Component | Contents | Layout | States |
|---|---|---|---|---|---|
| 1 | Top bar | search pill + actions | "Search  /" pill (~360px), black "+" 50px square r12, bell with dot | full width, 64px tall, bottom hairline | focus on search |
| 2 | Left | icon rail | 8 icons + avatar, active = white circle 70px | fixed, ~70px wide capsule, vertically after the header | hover |
| 3 | Page head | title + subtitle + actions | "EXPLORER" ~40px uppercase display, muted subtitle 16px; right: Filter, Export Report (gray r12 buttons with icon), List/Map segmented control | flex space-between | segmented active = white |
| 4 | Body | full-bleed map panel + floating card | status pill "Active", location + flag, title, timestamp, big 82% in green + sparkline, 2x3 stats grid with label/value, "View Details" gray full-width button | map rounded 20px; card ~370px at bottom-right | — |

### Screen 2/3 - Line card + Asset drill-down + rail (images 2, 3; full page)
| # | Region | Component | Contents | Layout | States |
|---|---|---|---|---|---|
| 1 | Left | nested line card | title "Mixing Line B" + "1/1 WO" right, "UPD: date", big red 24% + area chart, row "Assets: 1 / Incidents: 7" with dividers, gray inner panel "Assets:" with a child card (icon tile, "High", "#inc-232", title, meta "Inspections / Tue, 9 sep", "To do" pill), "^ View Less" toggle | single card ~320px wide | collapsible |
| 2 | Right | drill-down page | breadcrumb (globe / Explorer / Berlin Plant / PUMP#7), title "PUMP#7" + green "Health: 82%" pill, two summary cards (icon tile, code, signal pill / battery) side by side, tab strip (6 tabs with icons, active = white chip on gray track), 2-col grid of status cards (CRITICAL tag, status text right, title, timestamp, divider, icon tile + "Last incident" + "#inc-234") | 2-col | tab active |
| 3 | Bottom | rail close-up | capsule with icons and divider before the secondary group | — | active circle |

### Screen 4 - Devices grid (image 4, viewport)
| # | Region | Component | Contents | Layout | States |
|---|---|---|---|---|---|
| 1 | Header + rail | as screen 1 | | | |
| 2 | Page head | "DEVICES" + subtitle; Filter + Export Report | | space-between | |
| 3 | Grid | 15 device cards | pill (Online/Unassigned/Battery low/Offline), "2h Ago", "..." menu; bold code + muted type ("#DC-1234 Puck"); meta row with icon + value separated by "/" | 3 cols, ~16px gap, card ~150px tall, r20 | hover border |
| 4 | Footer | pagination | prev (gray square), 1 (black active), 2, 3, next | centered | |

### Screen 5 - User flow (image 5)
The IA map: Login → Dashboard, Header (Search, Notifications, Profile), Explorer, Incidents, Work Orders, Settings (Users, Sites, Billing, Integrations). It's a sitemap, not a screen to build. JobPulse IA: Overview, Jobs → Job detail, Searches, Alerts, Settings.

### Screen 6 - Explorer list view (image 6)
| # | Region | Component | Contents | Layout | States |
|---|---|---|---|---|---|
| 1 | Filter bar | 3 dropdown buttons | icon + "Site: All" + chevron; "Location: All"; "Status: All" | row of equal-width white bordered r14 controls | open |
| 2 | Grid | site cards | status pill (Active/Disabled), location + flag right, title, timestamp, big % (green/red) + sparkline right, 2x3 stats grid | 2 cols | |

### Screen 7 - Tokens (image 7): palette #191A1B #858585 #F0F2F4 #FFFFFF #4930FF; Orbitron.
### Screen 8 - Portfolio CTA banner. It belongs to the designer's portfolio, not the product, so it isn't built.

## Section plan → routes
1. **App shell** (`components/shell/*`): rail + top bar, wraps every route. Screens 1-4.
2. **Overview** `/`: page head + filter bar (screen 6) + saved-search cards with % and sparkline + 2x3 stats (screen 6/1 card), plus a worker/connection status strip.
3. **Jobs** `/jobs`: page head + 3-col job cards + pagination (screen 4).
4. **Job detail** `/jobs/[id]`: breadcrumb, title + score pill, two summary cards, tab strip, 2-col card grid (screen 2 right).
5. **Alerts** `/alerts`: nested line cards per channel with a collapsible child list (screen 2 left).
6. **Searches** `/searches`: list of search cards (device-card anatomy) + editor drawer.
7. **Settings** `/settings`: bordered cards in a 2-col grid; the segmented control reuses the List/Map toggle anatomy.
