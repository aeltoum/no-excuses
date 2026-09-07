import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const generatedPath = "packages/contracts/src/generated.ts";
const before = readFileSync(generatedPath, "utf8");
execFileSync("pnpm", ["contracts:generate"], { stdio: "inherit" });
const after = readFileSync(generatedPath, "utf8");

if (before !== after) {
  throw new Error(`${generatedPath} was stale; regenerate and commit it`);
}
