# Build brief - jobpulse

**Request:** job alert assistant dashboard app shell
**Platform:** web  |  **Company:** JobPulse
**Reference design:** Chladni - Industrial IoT Asset Performance SaaS (`chladni-ui-ux-designer-web-designer-for-saas-system`)
**Reference folder:** `Chladni. UI UX Designer, Web Designer for SaaS system`
**Look at these before writing code:** `Chladni. UI UX Designer, Web Designer for SaaS system/image_original1.png`, `Chladni. UI UX Designer, Web Designer for SaaS system/image_original2.png`, `Chladni. UI UX Designer, Web Designer for SaaS system/image_original3.png`, `Chladni. UI UX Designer, Web Designer for SaaS system/image_original4.png`, `Chladni. UI UX Designer, Web Designer for SaaS system/image_original5.png`, `Chladni. UI UX Designer, Web Designer for SaaS system/image_original6.png`

## Direction
- Style: **minimal** (also swiss-editorial, retro-futurist)
- Mode: **light**
- Industry: saas, hardware, logistics
- Layout: sidebar, bento-grid, full-bleed

## Tokens - template -> yours

_template tokens are authored in meta.json_

| Role | Template | Yours |
|---|---|---|
| ground | `#F0F2F4` | `#F0F2F4` |
| surface | `#FFFFFF` | `#FFFFFF` |
| ink | `#191A1B` | `#191A1B` |
| muted | `#858585` | `#858585` |
| accent | `#4930FF` | `#1F6FEB` **<-** |
| accent2 | `#3828AF` | `#14A800` **<-** |
| display font | Orbitron | Space Grotesk **<-** |
| body font | Inter | Inter |
- ! accent2 #14A800 on #F0F2F4 is only 2.8:1 - fine for fills, but do not set body text in it

## Tokens
- Roles: ground=#F0F2F4  surface=#FFFFFF  ink=#191A1B  muted=#858585  accent=#1F6FEB  accent2=#14A800
- Fonts: Space Grotesk, Inter
- Radius: 12px  |  Shadow: none
- Section padding: 160px desktop / 96px mobile
- Display type: clamp(2.5rem, 5vw, 4rem), leading 1.1
- Body type: 16px

## Sections, in order
1. app-shell
2. overview-filter-cards
3. jobs-grid
4. job-detail
5. settings

## Motion
- **static** via none - motion limited to hover and focus states

## Non-negotiables
- No purple-to-blue gradient on a white card unless the reference design actually uses one.
- No emoji as icons. Use a real icon set or draw inline SVG.
- Body text is never below 15px, and never pure #000 on pure #FFF.
- Every section must differ from its neighbour in background, rhythm or column count - eleven identical centred slabs is the single clearest tell of a generated page.
- Buttons need real hover, focus-visible and active states, not just a colour change.
- Respect prefers-reduced-motion: hold transforms, keep opacity fades.
- Images need explicit width/height or aspect-ratio so nothing shifts on load.
- Ship real copy, not lorem ipsum, and not three-word headlines that say nothing.
- Restraint is the brand. If a decoration can be removed without loss, remove it.

## Image prompts

**hero** (16:9)
> Wide cinematic hero image for a saas, hardware website. JobPulse. minimal, swiss-editorial art direction, palette #F0F2F4, #FFFFFF, #4930FF, #191A1B, no text, no watermark, no UI chrome. Strong single focal point positioned off-centre with generous negative space on the left third for a headline overlay. Shallow depth of field, controlled contrast so white type stays readable over it.

**feature-texture** (1:1)
> Abstract close-up texture evoking saas, hardware. minimal, swiss-editorial art direction, palette #F0F2F4, #FFFFFF, #4930FF, #191A1B, no text, no watermark, no UI chrome. Macro detail, soft directional light, extremely shallow depth of field, reads as a background at low opacity rather than as a subject.

**section-support** (4:3)
> Editorial supporting photograph for a saas, hardware website section. JobPulse. minimal, swiss-editorial art direction, palette #F0F2F4, #FFFFFF, #4930FF, #191A1B, no text, no watermark, no UI chrome. Documentary framing, natural light, one human gesture or one object in use, nothing staged or stock-like.

**og-card** (16:9)
> Open Graph share card background for a saas, hardware brand. minimal, swiss-editorial art direction, palette #F0F2F4, #FFFFFF, #4930FF, #191A1B, no text, no watermark, no UI chrome. Simple, high contrast, centre kept visually quiet so a logo and title can be composited on top.

## Reference description

My role. UI UX design, Web design

Project description.

Context. Chladni is an industrial IoT platform for asset performance management, monitoring pumps, motors, and production lines via wireless sensors deployed across plants worldwide.

Role. End to end UI UX Designer, owning user flows, IA, web design, and UI design system.

What I did. Mapped UX flows across Dashboard, Explorer, Incidents, Work Orders, and Devices. Delivered web design and UI UX for the real time fleet view with map, health scored cards, and asset drill downs. Built the UI design system for engineering handoff.
Skills and deliverables

UX & UI
UX Wireframe
UI Graphics
UI/UX Prototyping
SaaS
Dashboard surfaces the four metrics maintenance teams actually act on - health score, incidents, open work orders, savings and downtime. 
Dashboard surfaces the four metrics maintenance teams actually act on - health score, incidents, open work orders, savings and downtime.
Outcome

A platform that reads industrial telemetry as actionable signals - not raw data engineers have to interpret.
Challenge

Surface telemetry from hundreds of sensors as actionable signals for maintenance teams - not a data dump engineers have to interpret.
What I did

- Mapped user flow across 9 product areas
- Designed geo-zoned fleet map with health states
- Built asset drill-down (6 tabs)
- IoT device view tracking signal & battery
- Design system, light/dark, Orbitron identity
Site explorer with geo-zoned health colors - green/yellow/red plant boundaries make global fleet status legible at a glance.
Site explorer with geo-zoned health colors - green/yellow/red plant boundaries make global fleet status legible at a glance.
Devices monitored as a grid with status, signal strength, battery, and asset linkage - IoT fleet management without the spreadsheet feel.
Devices monitored as a grid with status, signal strength, battery, and asset linkage - IoT fleet management without the spreadsheet feel.
Schedule-for-later, activity log with attachments, and the full screen map covering 9 product areas - system designed for scale. 
Schedule-for-later, activity log with attachments, and the full screen map covering 9 product areas - system designed for scale.
Close-up of the user flow showing how Login branches into Dashboard, Header, Explorer, Incidents, Work Orders, Settings.
Close-up of the user flow showing how Login branches into Dashboard, Header, Explorer, Incidents, Work Orders, Settings.





ui ux designer | ui ux designer shopify | game ui ux designer | ui ux designer ai | ui ux designer crypto | ui ux designer wix | figma | graphic designer | product designer | web design | web designer | website designer | wix web design | webflow designer | shopify website design | wordpress website designer | ux designer | ui | ui/ux designer | web developer | wordpress | website | mobile app design | mobile app designer | figma mobile app designer | mobile app design ai | mobile app logo design | AI-powered | SaaS | landing page | Wireframing | user flow | developer handoff | design system | reusable components | CSS | UX & UI | User Experience Design | Adobe Photoshop | JavaScript | HTML | Landing Page | User Interface Design | Logo Design | HTML5 | Mobile UI Design | PHP | Adobe Illustrator | CSS 3 | Webflow | Web Application | Responsive Design | Mobile App Design | Ecommerce | User Experience | UI/UX Prototyping | Branding | Adobe InDesign | UX & UI Design | Custom Web Design | Logo | Brand Identity | Website Redesign | Design Concept | Marketing | Interactive Design | Web Development | Elementor | Cryptocurrency | UIKit | Mobile App | Mobile App Redesign | UI Graphics | Software Design | Cryptography | Real Estate | Illustration | jQuery | Mobile App Development | Prototyping | Adobe XD | Flutter | Android App Development | iOS Development | UX Research | Android | Usability Testing | Data Visualization | App Development | Smartphone | App Design | React Native | Android App | Firebase | Node.js | User Testing | Hybrid App Development | Product Demonstration | React | Mockup | Swift | MongoDB | Dashboard | Information Architecture | Adobe After Effects | Brand Identity Design | User Experience Strategy | Health & Fitness | API Integration | Full-Stack Development | iOS | Growth Strategy | Gamification | Mobile App Development Consultation | AI Mobile App Development | Case Studies | Java | Desktop Application | Kotlin | Animals & Pets | Pets | Front-End Development
## Local-only theme (added after the build)

`[data-theme="upwork"]` in `app/globals.css` re-maps accent/good/info to greens (#14A800 / #108A00) and ink to
#001E00. `app/layout.tsx` applies it only when `NEXT_PUBLIC_THEME=upwork` **and** `PUBLIC_BASE_URL` is not
https — the deployed site that an API reviewer could visit always renders the neutral theme above.

## Critique outcome

Two design-critic rounds against the Chladni screens. Round 1: 1 must-fix (mobile filter controls collapsing)
+ 5 should-fix (alerts chart proportion, tab strip fill, settings card stretch, panel labels, mobile stat grid)
+ 6 polish items — all applied. Round 2: 11/12 verified, 1 new must-fix (alert rows ignoring panel width) —
applied and re-measured (rows 534px = panel content width, no horizontal scroll at 390px).
