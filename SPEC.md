# SPEC.md — Scraping Loop

## Goal

Scrape https://www.scrapethissite.com/pages/ to get all 933 items + 3 success messages from the final challenges.

## Project Structure

```
/project
  script.js          ← agent edits this each iteration
  SPEC.md            ← this file, agent reads this each iteration
  log.txt            ← append-only run history
  /output
    output_001.csv   ← new output from each run
    output_002.csv
    ...
```

## Success Condition

Stop when: 933/933 items + 3 success messages
Safety valve: stop after 10 iterations regardless of result, then ask if you should continue

## Initial Run (run once only)

1. Fetch https://www.scrapethissite.com/pages/ and read the HTML
2. Identify all sub-pages to scrape and the expected record count declared on each
3. Install required dependencies (use Node.js)
4. Write scraping code to script.js
5. Run script.js
6. On success: save output as /output/output_001.csv
7. On crash: save error output as /output/error_001.txt
8. Append run entry to log.txt

## Loop (repeat until success condition met)

1. Read the last 3 entries from log.txt
2. Read current script.js
3. Identify what changed last time, what failed, and what the plan was
4. Update script.js based on that reasoning
5. Run script.js
6. On success: save new output as /output/output_NNN.csv
7. On crash: save error as /output/error_NNN.txt, treat as 0/N rows retrieved
8. Append run entry to log.txt

## Log Format

Each entry must follow this exact format:

```
Run NNN | YYYY-MM-DD HH:MM
Result: [number of obtained items]/[all items]
Status: success | fail
Tried: [what approach was used this run]
Problem: [what went wrong, or "none"]
Plan: [what will be changed next run, or "complete"]
---
```

## Crash Handling

If script.js throws a runtime error:

- Log Status as "crash"
- Log the first line of the error message under Problem
- Do not count a crash as a successful iteration toward the safety valve
- Attempt a fundamentally different approach next run, not a minor tweak

## Rules

- Maximum one request per second
- Send an identifying user agent
- Only read the last 3 log entries each iteration, not the full log
- Do not rewrite SPEC.md
- Do not delete any files
- Use the simplest possible solution for each problem (avoid full browser automation unless strictly needed)
- script.js must be a single file
- Output must be valid CSV with a header row
- Script must print to stdout: expected count, actual count, and any missing fields
- Script must exit with code 0 on success, code 1 on failure
- Follow robots.txt (see below)

## Robots.txt

User-agent: \*
Allowed to scrape: /pages/
Disallowed (do not touch): /lessons/, /faq/
