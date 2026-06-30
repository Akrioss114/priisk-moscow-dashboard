import { mkdir, rm, copyFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { minify } from "terser";

const root = process.cwd();
const dist = join(root, "cloudflare-dist");

async function minifyFile(input, output) {
  const result = await minify(await Bunless.readText(input), {
    compress: true,
    mangle: true,
  });
  await Bunless.writeText(output, result.code || "");
}

const Bunless = {
  async readText(path) {
    return await import("node:fs/promises").then((fs) => fs.readFile(path, "utf8"));
  },
  async writeText(path, text) {
    return await import("node:fs/promises").then((fs) => fs.writeFile(path, text, "utf8"));
  },
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await mkdir(join(dist, "data-chunks"), { recursive: true });

for (const file of ["index.html", "styles.css", "chunks.json"]) {
  await copyFile(join(root, file), join(dist, file));
}

for (const file of await readdir(join(root, "data-chunks"))) {
  if (file.endsWith(".json")) {
    await copyFile(join(root, "data-chunks", file), join(dist, "data-chunks", file));
  }
}

await minifyFile(join(root, "app-core.js"), join(dist, "app-core.js"));
await minifyFile(join(root, "app-actions.js"), join(dist, "app-actions.js"));
await minifyFile(join(root, "app.js"), join(dist, "app.js"));
await minifyFile(join(root, "cloudflare-worker.js"), join(dist, "_worker.js"));
