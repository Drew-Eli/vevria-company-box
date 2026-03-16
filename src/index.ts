import express from "express";
import { execSync, exec } from "child_process";
import fs from "fs";
import { config } from "./config.js";
import type { AssignInput, TaskInput, BoxState, BoxStatus, TaskResult } from "./types.js";
import { runAgent } from "./agent.js";

const app = express();
app.use(express.json());

// ── Box State ──────────────────────────────────────────────────────────

let state: BoxState = "warm";
let companyId: string | null = null;
let companySlug: string | null = null;
let currentModel: string = "anthropic/claude-sonnet-4";
let boxId: string = process.env.BOX_ID || `box-${Date.now()}`;
let currentTask: string | null = null;
let claudeMd: string = "";
let tasksCompleted = 0;
const startedAt = Date.now();

// ── Health ─────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ ok: true, state, company_id: companyId });
});

// ── Status ─────────────────────────────────────────────────────────────

app.get("/status", (_req, res) => {
  const status: BoxStatus = {
    state,
    company_id: companyId,
    slug: companySlug,
    current_task: currentTask,
    uptime_ms: Date.now() - startedAt,
    tasks_completed: tasksCompleted,
  };
  res.json(status);
});

// ── Assign ─────────────────────────────────────────────────────────────

app.post("/assign", async (req, res) => {
  const input = req.body as AssignInput;

  if (state !== "warm" && state !== "idle") {
    res.status(409).json({ error: `Cannot assign in state: ${state}` });
    return;
  }

  console.log(`[box] Assigning to company: ${input.slug} (${input.company_id})`);
  state = "assigned";
  companyId = input.company_id;
  companySlug = input.slug;
  currentModel = input.model || "anthropic/claude-sonnet-4";
  claudeMd = input.claude_md || "";

  try {
    // Clean workspace
    if (fs.existsSync("/workspace/.git")) {
      execSync("rm -rf /workspace/*  /workspace/.[!.]* 2>/dev/null || true", { cwd: "/" });
    }

    // Clone the company repo
    const token = input.github_token || config.githubToken;
    const repoUrl = input.repo_url || `https://x-access-token:${token}@github.com/${config.githubOrg}/company-${input.slug}.git`;

    console.log(`[box] Cloning repo...`);
    execSync(`git clone ${repoUrl} /workspace`, { timeout: 60000 });

    // Configure git
    execSync('git config user.email "agent@vevria.com"', { cwd: "/workspace" });
    execSync('git config user.name "Vevria CEO Agent"', { cwd: "/workspace" });

    // Set authenticated remote for pushing
    execSync(`git remote set-url origin ${repoUrl}`, { cwd: "/workspace" });

    // Write CLAUDE.md for the agent
    if (claudeMd) {
      fs.writeFileSync("/workspace/CLAUDE.md", claudeMd);
    }

    // Install deps if package.json exists
    if (fs.existsSync("/workspace/package.json")) {
      console.log(`[box] Running npm install...`);
      execSync("npm install", { cwd: "/workspace", timeout: 120000 });
    }

    console.log(`[box] Assignment complete, ready for tasks`);
    state = "idle";
    res.json({ status: "ready" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[box] Assignment failed: ${msg}`);
    state = "warm";
    companyId = null;
    companySlug = null;
    res.status(500).json({ error: msg });
  }
});

// ── Task ───────────────────────────────────────────────────────────────

app.post("/task", async (req, res) => {
  const input = req.body as TaskInput;

  if (!companyId || (state !== "idle" && state !== "assigned")) {
    res.status(409).json({ error: `Cannot accept task in state: ${state}` });
    return;
  }

  if (input.company_id !== companyId) {
    res.status(400).json({ error: `Box assigned to ${companyId}, not ${input.company_id}` });
    return;
  }

  console.log(`[box] Accepting task: ${input.title}`);
  state = "active";
  currentTask = input.title;

  // Respond immediately — run agent in background
  res.json({ task_id: input.task_id, status: "accepted" });

  // Set model for this task
  if (input.model) {
    process.env.ANTHROPIC_MODEL = input.model;
  }

  try {
    const result = await runAgent(input, claudeMd, boxId);
    tasksCompleted++;
    currentTask = null;
    state = "idle";

    // Report back to pool manager
    if (input.callback_url) {
      await reportResult(input.callback_url, result);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[box] Task execution error: ${msg}`);
    currentTask = null;
    state = "idle";

    if (input.callback_url) {
      await reportResult(input.callback_url, {
        task_id: input.task_id,
        company_id: input.company_id,
        box_id: boxId,
        status: "error",
        summary: `Box error: ${msg.slice(0, 300)}`,
        code_pushed: false,
        branch: "main",
        tokens_in: 0,
        tokens_out: 0,
        cost: 0,
        duration_ms: 0,
      });
    }
  }
});

// ── Release ────────────────────────────────────────────────────────────

app.post("/release", (_req, res) => {
  console.log(`[box] Releasing company ${companySlug}`);

  // Clean workspace
  try {
    execSync("rm -rf /workspace/* /workspace/.[!.]* 2>/dev/null || true", { cwd: "/" });
  } catch { /* ignore */ }

  state = "warm";
  companyId = null;
  companySlug = null;
  currentTask = null;
  claudeMd = "";

  res.json({ status: "released" });
});

// ── Helpers ────────────────────────────────────────────────────────────

async function reportResult(callbackUrl: string, result: TaskResult): Promise<void> {
  try {
    const resp = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    if (!resp.ok) {
      console.error(`[box] Callback failed: ${resp.status} ${resp.statusText}`);
    } else {
      console.log(`[box] Callback sent: ${result.status}`);
    }
  } catch (err) {
    console.error(`[box] Callback error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Start ──────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`[box] Company box listening on port ${config.port}`);
  console.log(`[box] State: ${state}`);
  console.log(`[box] OpenRouter: ${config.anthropicBaseUrl}`);
});
