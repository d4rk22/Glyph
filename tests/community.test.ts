import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const templatePaths = [
  "../.github/ISSUE_TEMPLATE/bug_report.yml",
  "../.github/ISSUE_TEMPLATE/feature_request.yml",
  "../.github/ISSUE_TEMPLATE/deployment_support.yml",
  "../.github/ISSUE_TEMPLATE/security_report.yml"
];

test("public issue templates warn against sharing sensitive deployment details", () => {
  for (const path of templatePaths) {
    const template = readFileSync(new URL(path, import.meta.url), "utf8");

    assert.match(template, /secrets/i, path);
    assert.match(template, /Cloudflare account IDs/i, path);
    assert.match(template, /API tokens/i, path);
    assert.match(template, /private domains if sensitive/i, path);
    assert.match(template, /passkey/i, path);
    assert.match(template, /R2 object keys/i, path);
    assert.match(template, /deployment logs/i, path);
  }
});

test("public issue templates redirect security reports to SECURITY.md", () => {
  for (const path of templatePaths) {
    const template = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(template, /SECURITY\.md/, path);
  }
});

test("deployment support template documents community support boundaries", () => {
  const template = readFileSync(new URL("../.github/ISSUE_TEMPLATE/deployment_support.yml", import.meta.url), "utf8");

  assert.match(template, /best-effort community support/);
  assert.match(template, /no hosted service/i);
  assert.match(template, /SLA/);
  assert.match(template, /billing support/);
  assert.match(template, /Cloudflare account configuration/);
});

test("issue template config disables blank issues and links security policy", () => {
  const config = readFileSync(new URL("../.github/ISSUE_TEMPLATE/config.yml", import.meta.url), "utf8");

  assert.match(config, /blank_issues_enabled: false/);
  assert.match(config, /SECURITY\.md/);
  assert.match(config, /Documentation/);
});
