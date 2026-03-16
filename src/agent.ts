import { query } from "@anthropic-ai/claude-agent-sdk";
import fs from "fs";
import type { TaskInput, TaskResult } from "./types.js";

/**
 * Run the CEO agent for a task using Claude Agent SDK.
 * The SDK has built-in Bash, Read, Write, Edit, Glob, Grep tools.
 * The agent can run OpenCode, git, npm, etc. via Bash.
 */
export async function runAgent(
  task: TaskInput,
  claudeMd: string
): Promise<TaskResult> {
  const startTime = Date.now();
  let tokensUsed = 0;
  let resultText = "";
  let filesChanged = 0;

  const prompt = buildPrompt(task);

  console.log(`[agent] Starting task: ${task.title}`);
  console.log(`[agent] Model: ${task.model}`);
  console.log(`[agent] Working directory: /workspace`);

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

      // Track token usage from assistant messages
      if (message.type === "assistant") {
        const msg = message as { message?: { usage?: { input_tokens?: number; output_tokens?: number } } };
        if (msg.message?.usage) {
          tokensUsed += (msg.message.usage.input_tokens || 0) + (msg.message.usage.output_tokens || 0);
        }
      }
    }

    // Count changed files
    try {
      const gitStatus = await runBash("git status --porcelain", "/workspace");
      filesChanged = gitStatus.split("\n").filter((l) => l.trim()).length;
    } catch {
      filesChanged = 0;
    }

    console.log(
      `[agent] Task completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s, ${tokensUsed} tokens, ${filesChanged} files changed`
    );

    return {
      task_id: task.task_id,
      status: "completed",
      description: resultText.slice(0, 500) || `Completed: ${task.title}`,
      tokens_used: tokensUsed,
      cost: 0, // Pool manager calculates from token count
      files_changed: filesChanged,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Task failed: ${errorMsg}`);

    return {
      task_id: task.task_id,
      status: "failed",
      description: `Failed: ${errorMsg.slice(0, 300)}`,
      tokens_used: tokensUsed,
      cost: 0,
      files_changed: 0,
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

function runBash(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { exec } = require("child_process");
    exec(cmd, { cwd }, (err: Error | null, stdout: string, stderr: string) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}
