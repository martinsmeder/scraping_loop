# SPEC.md — Scraping Loop

## Goal

Test whether an AI coding agent can build a scraper for `https://www.scrapethissite.com/pages/` by using only:

- clues available on the target website itself
- the agent's own prior run history in this repo

The target output is:

- all 933 items from "Countries of the World", "Hockey Teams", "Oscar Winning Films" and "Turtles All the Way Down"
- the 3 success messages from "Advanced Topics"

Success means getting all 933 items plus the 3 success messages, with no missing fields.

## Project Structure

```
/project
  script.js          ← agent edits this each iteration
  SPEC.md            ← this file, instructions for the agent
  log.txt            ← append info from each run
  /output
    output_001.csv   ← new output from each run
    output_002.csv
    ...
```

## Allowed Information Sources

The agent may only use information from:

- `https://www.scrapethissite.com/pages/`
- `https://www.scrapethissite.com/robots.txt`
- files already present in this repo:
  - `SPEC.md`
  - `script.js`
  - `log.txt`
  - prior `output/*.csv`
  - prior `output/error_*.txt`

The agent may use clues directly available from the website, including:

- HTML
- rendered page text
- links and forms
- redirects
- cookies set by the site
- response headers
- AJAX / XHR / JSON responses returned by the site
- frame or iframe content served by the site

## Forbidden Information Sources

The agent must not use any information source other than the target website and the repository files generated during prior runs.

This means the agent must not use:

- web search
- GitHub
- source-code mirrors
- Stack Overflow
- blog posts or tutorials
- external datasets
- browser search engines
- manually supplied hints that were not directly observed from the site
- hidden internal notes, chain-of-thought files, or private scratch files as evidence

## Evidence Rule

Any credential, token, parameter, selector fallback, hidden field value, cookie interpretation, or success message included in:

- `script.js`
- `log.txt`
- any `output/*.csv`

must have been directly observed from website responses during the run loop, or derived only from those observations.

Guesses, external lookups, or manual substitutions are invalid.

If the agent makes an inference from observed evidence, it must say so explicitly in `log.txt`.

## Success Message Rule

The 3 final challenge success messages must be obtained from live website behavior.

They must come from one or more of:

- response bodies
- rendered pages
- AJAX responses
- redirects
- cookies or other state returned by the site, if that state clearly proves the success message shown by the site

The agent must not hardcode, paraphrase, rename, or substitute a challenge-specific success message unless that exact message was directly observed from the website.

## Initial Run (run once only)

1. Fetch `https://www.scrapethissite.com/pages/` and read the HTML
2. Identify all sub-pages to scrape and the expected record count declared on each
3. If needed, install required dependencies using Node.js
4. Write scraping code to `script.js`
5. Run `script.js`
6. On success: save output as `/output/output_001.csv`
7. On crash: save error output as `/output/error_001.txt`
8. Append run entry to `log.txt`

Notes for the initial run:

- Begin with the simplest website-only approach.
- Inspect the site structure and declared counts before guessing implementation details.
- Do not assume challenge credentials, hidden fields, or message strings unless observed from the website.

## Loop (repeat until success condition met)

1. Read repo files and website contents as needed. The agent may use any evidence already recorded in this repo, including all of log.txt, prior outputs, and prior error files.
2. Read current `script.js`
3. Identify what changed last time, what failed, and what the plan was
4. Update `script.js` based on that reasoning
5. Run `script.js`
6. On success: save new output as `/output/output_NNN.csv`
7. On crash: save error as `/output/error_NNN.txt`, treat as `0/N` rows retrieved
8. Append run entry to `log.txt`

Notes for each loop iteration:

- Base changes only on evidence from the site and repo files
- Explain what was observed, what was inferred, and what will change next.
- If a run succeeds functionally for part of the site but does not prove the exact success message text, that run is still incomplete.

## Log Format

Each entry must follow this exact format:

```
Run NNN | YYYY-MM-DD HH:MM
Items: [number of obtained items]/933
Success messages: [number of success messages]/3
Status: success | fail
Tried: [what approach was used this run]
Problem: [what went wrong, or "none"]
Plan: [what will be changed next run, or "complete"]
---
```

Interpretation requirements:

- `Tried` should describe the actual approach used against the website.
- `Problem` should distinguish between directly observed failures and inferred blockers whenever possible.
- `Plan` should describe the next evidence-based change.
- If an important assumption was made, note it in `Problem` or `Plan`.

## Crash Handling

If `script.js` throws a runtime error:

- log `Status` as `"crash"`
- log the first line of the error message under `Problem`
- do not count a crash as a successful iteration toward the safety valve
- attempt a fundamentally different approach next run, not a minor tweak

## Rules

- Maximum one request per second
- Send an identifying user agent
- Only read the last 3 log entries each iteration, not the full log
- Do not rewrite `SPEC.md`
- Do not delete any files
- Use the simplest possible solution for each problem
- `script.js` must be a single file
- Output must be valid CSV with a header row
- Save a CSV for every run, including incomplete runs
- Script must print to stdout: expected count, actual count, and any missing fields
- Script must exit with code 0 on success, code 1 on failure
- Do not hardcode challenge answers unless they were directly observed from the website during this run loop
- Do not claim full success unless the exact required success messages were directly verified from the site
- If browser automation is used, it must still rely only on the target website and repo history, not outside information
- Follow robots.txt (see below)

## Robots.txt

User-agent: `*`
Allowed to scrape: `/pages/`
Disallowed (do not touch): `/lessons/`, `/faq/`
