import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { listOfficialTrailSources } from "../official-trail-sources";

const migrationPath = join(
  __dirname,
  "../../../migrations/20260827_listed_route_country_codes.sql"
);
const migration = readFileSync(migrationPath, "utf8");
const TEST_DATABASE_URL = process.env.ROUTE_JOB_TEST_DATABASE_URL;

test("listed route country repair pins the reviewed 91-destination set", () => {
  const rows = [
    ...migration.matchAll(/\('([A-Za-z0-9]{20})', '(CA|IR|US)'\)/g),
  ].map((match) => ({ id: match[1], countryCode: match[2] }));

  assert.equal(rows.length, 91);
  assert.equal(new Set(rows.map((row) => row.id)).size, 91);
  assert.deepEqual(
    Object.fromEntries(
      ["CA", "IR", "US"].map((countryCode) => [
        countryCode,
        rows.filter((row) => row.countryCode === countryCode).length,
      ])
    ),
    { CA: 1, IR: 48, US: 42 }
  );
});

test("listed route country repair checks identity drift and converges", () => {
  assert.match(
    migration,
    /LEFT JOIN destinations destination[\s\S]*WHERE destination\.id IS NULL[\s\S]*references missing catalog destinations/
  );
  assert.match(migration, /destination\.location IS NULL/);
  assert.match(migration, /ST_DWithin\([\s\S]*-123\.004672 49\.850562/);
  assert.match(migration, /country_code = 'IR'[\s\S]*BETWEEN 24 AND 40/);
  assert.match(migration, /country_code = 'US'[\s\S]*BETWEEN 18 AND 50/);
  assert.match(
    migration,
    /destination\.country_code IS NULL[\s\S]*upper\(btrim\(destination\.country_code\)\) !~ '\^\[A-Z\]\{2\}\$'/
  );
  assert.match(migration, /listed route country code repair did not converge/);
});

test("every repaired country has an official-source registry record", () => {
  const repairedCountryCodes = new Set(
    [...migration.matchAll(/\('[A-Za-z0-9]{20}', '([A-Z]{2})'\)/g)].map(
      (match) => match[1]
    )
  );
  const registeredCountryCodes = new Set(
    listOfficialTrailSources().flatMap((source) => source.coverage.countries)
  );

  assert.deepEqual(
    [...repairedCountryCodes].filter(
      (countryCode) => !registeredCountryCodes.has(countryCode)
    ),
    []
  );
});

test(
  "listed route country repair aborts when a reviewed catalog ID is missing",
  { skip: TEST_DATABASE_URL ? false : "ROUTE_JOB_TEST_DATABASE_URL not set" },
  () => {
    const databaseUrl = new URL(TEST_DATABASE_URL!);
    assert.match(
      databaseUrl.pathname,
      /_test$/,
      "country repair tests require a disposable *_test database"
    );
    const result = spawnSync(
      "psql",
      [databaseUrl.toString(), "-v", "ON_ERROR_STOP=1", "-f", migrationPath],
      { encoding: "utf8", timeout: 15_000 }
    );

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(
      result.stderr,
      /listed route country review references missing catalog destinations/
    );
  }
);
