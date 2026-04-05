import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";

import {
  ensureDir,
  listJsonFiles,
  logsDir,
  modelsDir,
  presetsDir,
  readJson,
} from "./config.js";
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
  return `${lookup.year}-${lookup.month}-${lookup.day} ${lookup.hour}:${lookup.minute}:${lookup.second}`;
}

function currentLogName(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function detectBinary(settings) {
  if (settings.llamaServerBin) {
    return settings.llamaServerBin;
  }
  return process.platform === "win32" ? "llama-server.exe" : "llama-server";
}

async function loadNamedJson(dirPath, key) {
  return readJson(path.join(dirPath, `${key}.json`));
}

async function loadCollection(dirPath) {
  const files = await listJsonFiles(dirPath);
  const values = [];
  for (const filePath of files) {
    values.push(await readJson(filePath));
  }
  return values;
}

function visibleModels(models) {
  return models.filter((model) => model?.user?.enabled !== false && model?.detected?.status !== "missing");
}

function formatModelLabel(model) {
  const mmprojSuffix = model.paths.mmproj ? " + mmproj" : "";
  return `${model.displayName} (${model.key}${mmprojSuffix})`;
}

async function chooseFromList(items, label, formatter) {
  if (items.length === 1) {
    console.log(`${label}: ${formatter(items[0])}`);
    return items[0];
  }

  if (!process.stdin.isTTY) {
    throw new Error(`${label} must be provided with a command-line option in a non-interactive shell.`);
  }

  console.log(`Select ${label.toLowerCase()}:`);
  items.forEach((item, index) => {
    console.log(`  ${index + 1}) ${formatter(item)}`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      const answer = await rl.question("Enter number: ");
      const choice = Number.parseInt(answer, 10);
      if (!Number.isNaN(choice) && choice >= 1 && choice <= items.length) {
        return items[choice - 1];
      }
      console.error("Invalid selection.");
    }
  } finally {
    rl.close();
  }
}

class DailyRotatingLogger {
  constructor(modelKey) {
    this.modelKey = modelKey;
    this.stream = null;
    this.logDate = "";
    this.logDir = path.join(logsDir, modelKey);
  }

  async ensureStream() {
    const nextDate = currentLogName();
    if (this.stream && this.logDate === nextDate) {
      return;
    }

    await ensureDir(this.logDir);
    if (this.stream) {
      await new Promise((resolve) => this.stream.end(resolve));
    }

    this.logDate = nextDate;
    this.stream = fs.createWriteStream(path.join(this.logDir, `${this.logDate}.log`), { flags: "a" });
  }

  async write(chunk) {
    await this.ensureStream();
    await new Promise((resolve, reject) => {
      this.stream.write(chunk, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async writeLine(line) {
    await this.write(`${line}${os.EOL}`);
  }

  async close() {
    if (!this.stream) {
      return;
    }
    await new Promise((resolve) => this.stream.end(resolve));
    this.stream = null;
  }
}

async function cleanupOldLogs(modelKey, retentionDays) {
  const modelLogDir = path.join(logsDir, modelKey);
  await ensureDir(modelLogDir);
  const entries = await fsp.readdir(modelLogDir, { withFileTypes: true });
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".log")) {
      continue;
    }
    const filePath = path.join(modelLogDir, entry.name);
    const stats = await fsp.stat(filePath);
    if (stats.mtimeMs < cutoff) {
      await fsp.unlink(filePath);
    }
  }
}

function buildCommandArgs(settings, model, preset) {
  const args = [...settings.commonArgs, "-m", model.paths.model];

  if (model.paths.mmproj) {
    args.push("--mmproj", model.paths.mmproj);
  }

  if (Array.isArray(preset.args)) {
    args.push(...preset.args);
  }

  if (Array.isArray(model.user?.args)) {
    args.push(...model.user.args);
  }

  return args.map((value) => String(value));
}

async function announce(logger, message) {
  const line = `[${formatTimestamp()}] ${message}`;
  console.log(line);
  await logger.writeLine(line);
}

async function runOnce(settings, modelKey, presetKey) {
  const model = await loadNamedJson(modelsDir, modelKey);
  const preset = await loadNamedJson(presetsDir, presetKey);

  if (model.user?.enabled === false) {
    throw new Error(`Model '${modelKey}' is disabled.`);
  }
  if (model.detected?.status === "missing") {
    throw new Error(`Model '${modelKey}' is marked missing. Run sync and update the model file if needed.`);
  }

  const logger = new DailyRotatingLogger(model.key);
  await cleanupOldLogs(model.key, settings.logsRetentionDays);

  const bin = detectBinary(settings);
  const args = buildCommandArgs(settings, model, preset);
  await announce(logger, `Starting ${model.displayName} with preset ${preset.displayName}.`);

  const child = spawn(bin, args, {
    stdio: ["inherit", "pipe", "pipe"],
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  const handleSigint = () => forwardSignal("SIGINT");
  const handleSigterm = () => forwardSignal("SIGTERM");
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  const writeChunk = async (chunk, target) => {
    target.write(chunk);
    await logger.write(chunk);
  };

  child.stdout.on("data", (chunk) => {
    void writeChunk(chunk, process.stdout);
  });
  child.stderr.on("data", (chunk) => {
    void writeChunk(chunk, process.stderr);
  });

  let result;
  try {
    result = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
    });
  } finally {
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
  }

  const { code, signal } = result;
  if (signal) {
    await announce(logger, `${model.displayName} exited via signal ${signal}.`);
  } else {
    await announce(logger, `${model.displayName} exited with code ${code ?? 0}.`);
  }
  await logger.close();
  return { code: code ?? 0, signal: signal ?? "" };
}

export async function runServer(settings, options) {
  await syncModels(settings, { verbose: false });

  const allModels = await loadCollection(modelsDir);
  const availableModels = visibleModels(allModels);
  if (availableModels.length === 0) {
    throw new Error("No runnable models were found. Run sync after checking your models root.");
  }

  const allPresets = await loadCollection(presetsDir);
  if (allPresets.length === 0) {
    throw new Error("No presets were found.");
  }

  let selectedModel = options.model ? availableModels.find((model) => model.key === options.model) : null;
  if (options.model && !selectedModel) {
    throw new Error(`Unknown model '${options.model}'.`);
  }
  if (!selectedModel) {
    selectedModel = await chooseFromList(availableModels, "Model", formatModelLabel);
  }

  let selectedPreset = options.preset ? allPresets.find((preset) => preset.key === options.preset) : null;
  if (options.preset && !selectedPreset) {
    throw new Error(`Unknown preset '${options.preset}'.`);
  }
  if (!selectedPreset) {
    selectedPreset = await chooseFromList(allPresets, "Preset", (preset) => `${preset.displayName} (${preset.key})`);
  }

  while (true) {
    const result = await runOnce(settings, selectedModel.key, selectedPreset.key);
    if (result.signal === "SIGINT" || result.signal === "SIGTERM" || result.code === 130) {
      break;
    }
    console.log(`[${formatTimestamp()}] Restarting in ${settings.restartDelaySeconds}s.`);
    await new Promise((resolve) => setTimeout(resolve, settings.restartDelaySeconds * 1000));
  }
}
