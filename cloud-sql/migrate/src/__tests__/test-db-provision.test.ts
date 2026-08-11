import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("disposable database role can create isolated test schemas", () => {
  const source = readFileSync(
    join(__dirname, "../../../test-db/provision.sh"),
    "utf8"
  );

  assert.match(source, /DB_NAME.*\*_test/);
  assert.match(
    source,
    /db_name=\$DB_NAME[\s\S]*GRANT CREATE ON DATABASE :"db_name" TO :"test_role"/
  );
});
