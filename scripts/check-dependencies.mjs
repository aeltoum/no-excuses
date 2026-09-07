import { readFileSync } from "node:fs";

for (const manifestPath of [
  "package.json",
  "apps/mobile/package.json",
  "packages/contracts/package.json",
]) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const group of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(manifest[group] ?? {})) {
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
        throw new Error(
          `${manifestPath}: ${name} is not pinned exactly (${version})`,
        );
      }
    }
  }
}

if (!readFileSync("pnpm-lock.yaml", "utf8").includes("lockfileVersion:")) {
  throw new Error("pnpm-lock.yaml is missing or invalid");
}

const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
const secureImageParser = "image-size: npm:image-size-next@2.1.1";
const expectedIntegrity =
  "sha512-n+DFjUct+G9mxZck+lvzqrTsqBJvSHMs6iEo//W5iAgRV7oUbrh1JWmKgAEpmyRB5lw6plIQizS1wK1dvrsvAw==";

if (!workspace.includes(secureImageParser)) {
  throw new Error(
    "Metro must use the reviewed image-size-next security override",
  );
}
if (!lockfile.includes(expectedIntegrity)) {
  throw new Error(
    "image-size-next lockfile integrity does not match reviewed npm metadata",
  );
}
