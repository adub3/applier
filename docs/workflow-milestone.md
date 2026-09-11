# Application-to-confirmation milestone

Success means one representative live employer application completes with no intervention after its required facts, credentials, consent, and resume are supplied, and the employer confirms receipt. A local test, a completed account, final review, or a click on Submit is not live success.

## Workflow contract

- Stages: opening, account, application, review, submission, verification, confirmed or confirmation pending.
- Use saved profile facts and exact approved answers. Missing information belongs in the question inbox; a failed selector or an answer that did not stick belongs to automation diagnostics.
- Continue through delayed account handoffs and newly revealed known questions in the same run.
- Length is not a completion criterion. Detect unchanged steps, not an arbitrary maximum page count.
- Never retry an uncertain submission. An account popup after submission alone proves neither acceptance nor a mandatory account requirement.
- Keep personal facts, credentials, cookies, documents, and test-run settings private to this checkout under `.local/`; see `private-data.md`.

## Verification levels

`npm run test:workflow` runs a local integration contract with controlled test data: account creation, delayed loading, conditional fields, resume upload, review, one application submission, email verification, and receipt. It also checks blocker classification and ambiguous post-submit account screens. It is not a live employer test.

`node scripts/test-workday-live.js <job-id>` runs a real employer form with automatic submission disabled. The `--submit` option requires explicit user authorization and a reviewed application showing the configured email. Private resume selection is read from the local `liveWorkflowTest` setting with `--approved-resume`.

Live status (2026-09-11): Wells Fargo reached all six application stages and was submitted once. The employer displayed “Application Submitted,” “You have successfully applied for this job posting,” and “You have no more tasks.” The tracker records submitted, and the receipt screenshot stays in private local storage. This verifies one completed live application after iterative fixes and user approvals; it does not establish unattended success on every Workday employer. DraftKings received one earlier Submit click, but its receipt remains unconfirmed.

The live Wells Fargo check filled required contact, source survey, education, eligibility, and approved terms fields. Optional experience details and voluntary disclosures were left unanswered; the selected resume was attached. Recruitment-source defaults require explicit opt-in and select an offered option. Profile facts take precedence over stale portal answer IDs; button dropdown answers are read as labels, and Mobile can match Personal Cell. Source-survey defaults do not extend to eligibility or legal questions.

My Profile now offers revocable standing approval for ordinary Workday application terms in Full Auto. The worker reads the displayed terms, requires an approved profile, and records the terms and their hash privately when accepted. This does not generate qualifications, extend to Medium/None mode, or accept unrelated commitments such as fees, arbitration, or waivers. Exact per-application approvals remain separate from this preference.

Additional live Greenhouse test (2026-09-11): WhiteWater Midstream, Data Science Intern – Summer 2027. All required form fields filled, including shared reviewed education/eligibility facts, location, approved onsite/background-check answers, and demographic decline choices. The school picker required an equivalent campus label; mixed native/select controls now match only visible popup options. Greenhouse then displayed an eight-character email security code requirement before submission. No receipt has been confirmed for this application. This split-code layout still needs dedicated automation support; do not treat a filled form as a completed application.
