#!/usr/bin/env node

import { readSettings } from "./config.js";
import { runServer } from "./run-server.js";
import { syncModels } from "./sync-models.js";

function parseOptions(argv) {
  const options = {
    model: "",
    preset: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--model") {
      options.model = argv[index + 1] ?? "";
      index += 1;
    } else if (token === "--preset") {
      options.preset = argv[index + 1] ?? "";
      index += 1;
    } else if (token === "--help" || token === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option '${token}'.`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`llama-runner

Usage:
  node src/cli.js sync
  node src/cli.js run
  node src/cli.js run --model <key> --preset <key>
`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const settings = await readSettings();

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "sync") {
    await syncModels(settings, { verbose: true });
    return;
  }

  if (command === "run") {
    const options = parseOptions(rest);
    if (options.help) {
      printHelp();
      return;
    }
    await runServer(settings, options);
    return;
  }

  throw new Error(`Unknown command '${command}'.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
