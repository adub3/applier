# Per-repository private data

The default personal-data directory is `.local/` inside this checkout. It contains the profile, application context/instructions, answer library, employer history, tracking database, uploaded resumes, browser cookies, and diagnostics. Git ignores the whole directory. Another checkout has its own data unless `JOB_BOT_DATA` explicitly points both checkouts at the same directory.

Portal passwords are encrypted using Windows DPAPI CurrentUser. They are not included in API responses, Markdown, or logs. Other profile data and browser cookies are local but are not all encrypted: protect access to the computer and do not publish or share `.local/` backups.

Shared scripts must read applicant facts and resume filenames from the local store, not embed real applicant details. Live-test configuration is the private `liveWorkflowTest` setting; running a test does not authorize submitting it unless explicitly requested.

Before publishing, inspect `git diff --cached` and confirm `git ls-files .local` is empty. Ignore rules do not protect files that someone force-adds or files already committed. No repository data is pushed by this setup.
