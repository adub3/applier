# Employment history as source of truth

Profile → Employment & research history stores employer/institution, exact aliases, role, and start/end months. Review and completeness are separate approvals. Changing a row in the UI clears both checkboxes until reconfirmed.

For supported prior-employer questions, a reviewed exact name/alias match yields Yes. An absent employer yields No only when the user confirms the history is complete; otherwise the result is unknown. Compound affiliate/subsidiary questions are not reduced to a simple name match. Eligibility, authorization, sponsorship, and demographic answers do not use this rule.

The worker derives these answers from the current structured history. Older saved employer-history responses are retained as historical records, but are excluded from the answer lookup. New actual fills emit `application_answer_used` audit events with job/session, prompt, answer, and the history revision used. Updating history does not rewrite those events.

The old `applicationDefaults.priorEmployerAbsentNo` resume-absence heuristic is no longer consulted. The three resume entries confirmed by the user have been migrated locally. No history is inferred complete for other users.
