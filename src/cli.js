#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readSettings } from "./config.js";
import { logsDir } from "./config.js";
import { runServer } from "./run-server.js";
import { syncModels } from "./sync-models.js";

function formatTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${lookup.year}-${lookup.month}-${lookup.day} ${lookup.hour}:${lookup.minute}:${lookup.second}.${milliseconds}`;
}

function formatErrorMessage(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

async function appendRuntimeErrorLog(message) {
  const filePath = path.join(logsDir, `${new Date().toISOString().slice(0, 10)}.runtime-error.log`);
  try {
    await fs.mkdir(logsDir, { recursive: true });
    await fs.appendFile(filePath, `${message}${os.EOL}`, "utf8");
  } catch (error) {
    console.error(`[${formatTimestamp()}] Failed to write runtime error log: ${formatErrorMessage(error)}`);
  }
}

process.on("unhandledRejection", (reason) => {
  const message = `[${formatTimestamp()}] Unhandled rejection: ${formatErrorMessage(reason)}`;
  console.error(message);
  void appendRuntimeErrorLog(message);
});

process.on("uncaughtExceptionMonitor", (error) => {
  const message = `[${formatTimestamp()}] Uncaught exception: ${formatErrorMessage(error)}`;
  console.error(message);
  void appendRuntimeErrorLog(message);
});

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
  const message = `[${formatTimestamp()}] ${formatErrorMessage(error)}`;
  console.error(message);
  void appendRuntimeErrorLog(message);
  process.exitCode = 1;
});
