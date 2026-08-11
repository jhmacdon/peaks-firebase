import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("disposable database role can create isolated test schemas", () => {
  const provision = readFileSync(
    join(__dirname, "../../../test-db/provision.sh"),
    "utf8"
  );
  const grants = readFileSync(
    join(__dirname, "../../../test-db/grants.sql"),
    "utf8"
  );

  assert.match(provision, /DB_NAME.*\*_test/);
  assert.match(
    provision,
    /-v "db_name=\$DB_NAME"[\s\S]*-f "\$HERE\/grants\.sql"/
  );
  assert.match(
    grants,
    /GRANT CREATE ON DATABASE :"db_name" TO :"test_role"/
  );
});
