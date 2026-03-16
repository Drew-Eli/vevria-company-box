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
  box_id?: string;  // DB UUID from pool manager
}

export interface TaskResult {
  task_id: string;
  company_id: string;
  box_id: string;
  status: string;
  summary: string;
  code_pushed: boolean;
  branch: string;
  tokens_in: number;
  tokens_out: number;
  cost: number;
  duration_ms: number;
}

export interface BoxStatus {
  state: BoxState;
  company_id: string | null;
  slug: string | null;
  current_task: string | null;
  uptime_ms: number;
  tasks_completed: number;
}
