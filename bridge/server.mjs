#!/usr/bin/env node
/**
 * Local Cursor bridge. Cursor has no public chat-completions HTTP API.
 * This wraps the official `agent` / `cursor-agent` CLI (print + ask mode).
 *
 *   node bridge/server.mjs
 *
 * Listens on 0.0.0.0:47821 by default. Uses logged-in Cursor CLI; CURSOR_API_KEY optional.
 * Auth: Authorization Bearer optional (logged-in agent preferred).
 *
 * Endpoints:
 *   GET  /health
 *   POST /translate              { items, targetLang?, glossary?, page? }
 *   POST /v1/chat/completions   OpenAI-compatible (messages → agent → choices[0].message.content)
 */
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOST = process.env.PBT_BRIDGE_HOST || "0.0.0.0";
const PORT = Number(process.env.PBT_BRIDGE_PORT || 47821);
const MODEL = process.env.PBT_MODEL || "composer-2.5-fast";
const MAX_PARALLEL = Math.max(1, Number(process.env.PBT_PARALLEL || 2));
const MOCK = process.argv.includes("--mock");
const ERROR_LOG_PATH =
  process.env.PBT_ERROR_LOG ||
  path.join(os.homedir(), ".page-bilingual", "error-log.jsonl");
const ERROR_LOG_CAP = 200;

function ensureErrorLogDir() {
  try {
    fs.mkdirSync(path.dirname(ERROR_LOG_PATH), { recursive: true });
  } catch {
    /* ignore */
  }
}

function appendBridgeError(entry) {
  ensureErrorLogDir();
  const row = {
    t: Date.now(),
    ...entry,
    via: entry?.via || "bridge",
  };
  try {
    fs.appendFileSync(ERROR_LOG_PATH, JSON.stringify(row) + "\n", "utf8");
  } catch (e) {
    console.warn("[pbt-bridge] error log write failed", e?.message || e);
  }
  return row;
}

function readBridgeErrors(limit) {
  try {
    if (!fs.existsSync(ERROR_LOG_PATH)) return [];
    const lines = fs.readFileSync(ERROR_LOG_PATH, "utf8").split(/\n+/).filter(Boolean);
    const slice = lines.slice(-(limit || 80));
    return slice
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { t: 0, message: line, kind: "raw" };
        }
      })
      .reverse();
  } catch {
    return [];
  }
}

function trimBridgeErrorLog() {
  try {
    if (!fs.existsSync(ERROR_LOG_PATH)) return;
    const lines = fs.readFileSync(ERROR_LOG_PATH, "utf8").split(/\n+/).filter(Boolean);
    if (lines.length <= ERROR_LOG_CAP) return;
    fs.writeFileSync(ERROR_LOG_PATH, lines.slice(-ERROR_LOG_CAP).join("\n") + "\n", "utf8");
  } catch {
    /* ignore */
  }
}

/** Limit parallel Cursor CLI calls (startup is expensive; 2 is a sweet spot). */
let inflight = 0;
const waiters = [];
function acquire() {
  return new Promise((resolve) => {
    if (inflight < MAX_PARALLEL) {
      inflight += 1;
      resolve();
      return;
    }
    waiters.push(resolve);
  });
}
function release() {
  const next = waiters.shift();
  if (next) {
    next();
  } else {
    inflight = Math.max(0, inflight - 1);
  }
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function json(res, code, body) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function extractJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Cursor CLI returned no JSON array.");
  return JSON.parse(text.slice(start, end + 1));
}

function resolveAgentBin() {
  if (process.env.CURSOR_AGENT_BIN) return process.env.CURSOR_AGENT_BIN;
  const candidates = [
    "/home/box/.local/bin/agent",
    "/Users/sparrow/.local/bin/agent",
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* skip */
    }
  }
  const names = process.platform === "win32" ? ["cursor-agent.cmd", "agent.cmd"] : ["cursor-agent", "agent"];
  const dirs = (process.env.PATH || "").split(path.delimiter);
  for (const name of names) {
    for (const dir of dirs) {
      const p = path.join(dir, name);
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        /* skip */
      }
    }
  }
  return names[0];
}

const BIN = resolveAgentBin();

function killTree(pid) {
  if (!pid) return;
  try { spawnSync("pkill", ["-9", "-P", String(pid)], { stdio: "ignore" }); } catch {}
  try { process.kill(pid, "SIGKILL"); } catch {}
}

function runAgent(prompt, apiKey, modelOverride) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pbt-cursor-"));
  const home = process.env.PBT_AGENT_HOME || "/tmp/pbt-agent-home-warm";
  // Skip global MCP plugins (they add ~20s startup per call and starve the gate).
  try {
    const cursorDir = path.join(cwd, ".cursor");
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(path.join(cursorDir, "mcp.json"), JSON.stringify({ mcpServers: {} }));
    const homeCursor = path.join(home, ".cursor");
    fs.mkdirSync(homeCursor, { recursive: true });
    fs.writeFileSync(path.join(homeCursor, "mcp.json"), JSON.stringify({ mcpServers: {} }));
  } catch { /* ignore */ }
  const bin = BIN;
  const model = String(modelOverride || MODEL).trim() || MODEL;
  const args = ["-p", "--mode", "ask", "--trust", "--workspace", cwd, "--output-format", "text", "--model", model, prompt];
  const env = { ...process.env };
  // Origin-scoped cloud session JWTs break CLI chat; never inherit them into agent children.
  delete env.CURSOR_AUTH_TOKEN;
  delete env.CURSOR_CONVERSATION_ID;
  delete env.CURSOR_AGENT_SOCKET;
  delete env.CURSOR_REQUEST_ID;
  // Ephemeral HOME avoids Origin auth.json AND prevents zombie LSP accumulation in a shared home.
  env.HOME = home;
  if (apiKey) env.CURSOR_API_KEY = apiKey;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env, cwd });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const cleanup = () => {
      killTree(child.pid);
      try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
      // keep shared warm HOME (npm/tsserver cache)
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Cursor CLI timed out (90s)."));
    }, 90_000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(
        new Error(
          `Could not start Cursor CLI (${bin}). Install: curl https://cursor.com/install -fsS | bash`
        )
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (code !== 0 && !stdout.trim()) {
        const detail = stderr.trim() || `Cursor CLI exited ${code}`;
        appendBridgeError({
          kind: /login|logged in|CURSOR_API_KEY|auth/i.test(detail)
            ? "auth_cli_or_key"
            : "bridge_cli_exit",
          message: detail.slice(0, 500),
          stderr: stderr.slice(-800),
          source: "runAgent",
        });
        trimBridgeErrorLog();
        reject(new Error(detail));
        return;
      }
      resolve({ text: (stdout + "\n" + stderr).trim(), stdout, stderr });
    });
  });
}

function buildPrompt(targetLang, items, glossary, page) {
  const gloss =
    !glossary?.length ? "" : "Terms:\n" + glossary.map((g) => `- ${g.src} => ${g.dst}`).join("\n") + "\n";
  const where = [page?.host, page?.title].filter(Boolean).join(" — ") || "";
  return (
    `Translate each item to ${targetLang}. JSON array only: [{"id":"...","text":"..."}]. Same ids/order/count. Keep names/code/numbers.\n` +
    (where ? `Page: ${where}\n` : "") +
    gloss +
    `Items: ${JSON.stringify(items)}`
  );
}

function bearerKey(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    const k = header.slice(7).trim();
    // Extension may send placeholder "bridge"; ignore non-real keys
    if (k && k !== "bridge") return k;
  }
  return process.env.CURSOR_API_KEY || "";
}

function messagesToPrompt(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const parts = [];
  for (const m of list) {
    const role = m?.role || "user";
    const content = typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? "");
    if (!content) continue;
    if (role === "system") parts.push(content);
    else if (role === "user") parts.push(content);
    else parts.push(`${role}: ${content}`);
  }
  return parts.join("\n\n") || "Respond with an empty JSON array: []";
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, {
      ok: true,
      engine: "cursor-cli",
      model: MODEL,
      parallel: MAX_PARALLEL,
      bin: BIN,
      errorLog: ERROR_LOG_PATH,
    });
    return;
  }

  if (req.method === "GET" && (req.url === "/debug/errors" || req.url?.startsWith("/debug/errors?"))) {
    const u = new URL(req.url, `http://${HOST}:${PORT}`);
    const limit = Math.min(200, Math.max(1, Number(u.searchParams.get("limit") || 80)));
    json(res, 200, { ok: true, path: ERROR_LOG_PATH, entries: readBridgeErrors(limit) });
    return;
  }

  if (req.method === "POST" && req.url === "/debug/log") {
    try {
      const body = await readBody(req);
      const row = appendBridgeError({
        kind: body.kind || "unknown",
        message: String(body.message || "").slice(0, 500),
        source: body.source || "extension",
        engine: body.engine,
        host: body.host,
        itemCount: body.itemCount,
        status: body.status,
        t: body.t || Date.now(),
        via: "extension-mirror",
      });
      trimBridgeErrorLog();
      json(res, 200, { ok: true, entry: row, path: ERROR_LOG_PATH });
    } catch (err) {
      json(res, 400, { error: String(err.message || err) });
    }
    return;
  }

  // OpenAI-compatible chat completions (used by extension engine=cursor)
  if (req.method === "POST" && (req.url === "/v1/chat/completions" || req.url?.startsWith("/v1/chat/completions?"))) {
    try {
      const body = await readBody(req);
      const apiKey = bearerKey(req);
      const model = String(body.model || MODEL).trim() || MODEL;
      const prompt = messagesToPrompt(body.messages);
      if (MOCK) {
        json(res, 200, {
          id: "chatcmpl-mock",
          object: "chat.completion",
          model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify([{ id: "1", text: "译文：mock" }]),
              },
              finish_reason: "stop",
            },
          ],
        });
        return;
      }
      await acquire();
      let result;
      try {
        result = await runAgent(prompt, apiKey, model);
      } finally {
        release();
      }
      // Prefer extracted JSON array text so clients can parse reliably
      let content = result.text;
      try {
        content = JSON.stringify(extractJsonArray(result.text));
      } catch {
        /* keep raw text */
      }
      json(res, 200, {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
      });
    } catch (err) {
      const message = String(err.message || err);
      appendBridgeError({ message, source: "v1/chat/completions" });
      trimBridgeErrorLog();
      json(res, 502, { error: { message } });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/translate") {
    try {
      const body = await readBody(req);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) {
        json(res, 400, { error: "items[] required" });
        return;
      }
      const apiKey = bearerKey(req);
      const targetLang = body.targetLang || "zh-CN";
      if (MOCK) {
        json(res, 200, {
          items: items.map((x) => ({
            id: x.id,
            text: targetLang.startsWith("zh") ? `译文：${x.text}` : `[${targetLang}] ${x.text}`,
          })),
        });
        return;
      }
      await acquire();
      let raw;
      try {
        const result = await runAgent(
          buildPrompt(
            targetLang,
            items.map((x) => ({ id: String(x.id), text: String(x.text ?? "") })),
            body.glossary || [],
            body.page || {}
          ),
          apiKey
        );
        raw = extractJsonArray(result.text);
      } finally {
        release();
      }
      const byId = new Map(raw.map((r) => [String(r.id), String(r.text ?? "")]));
      json(res, 200, {
        items: items.map((x) => ({ id: x.id, text: byId.get(String(x.id)) ?? x.text })),
      });
    } catch (err) {
      const message = String(err.message || err);
      appendBridgeError({ message, source: "/translate" });
      trimBridgeErrorLog();
      json(res, 502, { error: message });
    }
    return;
  }
  json(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Page Bilingual Translate Cursor bridge  http://${HOST}:${PORT}${MOCK ? "  (mock)" : ""}`);
  console.log("Health: GET /health   Chat: POST /v1/chat/completions   Translate: POST /translate");
  console.log(`Errors: GET /debug/errors   POST /debug/log   file=${ERROR_LOG_PATH}`);
  console.log(MOCK ? "Mock mode: no Cursor CLI calls." : `Uses Cursor Agent CLI bin=${BIN} model=${MODEL} parallel=${MAX_PARALLEL}`);
});
