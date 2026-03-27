# scraping_loop

This project is a single-file Node.js scraper for the practice site at `https://www.scrapethissite.com/pages/`.

It was built to follow the workflow in [SPEC.md]: scrape the sandbox pages, save a CSV for each run, and improve the script across iterations until the result is complete.

## What the scraper does

`script.js` collects data from the allowed `/pages/` sandbox areas and writes a flat CSV:

- `simple`: countries
- `forms`: hockey teams across pagination
- `ajax-javascript`: Oscar-winning films from the AJAX endpoint
- `frames`: turtle families from the iframe plus their detail pages
- `advanced`: the three challenge definitions shown on the advanced page

The scraper:

- uses Node.js with `curl` invoked from the script
- respects the 1 request/second limit
- sends an identifying user agent
- checks `robots.txt` before scraping
- writes CSV output with a header row
- prints `expected count`, `actual count`, and `missing fields`

## Outcome

Three runs were kept.

- Run 001: incomplete because forms pagination only captured the first page and blank `ot_losses` values were treated as missing
- Run 002: still incomplete because forms pagination links used literal `&per_page=100`, which the first regex fix did not handle
- Run 003: final retained run, producing `933/936`

The retained final output is [output/output_003.csv](/wsl.localhost/Ubuntu/home/martin/repos/scraping_loop/output/output_003.csv), which contains 933 scraped rows.

## What worked

- All standard data pages were scraped successfully
- Pagination, AJAX, and iframe/detail-page scraping were handled without browser automation
- The final retained dataset includes all declared items outside the last three advanced challenge success messages

## What is missing

The remaining gap is the final three advanced challenge success messages.

The scraper captures the three advanced challenge entries themselves, but it does not solve the hidden challenge flows deeply enough to claim the three success messages required by the spec. That is why the best retained result is `933/936` rather than full completion.
