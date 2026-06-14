#!/usr/bin/env node
/**
 * Print Oryntra backlog summary from docs/pm/backlog.yaml
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const backlogPath = join(root, "docs/pm/backlog.yaml");

function parseSimpleYaml(text) {
  const data = { meta: {}, requirements: [], features: [], sprints: [] };
  let section = null;
  let current = null;
  let pendingKey = null;
  let listKey = null;
  let listItems = [];

  const flushList = () => {
    if (current && listKey) {
      current[listKey] = listItems;
      listKey = null;
      listItems = [];
    }
  };

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    if (line === "meta:") {
      flushList();
      section = "meta";
      current = data.meta;
      continue;
    }
    if (line === "requirements:") {
      flushList();
      section = "requirements";
      current = null;
      continue;
    }
    if (line === "features:") {
      flushList();
      section = "features";
      current = null;
      continue;
    }
    if (line === "sprints:") {
      flushList();
      section = "sprints";
      current = null;
      continue;
    }

    const itemMatch = line.match(/^  - id: (.+)$/);
    if (itemMatch && section !== "meta") {
      flushList();
      current = { id: itemMatch[1].trim() };
      data[section].push(current);
      pendingKey = null;
      continue;
    }

    const kvMatch = line.match(/^  ([a-z_]+):(?:\s*(.+))?$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2]?.trim() ?? "";
      if (!current) continue;

      if (value === "") {
        pendingKey = key;
        listKey = null;
        listItems = [];
        continue;
      }

      if (value.startsWith("[") && value.endsWith("]")) {
        current[key] = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        current[key] = value.replace(/^["']|["']$/g, "");
      }
      pendingKey = null;
      continue;
    }

    const listItemMatch = line.match(/^      - (.+)$/);
    if (listItemMatch && current) {
      if (pendingKey) {
        listKey = pendingKey;
        listItems = [];
        pendingKey = null;
      }
      listItems.push(listItemMatch[1].trim());
      continue;
    }

    const nestedKv = line.match(/^    ([a-z_]+):(?:\s*(.+))?$/);
    if (nestedKv && current) {
      const key = nestedKv[1];
      const value = nestedKv[2]?.trim() ?? "";
      if (value.startsWith("[") && value.endsWith("]")) {
        current[key] = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (value) {
        current[key] = value.replace(/^["']|["']$/g, "");
      } else {
        pendingKey = key;
        listKey = null;
        listItems = [];
      }
    }
  }

  flushList();
  return data;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

const backlog = parseSimpleYaml(readFileSync(backlogPath, "utf8"));
const { meta, requirements, features, sprints } = backlog;

const statusOrder = [
  "in_progress",
  "blocked",
  "planned",
  "proposed",
  "done",
  "deferred",
  "cancelled",
];

function groupByStatus(items) {
  const groups = {};
  for (const item of items) {
    const s = item.status ?? "unknown";
    (groups[s] ??= []).push(item);
  }
  return statusOrder
    .filter((s) => groups[s]?.length)
    .map((s) => [s, groups[s]]);
}

console.log(`\nOryntra PM Report — ${meta.last_updated ?? "unknown date"}`);
console.log("=".repeat(56));

const activeSprint = sprints.find((s) => s.status === "active");
if (activeSprint) {
  console.log(`\nActive sprint: ${activeSprint.id} — ${activeSprint.title}`);
  console.log(`  Goal: ${activeSprint.goal ?? "(none)"}`);
  for (const fid of asList(activeSprint.features)) {
    const f = features.find((x) => x.id === fid);
    console.log(`  • ${fid} [${f?.status ?? "?"}] ${f?.title ?? ""}`);
  }
}

console.log("\nRequirements");
for (const [status, items] of groupByStatus(requirements)) {
  console.log(`  ${status} (${items.length})`);
  for (const r of items) {
    console.log(`    ${r.id}  ${r.title}`);
  }
}

console.log("\nFeatures (not done)");
const openFeatures = features.filter((f) => f.status !== "done");
for (const [status, items] of groupByStatus(openFeatures)) {
  console.log(`  ${status} (${items.length})`);
  for (const f of items) {
    const pri = f.priority ? ` (${f.priority})` : "";
    console.log(`    ${f.id}${pri}  ${f.title}`);
  }
}

const doneCount = features.filter((f) => f.status === "done").length;
console.log(`\nDone: ${doneCount}/${features.length} features`);
console.log("");
