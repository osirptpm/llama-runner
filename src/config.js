import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(srcDir, "..");
export const configDir = path.join(repoRoot, "config");
export const modelsDir = path.join(repoRoot, "models");
export const presetsDir = path.join(repoRoot, "presets");
export const logsDir = path.join(repoRoot, "logs");
export const settingsPath = path.join(configDir, "settings.json");

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

export async function readJson(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
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
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name))
    .sort();
}
