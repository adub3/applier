# Job Desk

A minimal, local job-search workspace. Browse listings, save a shortlist, compare roles with your resume, and prepare applications from one place.

The dashboard runs on your computer. Search and fit reviews can use local Ollama models; Greenhouse application assistance runs in a visible browser and requires confirmation before submitting.

## Quick start

### Requirements

- **Node.js 24 or newer** and npm.
- **Git** to download and refresh the job-list source.
- **Ollama**, optional, for semantic search and fit reviews.
- A desktop browser. Application assistance also needs Playwright's Chromium browser.

Clone or download this repository, open a terminal in its folder, then run:

```sh
npm ci
git clone --depth 1 https://github.com/speedyapply/2027-AI-College-Jobs.git sources/speedyapply-ai
npm run jobs -- ingest
npm start
```

Open **http://127.0.0.1:4317**. Keep the terminal running; press `Ctrl+C` to stop the app. Your data stays saved between runs.

If `sources/speedyapply-ai` already exists, skip the clone. Use **Settings → Pull current listings** to refresh it later.

You can browse, filter, shortlist, and use keyword search without installing models. The search field starts blank; searches run when you choose **Search** or a suggested topic.

### Enable local AI features

With Ollama installed and running:

```sh
ollama pull nomic-embed-text
ollama pull deepseek-r1:8b
```

In the dashboard:

1. Open **Profile**, upload a PDF or TXT resume, and check the extracted text.
2. Open **Settings → Check employer pages** to fetch descriptions for jobs in your current filters.
3. Choose **Prepare semantic search** to build the local search index.
4. Return to **Jobs**, enter what you are looking for, and choose **Search**.

A job's **Analyze my fit** action compares its description with your resume. The first review can take longer while the model loads. If Ollama is unavailable, keyword search still works.

### Enable application assistance

Install the browser once:

```sh
npx playwright install chromium
```

Use the full Chromium installation above, rather than only the headless shell: application assistance opens a visible browser.

## Using the dashboard

| Area | What to do |
| --- | --- |
| **Jobs** | Browse or search. Select filter values to open their menus; on mobile, choose **Show filters** first. Open a row for the full description and fit review. |
| **Shortlist** | Keep roles for later using the star beside each listing. Select the star again to remove one. |
| **Profile** | Import and edit your resume, add contact details, and save your application context and writing instructions. Mark the profile accurate after reviewing it. |
| **Applications** | Track prepared roles, answer portal questions, keep reusable answers, and run Greenhouse application assistance. |
| **Settings** | Refresh the source listings, fetch employer descriptions, and prepare semantic search. |

**Save this search** remembers your filter preferences. The search text starts blank when you reopen the app, even if a query was saved previously.

### Reading a listing

- **Check page** loads the employer description and checks availability. A failed request does not mean the role is closed; you can still open the employer page directly.
- **Compensation in posting** shows extracted pay when available. Saved descriptions can supply pay even if a later page check fails. The app keeps hourly, annual, and unspecified pay periods distinct.
- A **minimum annual pay** filter includes known annual USD ranges whose upper end reaches your minimum. It excludes unknown and hourly pay.
- When pay is missing, the detail panel may link to an external compensation reference or show same-employer comparable listings. Those are separate from pay stated in the posting.
- Fit reviews and similarity scores help you compare roles. They are not hiring probabilities or verification of your eligibility.

The catalog comes from [SpeedyApply's 2027 AI College Jobs](https://github.com/speedyapply/2027-AI-College-Jobs). Listings, source ages, and availability can become outdated. Employer descriptions are fetched from supported Greenhouse and Workday endpoints; some sites block requests or use unsupported formats.

## Preparing an application

1. Open a role and choose **Prepare application**. This creates a local tracker entry; it does not apply.
2. In **Applications**, update its status and notes. Add portal questions to the question inbox and review your answers before reusing them.
3. For a supported Greenhouse role, open **Greenhouse automation**. Select the role, application email, first and last names, and the resume file for this run. Your profile's imported resume is not automatically selected.
4. Choose an automation level and start the browser:

   | Level | Behavior |
   | --- | --- |
   | **None** | Inspect the page. |
   | **Medium** | Fill recognized fields and upload the selected resume. |
   | **Full** | Also open the application and advance recognized Next/Continue steps. |

5. Review missing questions. Save answers, then choose **Resume / refresh review**. Use the employer browser for sign-in, CAPTCHA, or controls the app cannot handle.
6. Inspect the completed form. **Confirm & submit this application** sends the application. If no receipt is detected, inspect the employer page before attempting anything again.

**Watch application browser** provides a view-only preview. Choose **Pause / Take control** and wait for the handoff before editing the employer form yourself. A pause takes effect between actions; it cannot undo a submission already sent.

Only one application browser session runs at a time. Workday descriptions are supported on compatible sites; Workday application automation is not implemented.

Context and instructions are editable in **Profile**. The application worker fills recognized fields using structured profile details and saved answers; it does not generate answers from those Markdown documents.

### Optional Gmail verification

The application workflow includes optional Gmail verification-code support. Its setup accepts a Google OAuth **Desktop app** credentials JSON and requires an explicit account connection. The requested scope is Gmail read-only; tokens are held for the current server session. Without a connection, handle email verification yourself.

OAuth client configuration is stored in `.local/gmail-client.json`. Keep the downloaded credentials and the `.local/` directory out of your repository.

## Ethics and intended use

The ethical case for Job Desk is mutual discovery: applicants can find more suitable opportunities, and employers can encounter qualified candidates who might otherwise abandon repetitive application forms. Manual paperwork is not itself a useful test of someone's ability to do a job. Transferring accurate information with less effort can improve the matching process for both sides and reduce accessibility barriers.

Where employers already use applicant tracking systems and automated screening, applicant-side assistance can make the overall workflow smoother. More applications do not necessarily create a proportional increase in administrative work; existing systems may absorb much of the additional processing. The intended benefit is more relevant candidates and clearer information reaching the right employer, not simply a higher submission count. Automation does not inherently make an application less sincere.

This is a rationale to evaluate, not a guarantee that additional volume has no cost. An ATS does not eliminate every human review step, and more records are not necessarily more useful information. Accurate, relevant applications can expand an employer's options; duplicates and misleading or indiscriminate submissions can increase noise. The meaningful question is whether the tool improves discovery and matching for both sides, rather than whether it increases volume alone.

The intended boundary is assistance with truthful applications the user has deliberately chosen:

- **Accuracy:** Use real qualifications and experiences. Review imported text, reused answers, and model suggestions. Do not invent credentials or let the tool answer uncertain eligibility questions as facts.
- **Intent:** Apply to roles you would seriously consider. The purpose is to reduce repetitive work, not flood employers with duplicate or indiscriminate applications. This does not mean applicants must meet every preferred qualification.
- **Agency:** Review the actual employer form before confirming submission. A confirmation button only helps when the review is meaningful; it does not make inaccurate or spammy applications acceptable.
- **Boundaries:** Respect employer access restrictions and application instructions. Sign-in and CAPTCHA remain user tasks. Do not use the tool to evade restrictions, impersonate another applicant, or complete an assessment that is supposed to measure your unaided ability.
- **Privacy:** Use only personal data and accounts you are authorized to use. Local storage reduces some exposure, but it is not encryption, and employer forms can receive data before final submission. Gmail read-only permission still permits sensitive access and should only be connected when needed.

The current design supports these intentions through user-selected roles, reviewed profile details, a question inbox, a visible application browser, and confirmation before submission. These are partial safeguards, not proof of ethical use: the app cannot verify that a claim is true, that an application reflects real interest, or that someone carefully reviewed it. It does not enforce an application-volume limit.

### User discretion and responsibility

Whether to use Job Desk, which opportunities to pursue, and what information to submit are decisions for the user. Users are responsible for the accuracy of their representations, their application activity, and respecting the requirements of the services they access. Providing this tool does not constitute endorsement of every use to which it may be put.

The maintainers provide application assistance; they do not direct individual application decisions or supervise each user's conduct. Misuse contrary to the project's intended purpose is a choice made by the person engaging in that conduct. Users should not interpret the availability of a feature as permission to misrepresent themselves, disregard employer instructions, or use another person's information without authorization.

This allocation of responsibility does not replace the maintainers' responsibility to describe the tool honestly, maintain reasonable safeguards, and address known defects. It states the project's expectations for use, rather than claiming a blanket exemption from responsibility.

Our position is that reducing administrative friction and improving mutual discovery are defensible goals. Success means applicants find suitable roles and employers receive useful candidate information with less avoidable effort. The project should be evaluated by those outcomes, not submission counts alone. These ethical principles are not a claim that every employer permits automation.

## Local data and network access

The app stores its state in **`.local/`**, including:

- The SQLite catalog, profile, shortlist, fit reviews, and application tracker.
- Uploaded resumes, reusable answers, and context/instruction documents.
- Browser session data and cookies used by application assistance.
- Local logs, screenshots, and optional OAuth client configuration.

This directory is ignored by Git. Storage is not encrypted by the app. To back up your workspace, stop the server and copy `.local/` to a private location.

The server binds to `127.0.0.1` and is intended for a single local user, not public hosting. It contacts GitHub for listings, employer sites for descriptions and applications, and local Ollama for model inference. Connecting Gmail also contacts Google. Filling employer fields or uploading a resume can send data to the employer **before** final submission.

## Configuration

Default model names, the Ollama address, and the source directory are defined in [src/config.js](src/config.js).

| Setting | Default |
| --- | --- |
| Dashboard | `http://127.0.0.1:4317` |
| Ollama | `http://127.0.0.1:11434` |
| Embeddings | `nomic-embed-text:latest` |
| Fit review | `deepseek-r1:8b` |
| Local data | `.local/` |
| Listing source checkout | `sources/speedyapply-ai/` |

To use another dashboard port:

```powershell
# PowerShell
$env:JOB_BOT_PORT = '4318'
npm start
```

```sh
# macOS / Linux shell
JOB_BOT_PORT=4318 npm start
```

The browser smoke scripts expect the default port, `4317`.

## Command line

Run these from the project folder:

```sh
npm run jobs -- ingest --pull
npm run jobs -- profile "path/to/resume.pdf"
npm run jobs -- enrich --limit 80
npm run jobs -- index
npm run jobs -- search --query "machine learning engineer" --limit 20
npm run jobs -- review JOB_ID
npm run jobs -- status
```

`search` prints job IDs you can pass to `review`. Indexing and review need the configured Ollama models. Run application assistance through the dashboard; the old `apply` command is retired.

## Troubleshooting

| Problem | Try this |
| --- | --- |
| No listings | Run the source clone and `npm run jobs -- ingest` steps, then reset filters. |
| `fetch failed` on a job | Retry **Check page**, or open the employer page. A cached description remains available when present. |
| Semantic search unavailable | Check that Ollama is running, pull the configured models, then choose **Prepare semantic search**. |
| No fit review | Add a resume and fetch the job description first. Check model availability in **Settings**. |
| Chromium executable missing | Run `npx playwright install chromium`. |
| Port already in use | Open the existing app or set `JOB_BOT_PORT` to another port. |
| Session error after a restart | Reload the page to obtain the new local session token. |
| SQLite warning on Node 24 | An experimental SQLite warning is expected; it does not by itself mean startup failed. |

## Development

```sh
npm ci
npx playwright install chromium
npm test
```

With the app running in another terminal:

```sh
npm run test:ui
```

The UI smoke test expects an imported catalog, a saved resume, and the configured model information. It checks filters, menus, shortlisting, job details, profile/settings navigation, and mobile layout. Its temporary shortlist change is restored; screenshots are written to `.local/`.

`npm run test:live` is an optional, fixture-specific integration check. It refreshes public data, accesses employer endpoints, and runs local inference against particular job IDs. It is not a portable fresh-install test and does not submit applications.

```text
src/       Local server, database, importers, models, application worker
web/       Dashboard HTML, CSS, and JavaScript
test/      Unit tests and intercepted browser fixtures
scripts/   Browser checks and development utilities
.local/    Private runtime data (ignored)
sources/   Downloaded listing repository (ignored)
```

*applier*
