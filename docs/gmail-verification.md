# Gmail verification

**Current status: WIP and disabled in the dashboard.** Use manual code entry. The browser approach below is retained as experimental implementation documentation, not an available connection flow.

In **Profile → Email verification**, click **Sign in to Gmail**. Sign in yourself in the separate browser window and complete Google security checks. There is no Google Cloud project, OAuth client JSON, or password field in the bot. Leave that browser open. The bot detects the signed-in account from Gmail's account control.

This is browser access, not restricted OAuth permission: the session can access the mailbox. The bot searches recent Greenhouse verification mail and reads Gmail's Show original view to check recipient, date, authenticated Greenhouse sender, employer/role text, and an unambiguous numeric code. Opening a matching email may mark it read. Multiple results, unsupported Gmail layouts/languages, generic login emails, and verification links require manual handling. It does not send/delete mail, open arbitrary emailed links, or send email contents to a model. Google may refuse automated-browser sign-in; there is no bypass.

The browser uses a temporary, non-persistent context, separate from your usual Chrome profile. Disconnect closes it and clears the bot's session. Sign in again after restarting. Codes and email bodies are not saved by the bot to the inbox, Markdown, or logs. Automatic checking stops after 15 minutes or an error; manual entry and Check Gmail again remain available. Old OAuth implementation code is retained but is no longer exposed by the server or required by the UI.

Starting **Full** mode authorizes automatic submission after filling required fields from approved data. **Medium** stops at review; **None** inspects only. Email verification is not permission to submit a second time. The tracker conservatively marks the outcome uncertain until the employer confirms receipt. Browser restarts cannot resume an in-memory verification session.

**Past applications** holds tracker records (including in-progress runs) and CSV export. The reusable answer library is in **Profile**.

Tests: `npm test` covers intercepted Gmail browser pages, raw MIME decoding, and employer submission/verification. `node scripts/test-gmail-ui.js` checks sign-in UI, route protection, page placement, and mobile layout. These tests never read actual mail or submit a real application. Live Gmail compatibility requires the user to sign in and is not established by fixtures.

References: [Google desktop OAuth and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app), [Gmail filtering](https://developers.google.com/workspace/gmail/api/guides/filtering), [Greenhouse senders](https://support.greenhouse.io/hc/en-us/articles/17675865619099-Greenhouse-Recruiting-no-reply-email-addresses).
