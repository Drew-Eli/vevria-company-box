export type BoxState = "warm" | "assigned" | "active" | "idle";

export interface AssignInput {
  company_id: string;
  slug: string;
  repo_url: string;
  github_token: string;
  model: string;
  claude_md: string;
  kanban_state: string;
}

export interface TaskInput {
  task_id: string;
  company_id: string;
  task_type: string;
  title: string;
  description: string;
  model: string;
  callback_url: string;
  kanban_state: string;
}

export interface TaskResult {
  task_id: string;
  status: "completed" | "failed";
  description: string;
  tokens_used: number;
  cost: number;
  files_changed: number;
}

export interface BoxStatus {
  state: BoxState;
  company_id: string | null;
  slug: string | null;
  current_task: string | null;
  uptime_ms: number;
  tasks_completed: number;
}
