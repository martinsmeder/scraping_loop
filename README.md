# scraping_loop

This repo is a small environment for testing whether an AI coding agent can improve its own scraping strategy against the practice site at `https://www.scrapethissite.com/pages/`.

The agent is expected to inspect the website, write and revise `script.js`, run it, log what happened, and save CSV output for each attempt. The exact rules are in [SPEC.md].

## Purpose

The goal is to provide a clean loop where an agent can iteratively work toward full coverage using only:

- clues from the website
- evidence already recorded in the repo

## Use

Clone the repo, open it in your coding environment, and let your agent of choice work inside it.

The agent should use [SPEC.md] as the contract for what it is allowed to do and what counts as success.
