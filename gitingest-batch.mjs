#!/usr/bin/env node
// Batch-fetch full gitingest.com output for multiple repos to local files.
// Usage: node gitingest-batch.mjs [-o combined.md] https://github.com/user/repo1 https://github.com/user/repo2 ...
// Without -o, writes one .txt file per repo. With -o, concatenates all repos into one file.

import { pathToFileURL } from "node:url";
import { ingestOne, slugify } from "./gitingest-lib.mjs";

async function main() {
  const args = process.argv.slice(2);
  let combinedOut = null;
  const repos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o" || args[i] === "--output") {
      combinedOut = args[++i];
    } else {
      repos.push(args[i]);
    }
  }

  if (repos.length === 0) {
    console.error("Usage: node gitingest-batch.mjs [-o combined.md] <repo-url> [repo-url ...]");
    process.exit(1);
  }

  const fs = await import("node:fs/promises");
  const combinedParts = [];

  for (const repoUrl of repos) {
    try {
      console.log(`Ingesting ${repoUrl} ...`);
      const text = await ingestOne(repoUrl);
      if (combinedOut) {
        combinedParts.push(`# ${repoUrl}\n\n${text}`);
        console.log(`  -> collected (${text.length} chars)`);
      } else {
        const outFile = `${slugify(repoUrl)}.txt`;
        await fs.writeFile(outFile, text, "utf8");
        console.log(`  -> saved ${outFile} (${text.length} chars)`);
      }
    } catch (err) {
      console.error(`  ! ${err.message}`);
    }
  }

  if (combinedOut) {
    await fs.writeFile(combinedOut, combinedParts.join("\n\n---\n\n"), "utf8");
    console.log(`\nSaved combined output -> ${combinedOut}`);
  }
}

// Only auto-run when executed directly, not when imported by research-from-repo.js.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
