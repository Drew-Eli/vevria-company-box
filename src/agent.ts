import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "child_process";
import type { TaskInput, TaskResult } from "./types.js";

/**
 * Run the CEO agent for a task using Claude Agent SDK.
 * The SDK has built-in Bash, Read, Write, Edit, Glob, Grep tools.
 * The agent can run OpenCode, git, npm, etc. via Bash.
 */
export async function runAgent(
  task: TaskInput,
  claudeMd: string,
  boxId: string
): Promise<TaskResult> {
  const startTime = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;
  let resultText = "";
  let codePushed = false;

  const prompt = buildPrompt(task);

  console.log(`[agent] Starting task: ${task.title}`);
  console.log(`[agent] Model: ${task.model}`);
  console.log(`[agent] Working directory: /workspace`);

  // Snapshot git HEAD before agent runs
  let headBefore = "";
  try {
    headBefore = execSync("git -C /workspace rev-parse HEAD 2>/dev/null || echo none", { encoding: "utf8" }).trim();
  } catch { /* ignore */ }

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: "/workspace",
        systemPrompt: {
          type: "preset" as const,
          preset: "claude_code" as const,
          append: claudeMd,
        },
        allowedTools: [
          "Bash",
          "Read",
          "Write",
          "Edit",
          "Glob",
          "Grep",
          "WebSearch",
          "WebFetch",
          "Task",
          "TaskOutput",
          "TodoWrite",
        ],
        permissionMode: "bypassPermissions" as const,
        allowDangerouslySkipPermissions: true,
      },
    })) {
      if (message.type === "result") {
        const msg = message as { result?: string; subtype?: string };
        resultText = msg.result || "";
        console.log(`[agent] Result: ${resultText.slice(0, 200)}`);
      }

      if (message.type === "assistant") {
        const msg = message as { message?: { usage?: { input_tokens?: number; output_tokens?: number } } };
        if (msg.message?.usage) {
          tokensIn += msg.message.usage.input_tokens || 0;
          tokensOut += msg.message.usage.output_tokens || 0;
        }
      }
    }

    // Check if code was pushed by comparing HEAD
    try {
      const headAfter = execSync("git -C /workspace rev-parse HEAD 2>/dev/null || echo none", { encoding: "utf8" }).trim();
      codePushed = headAfter !== headBefore && headAfter !== "none";
      // Also check if there are unpushed commits
      if (!codePushed) {
        const unpushed = execSync("git -C /workspace log origin/main..HEAD --oneline 2>/dev/null || echo ''", { encoding: "utf8" }).trim();
        if (unpushed) {
          // Agent committed but didn't push — push for it
          try {
            execSync("git -C /workspace push", { timeout: 30000 });
            codePushed = true;
            console.log("[agent] Auto-pushed unpushed commits");
          } catch { /* ignore push failure */ }
        }
      }
    } catch { /* ignore */ }

    const durationMs = Date.now() - startTime;
    console.log(
      `[agent] Task completed in ${(durationMs / 1000).toFixed(1)}s, ${tokensIn + tokensOut} tokens, pushed=${codePushed}`
    );

    return {
      task_id: task.task_id,
      company_id: task.company_id,
      box_id: boxId,
      status: "success",
      summary: resultText.slice(0, 500) || `Completed: ${task.title}`,
      code_pushed: codePushed,
      branch: "main",
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost: 0,
      duration_ms: durationMs,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Task failed: ${errorMsg}`);

    return {
      task_id: task.task_id,
      company_id: task.company_id,
      box_id: boxId,
      status: "error",
      summary: `Failed: ${errorMsg.slice(0, 300)}`,
      code_pushed: false,
      branch: "main",
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost: 0,
      duration_ms: Date.now() - startTime,
    };
  }
}

function buildPrompt(task: TaskInput): string {
  return `## Task: ${task.title}

${task.description}

## Instructions
1. Read the existing code in /workspace to understand the current state
2. Implement the task described above
3. After making changes, run \`npm install && npm run build\` to verify it compiles
4. Commit and push your changes:
   \`\`\`bash
   git add -A
   git commit -m "feat: ${task.title}"
   git push
   \`\`\`
5. Report what you did

## Current Kanban Board
${task.kanban_state || "No tasks loaded yet."}`;
}
