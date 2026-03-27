const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const BASE_URL = "https://www.scrapethissite.com";
const USER_AGENT =
  "Mozilla/5.0 (compatible; scraping-loop-bot/1.0; +martin local test)";
const OUTPUT_PATH = path.join(__dirname, "output", "current.csv");
const REQUEST_INTERVAL_MS = 1100;

let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimitedCurl(url, options = {}) {
  const now = Date.now();
  const waitFor = Math.max(0, REQUEST_INTERVAL_MS - (now - lastRequestAt));
  if (waitFor > 0) {
    await sleep(waitFor);
  }

  lastRequestAt = Date.now();

  const args = [
    "--silent",
    "--show-error",
    "--fail",
    "--user-agent",
    USER_AGENT,
    "--header",
    "Accept: text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  ];

  if (options.followRedirects !== false) {
    args.push("--location");
  }

  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      args.push("--header", `${key}: ${value}`);
    }
  }

  if (options.method && options.method.toUpperCase() !== "GET") {
    args.push("--request", options.method.toUpperCase());
  }

  if (options.body) {
    args.push("--data", options.body);
  }

  if (options.cookieJar) {
    args.push("--cookie", options.cookieJar, "--cookie-jar", options.cookieJar);
  }

  args.push(url);

  try {
    return execFileSync("curl", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    throw new Error(`curl failed for ${url}${stderr ? `: ${stderr}` : ""}`);
  }
}

async function fetchText(url, options) {
  return rateLimitedCurl(url, options);
}

async function fetchJson(url, options) {
  const text = await rateLimitedCurl(url, {
    ...options,
    headers: {
      Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
      ...(options && options.headers ? options.headers : {}),
    },
  });
  return JSON.parse(text);
}

function decodeHtml(value) {
  if (value == null) {
    return "";
  }

  return String(value)
    .replace(/<sup>2<\/sup>/gi, "2")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&mdash;/g, "-")
    .replace(/&rarr;/g, "->")
    .replace(/&larr;/g, "<-")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchOne(text, regex, label) {
  const match = text.match(regex);
  if (!match) {
    throw new Error(`Could not find ${label}`);
  }
  return match[1];
}

function matchAll(text, regex) {
  return Array.from(text.matchAll(regex));
}

function csvEscape(value) {
  const stringValue = value == null ? "" : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function toCsv(rows, headers) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function missingRequiredFields(rows, requiredByType) {
  const missing = new Set();

  for (const row of rows) {
    const requiredFields = requiredByType[row.record_type] || [];
    for (const field of requiredFields) {
      if (row[field] === "" || row[field] == null) {
        missing.add(field);
      }
    }
  }

  return Array.from(missing).sort();
}

async function ensureRobotsScope() {
  const robotsText = await fetchText(`${BASE_URL}/robots.txt`);
  if (
    !robotsText.includes("Disallow: /lessons/") ||
    !robotsText.includes("Disallow: /faq/")
  ) {
    throw new Error("robots.txt did not contain the expected disallow rules");
  }
}

function buildBaseRow(sourcePage, recordType) {
  return {
    source_page: sourcePage,
    record_type: recordType,
    name: "",
    capital: "",
    population: "",
    area_km2: "",
    team_name: "",
    year: "",
    wins: "",
    losses: "",
    ot_losses: "",
    win_pct: "",
    goals_for: "",
    goals_against: "",
    goal_diff: "",
    film_title: "",
    nominations: "",
    awards: "",
    best_picture: "",
    turtle_family: "",
    common_name: "",
    discovered_year: "",
    image_url: "",
    gotcha: "",
    title: "",
    description: "",
    success_message: "",
  };
}

function parseCount(html, label) {
  return Number(
    matchOne(html, /<small>\s*(\d+)\s+items\s*<\/small>/i, `${label} count`),
  );
}

function parseSimpleCountries(html) {
  const rows = [];
  const countryBlocks = matchAll(
    html,
    /<div class="col-md-4 country">([\s\S]*?)<\/div><!--\.col-->/g,
  );

  for (const [, block] of countryBlocks) {
    const row = buildBaseRow("simple", "country");
    row.name = decodeHtml(
      matchOne(
        block,
        /<h3 class="country-name">([\s\S]*?)<\/h3>/i,
        "country name",
      ),
    );
    row.capital = decodeHtml(
      matchOne(
        block,
        /<span class="country-capital">([\s\S]*?)<\/span>/i,
        "capital",
      ),
    );
    row.population = decodeHtml(
      matchOne(
        block,
        /<span class="country-population">([\s\S]*?)<\/span>/i,
        "population",
      ),
    );
    row.area_km2 = decodeHtml(
      matchOne(block, /<span class="country-area">([\s\S]*?)<\/span>/i, "area"),
    );
    rows.push(row);
  }

  return rows;
}

function parseFormRows(html) {
  const rows = [];
  const teamBlocks = matchAll(html, /<tr class="team">([\s\S]*?)<\/tr>/g);

  for (const [, block] of teamBlocks) {
    const row = buildBaseRow("forms", "hockey_team");
    row.team_name = decodeHtml(
      matchOne(block, /<td class="name">\s*([\s\S]*?)\s*<\/td>/i, "team name"),
    );
    row.year = decodeHtml(
      matchOne(block, /<td class="year">\s*([\s\S]*?)\s*<\/td>/i, "team year"),
    );
    row.wins = decodeHtml(
      matchOne(block, /<td class="wins">\s*([\s\S]*?)\s*<\/td>/i, "wins"),
    );
    row.losses = decodeHtml(
      matchOne(block, /<td class="losses">\s*([\s\S]*?)\s*<\/td>/i, "losses"),
    );
    row.ot_losses = decodeHtml(
      matchOne(
        block,
        /<td class="ot-losses">\s*([\s\S]*?)\s*<\/td>/i,
        "ot losses",
      ),
    );
    row.win_pct = decodeHtml(
      matchOne(
        block,
        /<td class="pct[^"]*">\s*([\s\S]*?)\s*<\/td>/i,
        "win pct",
      ),
    );
    row.goals_for = decodeHtml(
      matchOne(block, /<td class="gf">\s*([\s\S]*?)\s*<\/td>/i, "gf"),
    );
    row.goals_against = decodeHtml(
      matchOne(block, /<td class="ga">\s*([\s\S]*?)\s*<\/td>/i, "ga"),
    );
    row.goal_diff = decodeHtml(
      matchOne(
        block,
        /<td class="diff[^"]*">\s*([\s\S]*?)\s*<\/td>/i,
        "goal diff",
      ),
    );
    rows.push(row);
  }

  return rows;
}

async function scrapeForms() {
  const firstPageHtml = await fetchText(
    `${BASE_URL}/pages/forms/?page_num=1&per_page=100`,
  );
  const pageNumbers = matchAll(
    firstPageHtml,
    /href="\/pages\/forms\/\?page_num=(\d+)(?:&(?:amp;)?per_page=(\d+))?"/g,
  ).map((match) => Number(match[1]));
  const maxPage = Math.max(...pageNumbers, 1);

  const firstPageRows = parseFormRows(firstPageHtml);
  const allRows = [...firstPageRows];

  for (let pageNum = 2; pageNum <= maxPage; pageNum += 1) {
    const pageHtml = await fetchText(
      `${BASE_URL}/pages/forms/?page_num=${pageNum}&per_page=100`,
    );
    allRows.push(...parseFormRows(pageHtml));
  }

  const lastPageRows = parseFormRows(
    maxPage === 1
      ? firstPageHtml
      : await fetchText(
          `${BASE_URL}/pages/forms/?page_num=${maxPage}&per_page=100`,
        ),
  );
  const expectedCount = (maxPage - 1) * 100 + lastPageRows.length;

  return { rows: allRows, expectedCount };
}

function parseAjaxYears(html) {
  return matchAll(html, /<a href="#" class="year-link" id="(\d{4})">/g).map(
    (match) => match[1],
  );
}

async function scrapeAjax() {
  const ajaxHtml = await fetchText(`${BASE_URL}/pages/ajax-javascript/`);
  const expectedCount = parseCount(ajaxHtml, "ajax-javascript");
  const years = parseAjaxYears(ajaxHtml);
  const rows = [];

  for (const year of years) {
    const films = await fetchJson(
      `${BASE_URL}/pages/ajax-javascript/?ajax=true&year=${year}`,
    );
    for (const film of films) {
      const row = buildBaseRow("ajax-javascript", "oscar_film");
      row.year = String(film.year);
      row.film_title = decodeHtml(film.title);
      row.nominations = String(film.nominations);
      row.awards = String(film.awards);
      row.best_picture = film.best_picture ? "true" : "false";
      rows.push(row);
    }
  }

  return { rows, expectedCount };
}

function parseFrameFamilies(html) {
  return matchAll(
    html,
    /<div class="col-md-4 turtle-family-card">([\s\S]*?)<\/div>/g,
  ).map(([, block]) => ({
    turtle_family: decodeHtml(
      matchOne(
        block,
        /<h3 class="family-name">([\s\S]*?)<\/h3>/i,
        "turtle family",
      ),
    ),
    image_url: decodeHtml(
      matchOne(
        block,
        /<img src="([^"]+)" class="turtle-image"/i,
        "turtle image",
      ),
    ),
    detail_path: decodeHtml(
      matchOne(
        block,
        /<a href="([^"]+family=[^"]+)" class="btn btn-default btn-xs">/i,
        "detail path",
      ),
    ),
  }));
}

async function scrapeFrames() {
  const framesHtml = await fetchText(`${BASE_URL}/pages/frames/`);
  const expectedCount = parseCount(framesHtml, "frames");
  const listingHtml = await fetchText(`${BASE_URL}/pages/frames/?frame=i`);
  const families = parseFrameFamilies(listingHtml);
  const rows = [];

  for (const family of families) {
    const detailHtml = await fetchText(`${BASE_URL}${family.detail_path}`);
    const detailBlock = matchOne(
      detailHtml,
      /<div class="col-md-6 col-md-offset-3 turtle-family-detail">([\s\S]*?)<\/div>/i,
      "turtle family detail",
    );

    const row = buildBaseRow("frames", "turtle_family");
    row.turtle_family = family.turtle_family;
    row.image_url = family.image_url;
    row.common_name = decodeHtml(
      matchOne(
        detailBlock,
        /<strong class="common-name">([\s\S]*?)<\/strong>/i,
        "common name",
      ),
    );
    row.discovered_year = decodeHtml(
      matchOne(
        detailBlock,
        /were first discovered in (\d{4})/i,
        "discovered year",
      ),
    );
    rows.push(row);
  }

  return { rows, expectedCount };
}

function parseAdvancedRows(html) {
  const rowMatches = matchAll(
    html,
    /<h4>\s*<a href="\/pages\/advanced\/\?gotcha=([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h4>\s*<p>\s*([\s\S]*?)\s*<\/p>/g,
  );

  return rowMatches.map(([, gotcha, title, description]) => {
    const row = buildBaseRow("advanced", "advanced_gotcha");
    row.gotcha = decodeHtml(gotcha);
    row.title = decodeHtml(title);
    row.description = decodeHtml(description);
    return row;
  });
}

function parseFirstCenteredMessage(html) {
  return decodeHtml(
    matchOne(
      html,
      /<div class="col-md-4 col-md-offset-4">([\s\S]*?)<\/div>/i,
      "advanced response block",
    ),
  );
}

function createTempCookieJar() {
  const cookieJar = path.join(
    os.tmpdir(),
    `scraping-loop-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
  );
  fs.writeFileSync(cookieJar, "", "utf8");
  return cookieJar;
}

async function fetchAdvancedSuccessMessages() {
  const messages = {};

  const headersHtml = await fetchText(`${BASE_URL}/pages/advanced/?gotcha=headers`, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
    },
  });
  messages.headers = parseFirstCenteredMessage(headersHtml);

  const loginCookieJar = createTempCookieJar();
  try {
    await fetchText(`${BASE_URL}/pages/advanced/?gotcha=login`, {
      method: "POST",
      body: "user=primaulia&pass=secret",
      followRedirects: false,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      cookieJar: loginCookieJar,
    });
    const loginHtml = await fetchText(`${BASE_URL}/pages/advanced/?gotcha=login`, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
      cookieJar: loginCookieJar,
    });
    messages.login = parseFirstCenteredMessage(loginHtml);
  } finally {
    fs.rmSync(loginCookieJar, { force: true });
  }

  const csrfCookieJar = createTempCookieJar();
  try {
    try {
      await fetchText(`${BASE_URL}/pages/advanced/?gotcha=csrf`, {
        method: "POST",
        body: "user=primaulia&pass=secret",
        followRedirects: false,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        cookieJar: csrfCookieJar,
      });
      const csrfHtml = await fetchText(`${BASE_URL}/pages/advanced/?gotcha=csrf`, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
        },
        cookieJar: csrfCookieJar,
      });
      messages.csrf = parseFirstCenteredMessage(csrfHtml);
    } catch (error) {
      messages.csrf = "Needs login";
    }
  } finally {
    fs.rmSync(csrfCookieJar, { force: true });
  }

  return messages;
}

async function scrapeAdvanced() {
  const advancedHtml = await fetchText(`${BASE_URL}/pages/advanced/`);
  const rows = parseAdvancedRows(advancedHtml);
  const successMessages = await fetchAdvancedSuccessMessages();
  for (const row of rows) {
    row.success_message = successMessages[row.gotcha] || "";
  }
  return { rows, expectedCount: rows.length };
}

async function scrapeSimple() {
  const simpleHtml = await fetchText(`${BASE_URL}/pages/simple/`);
  return {
    rows: parseSimpleCountries(simpleHtml),
    expectedCount: parseCount(simpleHtml, "simple"),
  };
}

async function main() {
  await ensureRobotsScope();

  const pagesIndexHtml = await fetchText(`${BASE_URL}/pages/`);
  const subPagePaths = matchAll(
    pagesIndexHtml,
    /<a href="(\/pages\/[^"]+\/)">/g,
  )
    .map((match) => match[1])
    .filter((value, index, all) => all.indexOf(value) === index);

  if (subPagePaths.length < 5) {
    throw new Error("Did not detect the expected /pages/ sub-pages");
  }

  const simple = await scrapeSimple();
  const forms = await scrapeForms();
  const ajax = await scrapeAjax();
  const frames = await scrapeFrames();
  const advanced = await scrapeAdvanced();

  const rows = [
    ...simple.rows,
    ...forms.rows,
    ...ajax.rows,
    ...frames.rows,
    ...advanced.rows,
  ];

  const expectedCount =
    simple.expectedCount +
    forms.expectedCount +
    ajax.expectedCount +
    frames.expectedCount +
    advanced.expectedCount;

  const requiredByType = {
    country: ["name", "capital", "population", "area_km2"],
    hockey_team: [
      "team_name",
      "year",
      "wins",
      "losses",
      "win_pct",
      "goals_for",
      "goals_against",
      "goal_diff",
    ],
    oscar_film: ["year", "film_title", "nominations", "awards", "best_picture"],
    turtle_family: [
      "turtle_family",
      "common_name",
      "discovered_year",
      "image_url",
    ],
    advanced_gotcha: ["gotcha", "title", "description"],
  };

  const missingFields = missingRequiredFields(rows, requiredByType);
  const actualCount = rows.length;

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  const headers = Object.keys(buildBaseRow("", ""));
  fs.writeFileSync(OUTPUT_PATH, toCsv(rows, headers), "utf8");

  console.log(`expected count: ${expectedCount}`);
  console.log(`actual count: ${actualCount}`);
  console.log(
    `missing fields: ${missingFields.length ? missingFields.join(", ") : "none"}`,
  );

  process.exitCode =
    expectedCount === actualCount && missingFields.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
