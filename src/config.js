import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";

const srcDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(srcDir, "..");
export const configDir = path.join(repoRoot, "config");
export const modelsDir = path.join(repoRoot, "models");
export const presetsDir = path.join(repoRoot, "presets");
export const logsDir = path.join(repoRoot, "logs");
const supportedConfigExtensions = [".jsonc", ".json"];

const defaultSettings = {
  modelsRoot: "D:/gguf",
  logsRetentionDays: 3,
  restartDelaySeconds: 3,
  llamaServerBin: "",
  commonArgs: [],
};

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function normalizeConfigPath(inputPath) {
  return inputPath.replace(/\\/g, "/");
}

export async function resolveConfigPath(dirPath, key) {
  for (const extension of supportedConfigExtensions) {
    const candidate = path.join(dirPath, `${key}${extension}`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return path.join(dirPath, `${key}.jsonc`);
}

export async function readJson(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return parse(content);
}

export async function writeJsonIfChanged(filePath, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`;

  try {
    const current = await fs.readFile(filePath, "utf8");
    if (current === next) {
      return false;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, next, "utf8");
  return true;
}

export async function readSettings() {
  const settingsPath = await resolveConfigPath(configDir, "settings");
  const loaded = await readJson(settingsPath);
  return {
    ...defaultSettings,
    ...loaded,
    commonArgs: Array.isArray(loaded.commonArgs) ? loaded.commonArgs : defaultSettings.commonArgs,
  };
}

export async function listJsonFiles(dirPath) {
  await ensureDir(dirPath);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const preferredByBaseName = new Map();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name);
    if (!supportedConfigExtensions.includes(extension)) {
      continue;
    }

    const baseName = path.basename(entry.name, extension);
    const existing = preferredByBaseName.get(baseName);
    const rank = supportedConfigExtensions.indexOf(extension);

    if (!existing || rank < existing.rank) {
      preferredByBaseName.set(baseName, {
        filePath: path.join(dirPath, entry.name),
        rank,
      });
    }
  }

  return [...preferredByBaseName.values()]
    .map((entry) => entry.filePath)
    .sort();
}
