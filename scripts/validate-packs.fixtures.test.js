/**
 * Validator parity against the shared pack-spec fixture corpus.
 *
 * Each fixture under schemas/fixtures/valid/ must validate cleanly. Each
 * fixture under schemas/fixtures/invalid/ declares an "expected-error:"
 * header comment with a canonical error code drawn from the closed enum
 * in pack-spec's vocabularies/error-codes.yaml. This runner asserts every
 * fixture's verdict matches what validate-packs.js emits.
 *
 * Error-code → message-pattern mapping is intentionally string-matching:
 * validate-packs.js emits human-readable errors, not structured codes.
 * The corpus asserts behaviour parity across consumers, not identical
 * string output.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { validatePack } from "./validate-packs.js";

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURES_ROOT = join(ROOT, "schemas", "fixtures");
const VALID_DIR = join(FIXTURES_ROOT, "valid");
const INVALID_DIR = join(FIXTURES_ROOT, "invalid");

// Patterns that validate-packs.js is expected to emit for each canonical
// error code. At least one emitted error must match the pattern.
const CODE_PATTERNS = {
  "missing-pack-version": /Missing required field: "pack"/i,
  "unsupported-pack-version": /Unsupported pack version/i,
  "missing-description": /Missing required field: "description"/i,
  "missing-data-block": /Missing required field: "data"/i,
  "missing-skills": /"skills" must be a non-empty array/i,
};

// Error codes the hand-rolled validator intentionally does not enforce
// (covered by the JSON Schema at the marketplace boundary). Fixtures
// carrying these codes are skipped with a note.
const SKIPPED_CODES = new Set([
  "description-too-long",
  "invalid-semver",
  "missing-required-field",
]);

function parseExpectedError(yamlText) {
  for (const line of yamlText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || !trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^#\s*expected-error:\s*(\S+)\s*$/);
    if (match) return match[1];
  }
  return null;
}

function yamlFixturesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  );
}

describe("pack-spec fixture corpus — valid", () => {
  for (const name of yamlFixturesIn(VALID_DIR)) {
    it(name, () => {
      const yaml = readFileSync(join(VALID_DIR, name), "utf-8");
      const parsed = parseYaml(yaml);
      const errors = validatePack(parsed);
      assert.deepEqual(errors, [], `unexpected errors: ${errors.join(", ")}`);
    });
  }
});

describe("pack-spec fixture corpus — invalid", () => {
  for (const name of yamlFixturesIn(INVALID_DIR)) {
    const yaml = readFileSync(join(INVALID_DIR, name), "utf-8");
    const expectedCode = parseExpectedError(yaml);

    if (!expectedCode) {
      it(`${name} (no expected-error header)`, () => {
        assert.fail(`Missing "# expected-error:" header in ${name}`);
      });
      continue;
    }

    if (SKIPPED_CODES.has(expectedCode)) {
      it.skip(`${name} (${expectedCode} — not checked by hand-rolled validator)`, () => {});
      continue;
    }

    it(`${name} (${expectedCode})`, () => {
      let parsed;
      try {
        parsed = parseYaml(yaml);
      } catch {
        // Parse failure is an acceptable verdict for invalid fixtures.
        return;
      }
      const errors = validatePack(parsed);
      assert.ok(errors.length > 0, `expected invalid, got valid`);

      const pattern = CODE_PATTERNS[expectedCode];
      assert.ok(
        pattern,
        `No pattern defined for '${expectedCode}' — add one to CODE_PATTERNS`,
      );

      const hit = errors.some((msg) => pattern.test(msg));
      assert.ok(
        hit,
        `Expected error matching ${pattern}; got: ${errors.join(" | ")}`,
      );
    });
  }
});
