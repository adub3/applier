# Workday automation (initial adapter)

Application length is not capped at a fixed page count. Full mode continues while the page/step changes; revisiting an unchanged step pauses for validation instead of looping. Sign-in, security checks, unknown required facts, and ambiguous controls remain genuine pause conditions.

Prepare a Workday job from the catalog, then select it under Applications → Application automation. Use Medium to fill the current step and review it, or Full to fill, advance, and submit automatically. None inspects only.

Supports direct employer `myworkdayjobs.com` URLs, reviewed basic profile values, exact approved answers, native and listbox dropdowns, radios/checkboxes, selected resume uploads, Save and Continue, final review, and one submission attempt. Saved portal credentials can complete account creation/sign-in when enabled in Profile; Windows protects the password at rest. CAPTCHA, missing credentials, ambiguous controls, repeated entries, stalled steps, and origin changes still pause. Only genuinely missing facts enter the question inbox; known-answer control failures are automation issues. Employment/education entries are never invented. Other Workday site families are not supported yet.

Workday employers configure different forms. Automated fixtures cover multi-step filling, upload, required question pause/resume, dropdowns, a separate review page, final submission and receipt, login boundaries, inspection/medium modes, stalled navigation, and origin guards. This is not proof of a completed live application. `node scripts/inspect-workday.js` performs a read-only check of a catalog posting.

Automatic mailbox integration is WIP. Open your email normally and paste any required verification code into the application workflow.

Navigation controls in headers, navigation/search regions, and Workday utility menus are excluded from application-field detection. This is based on page structure, not employer names or the word "English"; genuine application questions about languages remain supported. Regression fixtures cover Apply buttons/links with persistent navigation controls, unnamed field indexes, and review-change detection. Live Wells Fargo validation reached its account sign-in/create-account step; no application was submitted in that validation.
