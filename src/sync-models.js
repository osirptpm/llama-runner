import fs from "node:fs/promises";
import path from "node:path";

import {
  ensureDir,
  listJsonFiles,
  modelsDir,
  normalizeConfigPath,
  readJson,
  writeJsonIfChanged,
} from "./config.js";

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function isMmprojFile(fileName) {
  return /mmproj/i.test(fileName);
}

function chooseModelCandidate(files, directoryName) {
  const candidates = files.filter((file) => !isMmprojFile(file));
  const exactName = `${directoryName}.gguf`.toLowerCase();

  candidates.sort((left, right) => {
    const leftScore = left.toLowerCase() === exactName ? 0 : 1;
    const rightScore = right.toLowerCase() === exactName ? 0 : 1;
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }
    if (left.length !== right.length) {
      return left.length - right.length;
    }
    return left.localeCompare(right);
  });

  return candidates[0] ?? null;
}

function chooseMmprojCandidate(files) {
  return files
    .filter((file) => isMmprojFile(file))
    .sort((left, right) => left.length - right.length || left.localeCompare(right))[0] ?? null;
}

function createModelDocument({ key, directoryName, settings, modelPath, mmprojPath, existing }) {
  const now = new Date().toISOString();
  const preservedUser = typeof existing?.user === "object" && existing.user !== null ? existing.user : {};
  const normalizedModelPath = normalizeConfigPath(modelPath);
  const normalizedMmprojPath = mmprojPath ? normalizeConfigPath(mmprojPath) : "";
  const normalizedSourceRoot = normalizeConfigPath(settings.modelsRoot);
  const metadataUnchanged = existing?.paths?.model === normalizedModelPath
    && (existing?.paths?.mmproj ?? "") === normalizedMmprojPath
    && existing?.detected?.directoryName === directoryName
    && existing?.detected?.sourceRoot === normalizedSourceRoot
    && existing?.detected?.status === "ready";

  return {
    key,
    displayName: typeof existing?.displayName === "string" && existing.displayName.trim()
      ? existing.displayName
      : directoryName,
    paths: {
      model: normalizedModelPath,
      mmproj: normalizedMmprojPath,
    },
    detected: {
      directoryName,
      sourceRoot: normalizedSourceRoot,
      scannedAt: metadataUnchanged ? (existing?.detected?.scannedAt ?? now) : now,
      status: "ready",
    },
    user: {
      enabled: preservedUser.enabled ?? true,
      args: Array.isArray(preservedUser.args) ? preservedUser.args : [],
      notes: typeof preservedUser.notes === "string" ? preservedUser.notes : "",
    },
  };
}

function markMissingModel(existing) {
  const alreadyMissing = existing?.detected?.status === "missing";
  return {
    ...existing,
    detected: {
      ...(existing.detected ?? {}),
      scannedAt: alreadyMissing ? existing?.detected?.scannedAt : new Date().toISOString(),
      status: "missing",
    },
  };
}

export async function syncModels(settings, options = {}) {
  const { verbose = true } = options;
  const sourceRoot = path.resolve(settings.modelsRoot);

  await ensureDir(modelsDir);
  const existingPaths = await listJsonFiles(modelsDir);
  const existingByKey = new Map();

  for (const filePath of existingPaths) {
    const value = await readJson(filePath);
    if (value?.key) {
      existingByKey.set(value.key, { filePath, value });
    }
  }

  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  const seenKeys = new Set();
  const summary = {
    created: 0,
    updated: 0,
    missing: 0,
    skipped: 0,
  };

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directoryPath = path.join(sourceRoot, entry.name);
    const directoryEntries = await fs.readdir(directoryPath, { withFileTypes: true });
    const ggufFiles = directoryEntries
      .filter((candidate) => candidate.isFile() && candidate.name.toLowerCase().endsWith(".gguf"))
      .map((candidate) => candidate.name);

    const modelFile = chooseModelCandidate(ggufFiles, entry.name);
    if (!modelFile) {
      summary.skipped += 1;
      continue;
    }

    const baseKey = slugify(entry.name) || "model";
    let key = baseKey;
    let suffix = 2;
    while (seenKeys.has(key)) {
      key = `${baseKey}-${suffix}`;
      suffix += 1;
    }
    seenKeys.add(key);

    const mmprojFile = chooseMmprojCandidate(ggufFiles);
    const modelPath = path.join(directoryPath, modelFile);
    const mmprojPath = mmprojFile ? path.join(directoryPath, mmprojFile) : "";
    const existing = existingByKey.get(key)?.value;
    const filePath = existingByKey.get(key)?.filePath ?? path.join(modelsDir, `${key}.jsonc`);
    const nextValue = createModelDocument({
      key,
      directoryName: entry.name,
      settings,
      modelPath,
      mmprojPath,
      existing,
    });
    const changed = await writeJsonIfChanged(filePath, nextValue);

    if (!existing) {
      summary.created += 1;
    } else if (changed) {
      summary.updated += 1;
    }

    existingByKey.delete(key);
  }

  for (const { filePath, value } of existingByKey.values()) {
    const changed = await writeJsonIfChanged(filePath, markMissingModel(value));
    if (changed) {
      summary.missing += 1;
    }
  }

  if (verbose) {
    console.log(
      `Synced models from ${normalizeConfigPath(sourceRoot)}: `
        + `${summary.created} created, ${summary.updated} updated, `
        + `${summary.missing} marked missing, ${summary.skipped} skipped.`,
    );
  }

  return summary;
}
