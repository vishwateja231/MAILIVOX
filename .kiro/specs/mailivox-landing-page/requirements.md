# Requirements Document

## Introduction

This feature adds a public, premium-grade marketing landing page for **Mailivox** — an AI-powered Outreach Intelligence Infrastructure platform — at the root route `/` of the existing Vite + React 19 + react-router-dom 7 frontend. The landing page must feel like a developer-tool / infrastructure-platform site (Linear, Resend, Railway, Supabase, Vercel) rather than a generic AI SaaS site, and must visually align with the existing dashboard's design system (colors, glass surfaces, gradient logo, Inter typography, animated blob background).

The Landing_Page is rendered ONLY for unauthenticated visitors. Authenticated users continue to be redirected from `/` to `/dashboard` exactly as today. All existing dashboard pages, routes, layouts, authentication flow, backend services, APIs, database, and the Chrome extension remain entirely untouched.

All "real-time" telemetry, terminal logs, network graphs, and pipeline visualizations on the landing page are simulated client-side; no backend calls or API contracts are added or modified.

## Glossary

- **Landing_Page**: The new public marketing page component at `frontend/src/pages/landing/LandingPage.jsx` rendered at route `/` for unauthenticated users.
- **Landing_Section**: A modular component under `frontend/src/components/landing/*.jsx` representing one scroll section of the Landing_Page (Navbar, Hero, WhyMailivox, IntelligenceEngine, SMTPSection, CompanyIntelligence, ExtensionSection, DeploymentSection, ArchitectureMap, BuiltFor, FeatureDeepDive, GitHubCTA, Footer).
- **Landing_Navbar**: The sticky top navigation Landing_Section containing the Mailivox wordmark, anchor links, and the Login button.
- **Hero_Section**: The first viewport Landing_Section containing the headline, technical subheadline, primary/secondary CTAs, and the animated infrastructure node-graph visualization.
- **Pipeline_Visualization**: The animated SVG node graph in the Hero_Section depicting the flow LinkedIn → Lead Intelligence → Domain Discovery → Email Generation → SMTP Verification → AI Outreach → Delivery Tracking with moving data packets and glowing nodes.
- **SMTP_Terminal**: The terminal-style panel in the SMTPSection that renders simulated SMTP handshake logs, MX lookup output, catch-all detection, provider intelligence, and confidence scoring.
- **Intelligence_Pipeline**: The animated horizontal pipeline in the IntelligenceEngine Landing_Section visualizing the stages parse → filter → enrich → generate → validate → outreach.
- **Company_Network_Graph**: The animated network graph in the CompanyIntelligence Landing_Section visualizing adaptive learning, bounce intelligence, pattern confidence, and company health scores.
- **Architecture_Diagram**: The cinematic systems diagram in the ArchitectureMap Landing_Section depicting Frontend, Backend, SMTP Engine, Resend, Google Sheets, PostgreSQL, Chrome Extension, Webhook Engine, AI Layer, and Validation Pipeline as connected nodes.
- **Design_Token_Set**: The existing Tailwind theme colors (`background #0F172A`, `surface #1E293B`, `primary #38BDF8`, `success #10B981`, `danger #EF4444`, `warning #F59E0B`) and the CSS custom properties defined in `frontend/src/index.css` (`--bg-primary`, `--bg-secondary`, `--text-primary`, `--text-secondary`, `--text-muted`, `--border-soft`, `--border-hover`, `--accent-blue`).
- **Shared_Component_Classes**: The pre-existing utility classes `.glass`, `.glass-card`, `.glass-panel`, `.input-glowing`, `.btn-primary`, `.btn-secondary`, `.badge`, `.bg-grid-pattern` defined in `frontend/src/index.css`.
- **Animated_Background**: The visual background pattern matching `App.jsx`'s `Background()` component — a `.bg-grid-pattern` overlay plus three blurred glowing blobs in `bg-primary/20`, `bg-indigo-500/20`, and `bg-violet-600/20` using the existing `animate-blob`, `animation-delay-2000`, and `animation-delay-4000` utilities.
- **Mailivox_Wordmark**: The brand wordmark composed of "MAILI" in white followed by "VOX" in `text-primary`, paired with a square logo tile using `bg-gradient-to-br from-primary to-indigo-500` and `shadow-[0_0_15px_rgba(56,189,248,0.4)]` containing the lucide-react `Send` icon.
- **Auth_Gate**: The existing logic in `frontend/src/App.jsx` that branches between `LoginPage` (when `user` is `null`) and `AppShell` (when `user` is set), backed by the `mailivox_user` localStorage entry.
- **Reduced_Motion_Mode**: The browser-reported preference `prefers-reduced-motion: reduce` indicating the visitor wants minimal animation.
- **GitHub_URL**: The placeholder constant resolved from `import.meta.env.VITE_GITHUB_URL` (or a hardcoded fallback string `"#"` / `"TBD"` when the env variable is not set) used as the `href` for all GitHub links on the Landing_Page.
- **Docs_URL**: The placeholder constant resolved from `import.meta.env.VITE_DOCS_URL` (or fallback `/docs`) used as the `href` for all Docs links on the Landing_Page.
- **Auth_Module**: The client-side authentication logic in `frontend/src/App.jsx` and `frontend/src/utils/auth.js` responsible for reading, decoding, and validating the JWT token stored in `localStorage`, and determining whether the user session should be restored or cleared.
- **JWT_Token**: The JSON Web Token issued by the backend's `/api/auth/login` endpoint, stored in `localStorage` under the key `mailivox_token`, containing at minimum an `exp` (expiration) claim in its payload.

## Requirements

### Requirement 1: Public Routing Integration

**User Story:** As an unauthenticated visitor, I want to land on the Mailivox marketing page when I visit the site root, so that I can learn about the product before signing in.

#### Acceptance Criteria

1. WHILE the Auth_Gate reports the visitor is unauthenticated, THE Landing_Page SHALL render at route `/`.
2. WHILE the Auth_Gate reports the visitor is authenticated, THE App SHALL redirect route `/` to `/dashboard` using the existing `Navigate` redirect behavior.
3. WHEN an unauthenticated visitor activates any element labeled "Login" on the Landing_Page, THE App SHALL render the existing `LoginPage` component (either by navigating to `/login` or by rendering the existing unauthenticated LoginPage flow already present in `App.jsx`).
4. THE Landing_Page SHALL be registered as a React Router route inside the existing `BrowserRouter` in `frontend/src/App.jsx` without removing or altering any existing route definition for `/dashboard`, `/analytics`, `/engine`, `/outreach`, `/import`, `/leads`, `/companies`, `/sessions`, `/sheets`, or `/settings`.
5. IF the visitor is unauthenticated AND requests a path other than `/` and `/login`, THEN THE App SHALL preserve the existing unauthenticated behavior of rendering `LoginPage` (no new redirect logic is introduced for protected routes).

### Requirement 2: No-Touch Boundary Around Existing Systems

**User Story:** As the maintainer of the existing dashboard, I want the landing page implementation to be fully isolated, so that no existing functionality regresses.

#### Acceptance Criteria

1. THE Landing_Page implementation SHALL place its page entry at `frontend/src/pages/landing/LandingPage.jsx`.
2. THE Landing_Page implementation SHALL place all section components at `frontend/src/components/landing/*.jsx`.
3. THE Landing_Page implementation SHALL NOT modify any file under `frontend/src/pages/` other than creating new files inside `frontend/src/pages/landing/`.
4. THE Landing_Page implementation SHALL NOT modify any file under `backend/`, `extension/`, `frontend/src/api*`, or any database schema.
5. THE Landing_Page implementation SHALL NOT modify `frontend/tailwind.config.js`, `frontend/postcss.config.js`, or `frontend/src/index.css` except to add new CSS only if strictly necessary for landing-only animations, and any such additions SHALL be scoped under selectors that do not affect existing dashboard markup.
6. THE Landing_Page implementation SHALL NOT issue HTTP requests to the backend, SHALL NOT read or write authentication tokens, AND SHALL NOT read or write `mailivox_user` or `mailivox_token` in localStorage.
7. THE only edit permitted to `frontend/src/App.jsx` SHALL be the addition of the public `/` route for the Landing_Page in the unauthenticated branch and any related import statement; no other behavior in `App.jsx` SHALL change.

### Requirement 3: Dependency Constraints

**User Story:** As the maintainer of the project, I want the landing page to use only already-installed libraries, so that the bundle stays lean and the existing tech stack is preserved.

#### Acceptance Criteria

1. THE Landing_Page SHALL use only the following runtime dependencies already declared in `frontend/package.json`: `react`, `react-dom`, `react-router-dom`, `framer-motion`, `lucide-react`, `clsx`, `tailwind-merge`, `sonner`, `recharts`.
2. THE Landing_Page SHALL NOT introduce Next.js, shadcn/ui, GSAP, React Three Fiber, three.js, `@radix-ui/*`, or any new runtime dependency.
3. THE Landing_Page SHALL NOT introduce any new devDependency to `frontend/package.json`.
4. THE Landing_Page SHALL build successfully with the existing Vite 6 + React 19 toolchain (`npm run build` in `frontend/`).

### Requirement 4: Sticky Navbar

**User Story:** As a visitor, I want a persistent navigation bar with anchor links and a login action, so that I can jump to any section and sign in quickly.

#### Acceptance Criteria

1. THE Landing_Navbar SHALL remain visible at the top of the viewport while the visitor scrolls the Landing_Page (sticky/fixed positioning).
2. THE Landing_Navbar SHALL display the Mailivox_Wordmark on the left side.
3. THE Landing_Navbar SHALL display anchor links labeled "Features", "Infrastructure", "Validation Engine", "Self Host", "Docs", and "GitHub".
4. WHEN the visitor activates the "Features" link, THE Landing_Page SHALL smooth-scroll to the FeatureDeepDive Landing_Section.
5. WHEN the visitor activates the "Infrastructure" link, THE Landing_Page SHALL smooth-scroll to the ArchitectureMap Landing_Section.
6. WHEN the visitor activates the "Validation Engine" link, THE Landing_Page SHALL smooth-scroll to the SMTPSection Landing_Section.
7. WHEN the visitor activates the "Self Host" link, THE Landing_Page SHALL smooth-scroll to the DeploymentSection Landing_Section.
8. WHEN the visitor activates the "Docs" link, THE Landing_Navbar SHALL navigate the browser to Docs_URL.
9. WHEN the visitor activates the "GitHub" link, THE Landing_Navbar SHALL navigate the browser to GitHub_URL in a new tab with `rel="noopener noreferrer"`.
10. THE Landing_Navbar SHALL display a "Login" button styled with the gradient `bg-gradient-to-r from-primary to-indigo-500`.
11. WHEN the visitor activates the "Login" button, THE App SHALL render the existing `LoginPage` flow (per Requirement 1.3).
12. WHILE the visitor has scrolled more than 16 pixels from the top of the Landing_Page, THE Landing_Navbar SHALL apply a glass background using the `.glass` Shared_Component_Class (or an equivalent `bg-surface/30 backdrop-blur-xl border-b border-white/5` composition).

### Requirement 5: Hero Section

**User Story:** As a visitor, I want a cinematic hero with infrastructure visualization and clear CTAs, so that I immediately grasp Mailivox is a developer-grade outreach platform.

#### Acceptance Criteria

1. THE Hero_Section SHALL display a primary headline using `tracking-tight` typography and an eyebrow label using `uppercase tracking-wider` typography.
2. THE Hero_Section SHALL display a technical subheadline composed in plain prose with no marketing superlatives such as "best", "amazing", or "revolutionary".
3. THE Hero_Section SHALL display a primary CTA button labeled "Deploy Your Own Infrastructure" styled with the existing `.btn-primary` Shared_Component_Class.
4. THE Hero_Section SHALL display a secondary CTA button labeled "Read Docs" styled with the existing `.btn-secondary` Shared_Component_Class that navigates to Docs_URL when activated.
5. THE Hero_Section SHALL display a tertiary CTA labeled "Login" that triggers the same behavior as the Landing_Navbar Login button (per Requirement 4.11).
6. THE Hero_Section SHALL render a Pipeline_Visualization as an animated SVG node graph containing the labeled nodes "LinkedIn", "Lead Intelligence", "Domain Discovery", "Email Generation", "SMTP Verification", "AI Outreach", and "Delivery Tracking" connected by directional edges.
7. THE Pipeline_Visualization SHALL animate at least one moving data packet along each connecting edge using either CSS transforms or framer-motion.
8. THE Pipeline_Visualization SHALL render at least one glowing/pulsing visual treatment on each labeled node using a box-shadow or filter effect tinted with the `--accent-blue` Design_Token_Set value.
9. THE Hero_Section SHALL render a scrolling telemetry feed listing simulated lines such as event types, timestamps, and status indicators, with content generated entirely client-side from a static or pseudo-randomized array.
10. THE Hero_Section SHALL render a queue metrics card displaying at least three labeled metrics (for example "Queued", "Verified", "Bounced") with values that animate or refresh via client-side state, with no backend call.
11. WHERE the visitor's pointer hovers over the Hero_Section, THE Hero_Section MAY apply a subtle pointer-tracked glow effect implemented purely with CSS transforms and `requestAnimationFrame`, and SHALL NOT cause layout reflow.
12. IF Reduced_Motion_Mode is active, THEN THE Hero_Section SHALL freeze all moving data packets, scrolling telemetry, and metric refresh animations to a static state.

### Requirement 6: Why Mailivox Exists Section

**User Story:** As a visitor, I want a problem-statement section, so that I understand the gap Mailivox fills before seeing features.

#### Acceptance Criteria

1. THE WhyMailivox Landing_Section SHALL render a section heading and a short prose summary of the problem space.
2. THE WhyMailivox Landing_Section SHALL render at least five labeled problem tiles covering the topics "invalid emails", "bouncy systems", "spam tools", "fragmented workflows", and "no infra ownership".
3. Each problem tile SHALL include a lucide-react icon, a tile heading, and a one-or-two-sentence description.
4. Each problem tile SHALL use the `.glass-card` Shared_Component_Class as its visual container.

### Requirement 7: Intelligence Engine Section

**User Story:** As a visitor, I want to see how Mailivox orchestrates outreach in real time, so that I trust the platform is intelligent and well-engineered.

#### Acceptance Criteria

1. THE IntelligenceEngine Landing_Section SHALL render an Intelligence_Pipeline with the labeled stages "LinkedIn", "parse", "filter", "enrich", "generate", "validate", and "outreach" in left-to-right order.
2. THE Intelligence_Pipeline SHALL animate a token, dot, or pulse moving sequentially through every stage using framer-motion or CSS transforms.
3. THE IntelligenceEngine Landing_Section SHALL render a side panel displaying simulated stage details (for example current stage name, items processed, success rate) sourced from client-side state only.
4. IF Reduced_Motion_Mode is active, THEN THE Intelligence_Pipeline SHALL display the pipeline in a static state with no moving token.

### Requirement 8: SMTP Verification Engine Section

**User Story:** As a technical visitor, I want to see a live-feeling SMTP terminal, so that I believe Mailivox truly verifies emails at the protocol level.

#### Acceptance Criteria

1. THE SMTPSection Landing_Section SHALL render an SMTP_Terminal styled as a monospace terminal panel using the `.glass-panel` Shared_Component_Class with monospace font (e.g., `font-mono`).
2. THE SMTP_Terminal SHALL display simulated log lines covering at minimum: an MX lookup, an SMTP handshake (HELO/EHLO + RCPT TO + response code), a catch-all detection result, a provider identification line, and a confidence score line.
3. THE SMTP_Terminal SHALL append new simulated log lines on a recurring client-side interval, and SHALL cap the total visible lines so the terminal does not grow unbounded.
4. THE SMTP_Terminal SHALL color-code log lines so success codes use the existing `success` color token, error codes use the `danger` color token, and informational lines use the `--text-secondary` value.
5. IF Reduced_Motion_Mode is active, THEN THE SMTP_Terminal SHALL render a static, fully-populated terminal with no append interval.
6. WHEN the SMTPSection Landing_Section is unmounted or scrolled off screen, THE SMTP_Terminal SHALL clear any active interval timers.

### Requirement 9: Company Pattern Intelligence Section

**User Story:** As a visitor, I want to see how Mailivox learns company-level email patterns, so that I understand the adaptive intelligence layer.

#### Acceptance Criteria

1. THE CompanyIntelligence Landing_Section SHALL render a Company_Network_Graph visualizing at least one central company node connected to at least four pattern nodes (for example "first.last@", "f.last@", "first@", "flast@") via SVG paths.
2. THE Company_Network_Graph SHALL display a labeled confidence percentage on each pattern node and a labeled health score on the central company node.
3. THE Company_Network_Graph SHALL animate edge or node opacity, stroke, or pulse to convey adaptive learning, using framer-motion or CSS keyframes.
4. THE CompanyIntelligence Landing_Section SHALL include a brief textual explanation of bounce intelligence and pattern confidence beside or below the Company_Network_Graph.
5. IF Reduced_Motion_Mode is active, THEN THE Company_Network_Graph SHALL render its final/static visual state with no animation.

### Requirement 10: Chrome Extension Section

**User Story:** As a visitor, I want to see the Chrome extension in context, so that I understand how data is captured from LinkedIn.

#### Acceptance Criteria

1. THE ExtensionSection Landing_Section SHALL render a stylized browser-window mockup with a faux URL bar, traffic-light dots, and a content area depicting a LinkedIn-like layout.
2. THE ExtensionSection Landing_Section SHALL render a floating overlay positioned over the browser-window mockup that displays simulated extraction telemetry (for example "Profiles parsed", "Names extracted", "Companies detected").
3. THE ExtensionSection Landing_Section SHALL render the Mailivox_Wordmark or its compact logo tile inside the floating overlay header.
4. THE telemetry values inside the floating overlay SHALL be sourced from client-side state only and SHALL NOT issue any network request.

### Requirement 11: Self Host In Minutes Section

**User Story:** As a developer-minded visitor, I want to see a deployment terminal and architecture map, so that I'm convinced I can self-host Mailivox quickly.

#### Acceptance Criteria

1. THE DeploymentSection Landing_Section SHALL render a terminal-style panel that types or reveals the simulated commands `git clone`, `docker compose up`, and an `.env` configuration step in sequence.
2. THE DeploymentSection Landing_Section SHALL render a visual deployment architecture map showing at least the nodes "Source", "Container", "Database", and "Public URL" connected by directional edges.
3. THE DeploymentSection Landing_Section SHALL display a CTA linking to GitHub_URL using the `.btn-primary` style.
4. IF Reduced_Motion_Mode is active, THEN THE DeploymentSection Landing_Section SHALL render the terminal panel in its fully-typed final state with no typing animation.

### Requirement 12: Architecture Map Section

**User Story:** As a technical visitor, I want a cinematic systems diagram, so that I understand how Mailivox's components connect end-to-end.

#### Acceptance Criteria

1. THE ArchitectureMap Landing_Section SHALL render an Architecture_Diagram containing the labeled nodes "Frontend", "Backend", "SMTP Engine", "Resend", "Google Sheets", "PostgreSQL", "Chrome Extension", "Webhook Engine", "AI Layer", and "Validation Pipeline".
2. THE Architecture_Diagram SHALL render directional connections between logically related nodes (for example Frontend ↔ Backend, Backend ↔ PostgreSQL, Backend ↔ SMTP Engine, Backend ↔ Resend, Backend ↔ Google Sheets, Chrome Extension ↔ Backend, AI Layer ↔ Backend, Validation Pipeline ↔ SMTP Engine, Webhook Engine ↔ Backend).
3. THE Architecture_Diagram SHALL apply a glow or pulse effect to active edges using `--accent-blue` tinting.
4. WHEN the visitor hovers a node in the Architecture_Diagram, THE node SHALL display a tooltip or expanded label describing that node in one or two sentences.
5. THE Architecture_Diagram SHALL be rendered with SVG, framer-motion, or CSS only — no canvas, three.js, or WebGL.

### Requirement 13: Built For Section

**User Story:** As a visitor in a specific role, I want to see whether Mailivox is built for my use case, so that I can self-identify and explore further.

#### Acceptance Criteria

1. THE BuiltFor Landing_Section SHALL render an asymmetric grid of audience cards covering the audiences "Recruiters", "Growth Teams", "Founders", "Agencies", "Job Seekers", and "Outbound Teams".
2. Each audience card SHALL display a lucide-react icon, an audience label, and a one-or-two-sentence description.
3. WHEN the visitor hovers an audience card, THE card SHALL apply a visible interactive treatment (for example border glow, scale 1.02, or content reveal).
4. THE BuiltFor Landing_Section SHALL use a non-uniform / asymmetric layout (for example mixed `col-span` values) so cards are not all identical in size.

### Requirement 14: Feature Deep Dive Section

**User Story:** As a technical visitor, I want expandable infrastructure-style feature blocks, so that I can drill into details without being overwhelmed by generic feature cards.

#### Acceptance Criteria

1. THE FeatureDeepDive Landing_Section SHALL render at least five expandable infrastructure feature blocks (for example "Lead Intelligence", "Domain Discovery", "AI Email Generation", "SMTP Validation", "Outreach Orchestration").
2. WHEN the visitor activates a feature block header, THE feature block SHALL toggle between collapsed and expanded states using framer-motion height/opacity transitions.
3. WHEN a feature block is expanded, THE feature block SHALL display a description, a list of capabilities, and an optional code snippet or schematic.
4. THE FeatureDeepDive Landing_Section SHALL allow either single-open or multi-open expansion behavior (the design document chooses one), and SHALL keep the chosen behavior consistent across all blocks.
5. THE feature blocks SHALL NOT use generic three-up icon-and-paragraph card layouts.

### Requirement 15: GitHub + Docs CTA Section

**User Story:** As a developer-minded visitor, I want a clear developer-tool style CTA pointing me to GitHub and Docs, so that I can immediately explore the source and documentation.

#### Acceptance Criteria

1. THE GitHubCTA Landing_Section SHALL render a primary CTA linking to GitHub_URL using the `.btn-primary` Shared_Component_Class.
2. THE GitHubCTA Landing_Section SHALL render a secondary CTA linking to Docs_URL using the `.btn-secondary` Shared_Component_Class.
3. THE GitHubCTA Landing_Section SHALL include the lucide-react `Github` icon adjacent to the GitHub CTA label.
4. THE GitHubCTA Landing_Section SHALL include a developer-tool-style code or terminal accent (for example a snippet block or a stylized command line) above or beside the CTAs.

### Requirement 16: Footer

**User Story:** As a visitor, I want a minimal footer with key links, so that I can find the GitHub repo, Docs, and brand at the end of the page.

#### Acceptance Criteria

1. THE Footer Landing_Section SHALL render the Mailivox_Wordmark.
2. THE Footer Landing_Section SHALL render link groups for at minimum "Product" (anchor links to Landing_Sections), "Resources" (Docs_URL, GitHub_URL), and "Legal" (placeholder routes for privacy and terms).
3. THE Footer Landing_Section SHALL render a copyright line containing the current calendar year computed at build/render time and the literal text "Mailivox".
4. THE Footer Landing_Section SHALL use minimal visual styling consistent with `--text-muted` and `--border-soft` from the Design_Token_Set.

### Requirement 17: Design Token and Style Reuse

**User Story:** As a brand-conscious user, I want the landing page to feel like part of the same product as the dashboard, so that the brand reads as consistent and premium.

#### Acceptance Criteria

1. THE Landing_Page SHALL render its color palette using only the Design_Token_Set values (Tailwind theme colors and CSS custom properties from `index.css`); ad-hoc hex values not present in the Design_Token_Set SHALL NOT be introduced.
2. THE Landing_Page SHALL display the Mailivox_Wordmark exactly per its Glossary definition (white "MAILI" + `text-primary` "VOX" + gradient `Send` icon tile with `bg-gradient-to-br from-primary to-indigo-500` and `shadow-[0_0_15px_rgba(56,189,248,0.4)]`).
3. THE Landing_Page SHALL render the Animated_Background per its Glossary definition (`.bg-grid-pattern` plus three `animate-blob` blurred blobs in `bg-primary/20`, `bg-indigo-500/20`, and `bg-violet-600/20` using `animation-delay-2000` and `animation-delay-4000`).
4. THE Landing_Page SHALL apply the `Inter` font family inherited from the existing `body` styles.
5. THE Landing_Page SHALL apply `tracking-wide` to navigation text, `tracking-tight` to primary headlines, and `uppercase tracking-wider` to eyebrow labels.
6. THE Landing_Page SHALL reuse the Shared_Component_Classes (`.glass`, `.glass-card`, `.glass-panel`, `.input-glowing`, `.btn-primary`, `.btn-secondary`, `.badge`, `.bg-grid-pattern`) for any element matching their semantic roles instead of duplicating their styles inline.
7. THE Landing_Page primary gradient buttons SHALL use the `bg-gradient-to-r from-primary to-indigo-500` gradient consistent with `LoginPage.jsx`.

### Requirement 18: Responsive Behavior

**User Story:** As a visitor on any device, I want the landing page to be fully usable, so that I can read and explore Mailivox on mobile, tablet, and desktop.

#### Acceptance Criteria

1. THE Landing_Page SHALL render legibly without horizontal scrolling on viewport widths of 360px, 768px, 1024px, and 1440px.
2. WHILE the viewport width is below 768px, THE Landing_Navbar SHALL collapse its anchor links into a mobile menu (drawer or dropdown) toggled by a menu button, while keeping the Mailivox_Wordmark and Login button visible.
3. WHILE the viewport width is below 768px, THE Hero_Section SHALL stack the Pipeline_Visualization below or above the textual content rather than placing them side-by-side.
4. WHILE the viewport width is below 768px, multi-column grids in the WhyMailivox, BuiltFor, and FeatureDeepDive Landing_Sections SHALL collapse to a single column.
5. THE Landing_Page SHALL apply `overflow-x-hidden` at the page-root level so animated elements do not introduce horizontal scrolling.

### Requirement 19: Accessibility

**User Story:** As a visitor using assistive technology or keyboard navigation, I want the landing page to be accessible, so that I can use it without a mouse or with a screen reader.

#### Acceptance Criteria

1. THE Landing_Page SHALL use semantic HTML landmarks: `<header>` for the Landing_Navbar, `<main>` for the page body, `<section>` for each Landing_Section, and `<footer>` for the Footer.
2. Each Landing_Section SHALL include exactly one heading element of level `<h2>` (or appropriate level) describing the section.
3. THE Landing_Page SHALL provide a visible focus ring on every interactive element (links, buttons, expandable feature blocks, mobile menu toggle) using a focus style tinted with `--accent-blue` (for example `focus-visible:ring-2 focus-visible:ring-primary/50`).
4. Every interactive element SHALL be reachable and operable using the keyboard alone (Tab/Shift-Tab to focus, Enter/Space to activate).
5. Decorative SVG elements (Pipeline_Visualization edges, Architecture_Diagram glows, Company_Network_Graph particles) SHALL include `aria-hidden="true"` so they are not announced by screen readers.
6. Informational SVG elements that convey content (for example labeled architecture nodes) SHALL include accessible labels via `<title>` elements or `aria-label` attributes.
7. External links to GitHub_URL SHALL include `rel="noopener noreferrer"` and `target="_blank"`, and SHALL include accessible link text such as "View Mailivox on GitHub" rather than only an icon.
8. Color contrast for all text on the Landing_Page SHALL meet WCAG 2.1 AA (4.5:1 for body text, 3:1 for large text) when measured against the rendered background, using only Design_Token_Set values.

### Requirement 20: Animation Behavior and Reduced Motion

**User Story:** As a visitor sensitive to motion, I want animations to respect my system preference, so that I can browse the landing page without distraction or discomfort.

#### Acceptance Criteria

1. THE Landing_Page SHALL implement all decorative animations using CSS transforms, CSS keyframes, framer-motion, or `requestAnimationFrame` only, with no use of `setInterval`-driven layout-property animation (e.g., animating `width`, `height`, `top`, `left`).
2. IF Reduced_Motion_Mode is active, THEN THE Landing_Page SHALL render every Landing_Section in a static visual state with no looping motion (Pipeline_Visualization packets, telemetry feed scrolling, SMTP_Terminal append, Intelligence_Pipeline token, Company_Network_Graph pulses, animated background blobs, deployment-terminal typing).
3. THE Landing_Page SHALL detect Reduced_Motion_Mode using `window.matchMedia('(prefers-reduced-motion: reduce)')` once at mount and SHALL react to changes via the matchMedia change event.
4. WHEN any animated Landing_Section is unmounted, THE Landing_Section SHALL clean up any timers, intervals, animation frames, or framer-motion controls it created.

### Requirement 21: Performance Budgets

**User Story:** As a visitor on a typical broadband connection, I want the landing page to load and run smoothly, so that the premium feel is matched by premium performance.

#### Acceptance Criteria

1. THE Landing_Page chunk produced by `vite build` SHALL be lazy-loaded via `React.lazy` so that the chunk is not included in the dashboard's initial bundle for authenticated users.
2. THE Landing_Page SHALL NOT increase the gzipped initial JavaScript payload of the existing dashboard route by more than 10 KB.
3. THE Landing_Page SHALL maintain at least 50 frames per second for all hero, pipeline, network, and terminal animations on a current-generation desktop browser at 1440x900 viewport, measured with no devtools throttling.
4. THE Landing_Page SHALL NOT load or embed any external font file beyond the `Inter` family already declared in the existing styles.
5. THE Landing_Page SHALL NOT load any image asset larger than 200 KB; all icons SHALL be rendered via `lucide-react` or inline SVG.

### Requirement 22: Mocked Telemetry Constraint

**User Story:** As the maintainer, I want all "real-time" content on the landing page to be simulated, so that the marketing page never depends on backend availability.

#### Acceptance Criteria

1. THE Landing_Page SHALL NOT import from `frontend/src/api*` or any module that issues HTTP requests to the backend.
2. THE Landing_Page SHALL NOT call `fetch`, `axios`, `XMLHttpRequest`, or any WebSocket constructor.
3. THE simulated telemetry, terminal logs, queue metrics, network graph values, and pipeline animations SHALL all derive from constants, pseudo-randomized client-side state, or `useEffect` timers internal to the Landing_Page components.
4. IF the Landing_Page is rendered offline, THEN THE Landing_Page SHALL render and animate identically to its online behavior.

### Requirement 23: External Link Configuration

**User Story:** As the maintainer, I want GitHub and Docs links to be easily configurable, so that I can update them later without searching the codebase.

#### Acceptance Criteria

1. THE Landing_Page SHALL resolve GitHub_URL from `import.meta.env.VITE_GITHUB_URL` at build time, falling back to a single placeholder constant (for example `"#"` or `"https://github.com/TBD"`) when the variable is unset.
2. THE Landing_Page SHALL resolve Docs_URL from `import.meta.env.VITE_DOCS_URL` at build time, falling back to the placeholder route `"/docs"` when the variable is unset.
3. THE Landing_Page SHALL define GitHub_URL and Docs_URL in exactly one shared module under `frontend/src/components/landing/` (for example `links.js`) and SHALL NOT inline these URLs across multiple section components.

### Requirement 24: Error Handling for Optional UI States

**User Story:** As a visitor, I want the page to degrade gracefully if a non-critical visual element fails, so that I can still read and use the landing page.

#### Acceptance Criteria

1. IF a Landing_Section's animation library callback throws, THEN THE Landing_Section SHALL log the error to `console.error` and SHALL continue to render its static fallback visual state.
2. IF an image asset referenced by a Landing_Section fails to load, THEN THE Landing_Section SHALL render a neutral placeholder block matching its container size and SHALL NOT block the rest of the Landing_Page.
3. IF the visitor's browser does not support `backdrop-filter`, THEN THE Landing_Page SHALL fall back to a solid `bg-surface` background for `.glass`, `.glass-card`, and `.glass-panel` surfaces (this is already implicit in the existing utility classes; the Landing_Page SHALL NOT override it).

### Requirement 25: JWT Persistent Authentication

**User Story:** As a returning user, I want to remain logged in across browser sessions until I explicitly log out, so that I do not have to re-enter credentials every time I visit the dashboard.

#### Acceptance Criteria

1. WHEN a user successfully authenticates via the LoginPage, THE Auth_Module SHALL store the JWT token returned by the backend in `localStorage` under the key `mailivox_token` (existing behavior preserved).
2. WHEN the App mounts, THE Auth_Module SHALL read the `mailivox_token` from `localStorage` and decode its payload to extract the `exp` (expiration) claim without verifying the signature (client-side decode only).
3. IF the decoded `exp` claim indicates the token has not expired (i.e., `exp * 1000 > Date.now()`), THEN THE Auth_Module SHALL restore the user session from the stored `mailivox_user` object and render the authenticated AppShell without showing the LoginPage.
4. IF the decoded `exp` claim indicates the token has expired OR the token cannot be decoded, THEN THE Auth_Module SHALL clear both `mailivox_token` and `mailivox_user` from `localStorage` and render the unauthenticated flow (Landing_Page at `/` or LoginPage).
5. WHEN the user activates the Logout action, THE Auth_Module SHALL remove both `mailivox_token` and `mailivox_user` from `localStorage` and reset the in-memory user state to `null`.
6. THE Auth_Module SHALL implement the JWT decode and expiry check in a dedicated utility module at `frontend/src/utils/auth.js` exporting at minimum `isTokenValid(token): boolean` and `decodeToken(token): object | null`.
7. THE Auth_Module SHALL NOT verify the JWT signature on the client side (signature verification remains the backend's responsibility on protected API calls).
8. THE Auth_Module SHALL NOT modify any backend code, API endpoints, or JWT issuance logic.
9. WHEN the Auth_Module detects an expired token at app mount, THE Auth_Module SHALL NOT display an error toast or disruptive notification; the user SHALL simply see the unauthenticated landing/login flow.

### Requirement 26: Login Page Route and Redirect

**User Story:** As a visitor, I want a dedicated `/login` route, so that I can bookmark the login page and be redirected to the dashboard if already authenticated.

#### Acceptance Criteria

1. THE App SHALL register a route at `/login` that renders the existing `LoginPage` component for unauthenticated visitors.
2. WHILE the Auth_Gate reports the visitor is authenticated, THE App SHALL redirect route `/login` to `/dashboard`.
3. WHEN the visitor successfully logs in via the LoginPage, THE App SHALL navigate to `/dashboard`.
4. THE `/login` route SHALL be accessible without authentication (public route).

### Requirement 27: File Cleanup

**User Story:** As the maintainer, I want unused boilerplate files removed, so that the project stays clean and free of dead assets.

#### Acceptance Criteria

1. THE cleanup SHALL delete the file `frontend/src/App.css` (contains only Vite boilerplate CSS not used by any component).
2. THE cleanup SHALL delete the file `frontend/src/assets/react.svg` (unused Vite boilerplate asset).
3. THE cleanup SHALL delete the file `frontend/src/assets/vite.svg` (unused Vite boilerplate asset).
4. THE cleanup SHALL verify that `frontend/src/assets/hero.png` is not referenced by any component; IF it is not referenced, THEN THE cleanup SHALL delete it; IF it is referenced, THEN THE cleanup SHALL keep it.
5. THE cleanup SHALL NOT delete any file that is imported or referenced by an existing component.
