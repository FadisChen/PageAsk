import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = resolve(root, "dist");

await mkdir(dist, { recursive: true });
for (const file of ["manifest.json", "content-picker.js"]) {
  await cp(resolve(root, file), resolve(dist, file));
}
for (const directory of ["vendor", "images", "avatars"]) {
  await cp(resolve(root, directory), resolve(dist, directory), { recursive: true });
}

const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
manifest.background.service_worker = "background.js";
manifest.side_panel.default_path = "sidepanel.html";
await writeFile(resolve(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
