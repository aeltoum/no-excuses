import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  {
    encoding: "utf8",
  },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((path) => path !== "scripts/check-secrets.mjs");

const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY)\s*=\s*\S+/,
  /(?:sb_secret_|service_role\.)[A-Za-z0-9_-]{20,}/,
];

for (const path of tracked) {
  const content = readFileSync(path, "utf8");
  for (const pattern of patterns) {
    if (pattern.test(content)) throw new Error(`possible secret in ${path}`);
  }
}
