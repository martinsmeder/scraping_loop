const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const BASE_URL = "https://www.scrapethissite.com";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 scraping-loop-bot/1.0";
const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const REQUEST_DELAY_MS = 1100;
const EXPECTED_ITEMS = 933;
const EXPECTED_MESSAGES = 3;
const EXPECTED_TOTAL = EXPECTED_ITEMS + EXPECTED_MESSAGES;
const FULL_BROWSER_HEADERS = {
  Accept: ACCEPT,
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "max-age=0",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
};

let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttledFetch(url, options = {}) {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < REQUEST_DELAY_MS) {
    await sleep(REQUEST_DELAY_MS - elapsed);
  }

  const headers = {
    "User-Agent": USER_AGENT,
    Accept: ACCEPT,
    ...(options.headers || {}),
  };

  const args = ["-sS", "-L", url];
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }

  if (options.method && options.method !== "GET") {
    args.push("-X", options.method);
  }

  if (options.body !== undefined) {
    args.push("--data", options.body);
  }

  const body = execFileSync("curl", args, { encoding: "utf8" });
  lastRequestAt = Date.now();
  return { body };
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "-")
    .replace(/&rarr;/g, "->");
}

function stripTags(text) {
  return decodeHtmlEntities(text.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBase64Url(text) {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function toCsvValue(value) {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function rowToCsv(row) {
  return [
    row.id,
    row.kind,
    row.name,
    row.source_url,
    JSON.stringify(row.data),
  ]
    .map(toCsvValue)
    .join(",");
}

function collectMatches(text, regex) {
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
  }
  return matches;
}

async function fetchText(url, options = {}) {
  const response = await throttledFetch(url, options);
  return { response, body: response.body };
}

async function scrapeCountries(rows) {
  const url = `${BASE_URL}/pages/simple/`;
  const { body } = await fetchText(url);
  const blocks = collectMatches(
    body,
    /<div class="col-md-4 country">([\s\S]*?)<\/div><!--\.col-->/g
  );

  for (const [index, blockMatch] of blocks.entries()) {
    const block = blockMatch[1];
    const name = stripTags(
      (block.match(/<h3 class="country-name">([\s\S]*?)<\/h3>/) || [])[1] || ""
    );
    const capital = stripTags(
      (block.match(/<span class="country-capital">([\s\S]*?)<\/span>/) || [])[1] ||
        ""
    );
    const population = stripTags(
      (block.match(/<span class="country-population">([\s\S]*?)<\/span>/) || [])[1] ||
        ""
    );
    const area = stripTags(
      (block.match(/<span class="country-area">([\s\S]*?)<\/span>/) || [])[1] || ""
    );

    rows.push({
      id: `country-${String(index + 1).padStart(3, "0")}`,
      kind: "country",
      name,
      source_url: url,
      data: { name, capital, population, area_km2: area },
    });
  }
}

function parseTeamRows(body, sourceUrl) {
  const blocks = collectMatches(
    body,
    /<tr class="team">([\s\S]*?)<\/tr>/g
  ).map((match) => match[1]);

  return blocks.map((block) => {
    const value = (className) =>
      stripTags(
        (block.match(
          new RegExp(`<td class="${className}[^"]*">([\\s\\S]*?)<\\/td>`)
        ) || [])[1] || ""
      );

    const name = value("name");
    const year = value("year");
    return {
      key: `${name}-${year}`,
      row: {
        id: `hockey-${year}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        kind: "hockey_team",
        name,
        source_url: sourceUrl,
        data: {
          name,
          year,
          wins: value("wins"),
          losses: value("losses"),
          ot_losses: value("ot-losses") || "0",
          win_pct: value("pct"),
          goals_for: value("gf"),
          goals_against: value("ga"),
          goal_diff: value("diff"),
        },
      },
    };
  });
}

async function scrapeHockey(rows) {
  const seen = new Set();

  for (let pageNum = 1; pageNum <= 40; pageNum += 1) {
    const url =
      pageNum === 1
        ? `${BASE_URL}/pages/forms/`
        : `${BASE_URL}/pages/forms/?page_num=${pageNum}`;
    const { body } = await fetchText(url);
    const pageRows = parseTeamRows(body, url);

    if (pageRows.length === 0) {
      break;
    }

    let newRows = 0;
    for (const item of pageRows) {
      if (!seen.has(item.key)) {
        seen.add(item.key);
        rows.push(item.row);
        newRows += 1;
      }
    }

    if (newRows === 0) {
      break;
    }
  }
}

async function scrapeOscars(rows) {
  const years = ["2015", "2014", "2013", "2012", "2011", "2010"];
  for (const year of years) {
    const url = `${BASE_URL}/pages/ajax-javascript/?ajax=true&year=${year}`;
    const { body } = await fetchText(url);
    const films = JSON.parse(body);
    for (const film of films) {
      const title = String(film.title).trim();
      rows.push({
        id: `oscar-${film.year}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        kind: "oscar_film",
        name: title,
        source_url: url,
        data: {
          title,
          year: String(film.year),
          awards: String(film.awards),
          nominations: String(film.nominations),
          best_picture: String(Boolean(film.best_picture)),
        },
      });
    }
  }
}

async function scrapeTurtles(rows) {
  const indexUrl = `${BASE_URL}/pages/frames/?frame=i`;
  const { body } = await fetchText(indexUrl);
  const cards = collectMatches(
    body,
    /<div class="col-md-4 turtle-family-card">([\s\S]*?)<\/div>/g
  ).map((match) => match[1]);

  for (const card of cards) {
    const name = stripTags(
      (card.match(/<h3 class="family-name">([\s\S]*?)<\/h3>/) || [])[1] || ""
    );
    const imageUrl =
      (card.match(/<img src="([^"]+)" class="turtle-image"/) || [])[1] || "";
    const relativeDetailUrl =
      (card.match(/<a href="([^"]+family=[^"]+)"/) || [])[1] || "";
    const detailUrl = `${BASE_URL}${relativeDetailUrl}`;
    const detail = await fetchText(detailUrl);
    const commonName = stripTags(
      (detail.body.match(/<strong class="common-name">([\s\S]*?)<\/strong>/) || [])[1] ||
        ""
    );
    const leadText = stripTags(
      (detail.body.match(/<p class="lead">([\s\S]*?)<\/p>/) || [])[1] || ""
    );
    const discoveredMatch = leadText.match(/were first discovered in (\d+) by (.+)\.$/);
    const discoveredYear = discoveredMatch ? discoveredMatch[1] : "";
    const discoveredBy = discoveredMatch ? discoveredMatch[2] : "";

    rows.push({
      id: `turtle-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      kind: "turtle_family",
      name,
      source_url: detailUrl,
      data: {
        family: name,
        common_name: commonName,
        discovered_year: discoveredYear,
        discovered_by: discoveredBy,
        image_url: imageUrl,
      },
    });
  }
}

async function scrapeAdvanced(messages, observations) {
  const badHeadersUrl = `${BASE_URL}/pages/advanced/?gotcha=headers`;
  const badHeaders = await fetchText(badHeadersUrl, {
    headers: {
      "User-Agent": "scraping-loop-bot/1.0",
      Accept: "*/*",
    },
  });
  observations.push(
    `Observed headers failure message: ${badHeaders.body.trim()}`
  );

  const goodHeaders = await fetchText(badHeadersUrl);
  const headerMessage = stripTags(goodHeaders.body);
  if (headerMessage) {
    messages.push({
      id: "success-headers",
      kind: "success_message",
      name: "headers",
      source_url: badHeadersUrl,
      data: { gotcha: "headers", message: headerMessage },
    });
  }

  for (const gotcha of ["login", "csrf"]) {
    const url = `${BASE_URL}/pages/advanced/?gotcha=${gotcha}`;
    const page = await fetchText(url);
    observations.push(`Observed ${gotcha} GET response: ${page.body.trim()}`);
  }

  const loginPageUrl = `${BASE_URL}/login/`;
  const loginPage = await fetchText(loginPageUrl);
  const loginFields = collectMatches(
    loginPage.body,
    /<input[^>]+name="([^"]+)"/g
  ).map((match) => match[1]);
  observations.push(`Observed login form fields: ${loginFields.join(", ")}`);

  const rawLogin = execFileSync(
    "curl",
    [
      "-sS",
      "-D",
      "-",
      "-o",
      "-",
      loginPageUrl,
      "-H",
      `User-Agent: ${USER_AGENT}`,
      "-H",
      `Accept: ${ACCEPT}`,
      "-H",
      "Content-Type: application/x-www-form-urlencoded",
      "-X",
      "POST",
      "--data",
      "email=test%40example.com&password=test",
    ],
    { encoding: "utf8" }
  );
  const sessionCookie =
    (rawLogin.match(/Set-Cookie:\s*session=([^;]+);/i) || [])[1] || "";
  if (sessionCookie) {
    const payload = sessionCookie.split(".")[0];
    try {
      const decoded = decodeBase64Url(payload);
      observations.push(`Observed login failure cookie payload: ${decoded}`);
    } catch (error) {
      observations.push("Observed login failure cookie payload but could not decode it");
    }
  }

  for (const gotcha of ["login", "csrf"]) {
    const page = await fetchText(`${BASE_URL}/pages/advanced/?gotcha=${gotcha}`, {
      headers: FULL_BROWSER_HEADERS,
    });
    observations.push(
      `Observed ${gotcha} GET response with fuller browser headers: ${page.body.trim()}`
    );
  }

  const publicPages = [
    `${BASE_URL}/`,
    `${BASE_URL}/pages/`,
    `${BASE_URL}/pages/advanced/`,
    loginPageUrl,
  ];
  const siteEmails = new Set();
  for (const publicPageUrl of publicPages) {
    const page = await fetchText(publicPageUrl);
    for (const match of collectMatches(
      page.body,
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g
    )) {
      siteEmails.add(match[0]);
    }
  }
  observations.push(
    `Observed public-page emails: ${
      siteEmails.size === 0 ? "none" : Array.from(siteEmails).join(", ")
    }`
  );

  for (const gotcha of ["login", "csrf"]) {
    const gotchaUrl = `${BASE_URL}/pages/advanced/?gotcha=${gotcha}`;
    const rawPost = execFileSync(
      "curl",
      [
        "-sS",
        "-D",
        "-",
        "-o",
        "-",
        gotchaUrl,
        "-H",
        `User-Agent: ${USER_AGENT}`,
        "-H",
        `Accept: ${ACCEPT}`,
        "-H",
        "Content-Type: application/x-www-form-urlencoded",
        "-X",
        "POST",
        "--data",
        "email=test%40example.com&password=test",
      ],
      { encoding: "utf8" }
    );
    const location =
      (rawPost.match(/\nLocation:\s*([^\r\n]+)/i) || [])[1] || "none";
    const cookiePresent = /Set-Cookie:/i.test(rawPost) ? "yes" : "no";
    observations.push(
      `Observed advanced ${gotcha} POST redirect: ${location}; set-cookie: ${cookiePresent}`
    );
  }

  if (sessionCookie) {
    for (const gotcha of ["login", "csrf"]) {
      const cookieReplay = execFileSync(
        "curl",
        [
          "-sS",
          `${BASE_URL}/pages/advanced/?gotcha=${gotcha}`,
          "-H",
          `User-Agent: ${USER_AGENT}`,
          "-H",
          `Accept: ${ACCEPT}`,
          "-H",
          `Cookie: session=${sessionCookie}`,
        ],
        { encoding: "utf8" }
      );
      observations.push(
        `Observed ${gotcha} GET with invalid-login session cookie: ${cookieReplay.trim()}`
      );
    }
  }

  for (const gotcha of ["login", "csrf"]) {
    const nextUrl = `/pages/advanced/?gotcha=${gotcha}`;
    const rawNextLogin = execFileSync(
      "curl",
      [
        "-sS",
        "-D",
        "-",
        "-o",
        "-",
        `${BASE_URL}/login/?next=${encodeURIComponent(nextUrl)}`,
        "-H",
        `User-Agent: ${USER_AGENT}`,
        "-H",
        `Accept: ${ACCEPT}`,
        "-H",
        "Content-Type: application/x-www-form-urlencoded",
        "-X",
        "POST",
        "--data",
        "email=test%40example.com&password=test",
      ],
      { encoding: "utf8" }
    );
    const nextLocation =
      (rawNextLogin.match(/\nLocation:\s*([^\r\n]+)/i) || [])[1] || "none";
    observations.push(
      `Observed /login/?next= flow for ${gotcha}: redirect ${nextLocation}`
    );
  }
}

function validateRows(rows) {
  const missing = [];
  for (const row of rows) {
    for (const field of ["id", "kind", "name", "source_url"]) {
      if (!row[field]) {
        missing.push(`${row.id || "unknown"}:${field}`);
      }
    }
    for (const [key, value] of Object.entries(row.data)) {
      if (value === "") {
        missing.push(`${row.id}:${key}`);
      }
    }
  }
  return missing;
}

async function main() {
  const rows = [];
  const messages = [];
  const observations = [];

  await scrapeCountries(rows);
  await scrapeHockey(rows);
  await scrapeOscars(rows);
  await scrapeTurtles(rows);
  await scrapeAdvanced(messages, observations);

  const allRows = [...rows, ...messages];
  const missingFields = validateRows(allRows);

  const outputFile = process.env.OUTPUT_FILE;
  if (!outputFile) {
    throw new Error("OUTPUT_FILE is required");
  }
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const csvLines = [
    "id,kind,name,source_url,data_json",
    ...allRows.map(rowToCsv),
  ];
  fs.writeFileSync(outputFile, `${csvLines.join("\n")}\n`, "utf8");

  const result = {
    items: rows.length,
    success_messages: messages.length,
    total_rows: allRows.length,
    missing_fields: missingFields,
    observations,
  };

  if (process.env.RESULT_FILE) {
    fs.writeFileSync(process.env.RESULT_FILE, JSON.stringify(result, null, 2));
  }

  console.log(`Expected count: ${EXPECTED_TOTAL}`);
  console.log(`Actual count: ${allRows.length}`);
  console.log(
    `Missing fields: ${missingFields.length === 0 ? "none" : missingFields.join(", ")}`
  );

  const success =
    rows.length === EXPECTED_ITEMS &&
    messages.length === EXPECTED_MESSAGES &&
    missingFields.length === 0;
  process.exit(success ? 0 : 1);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
