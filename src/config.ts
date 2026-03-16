export const config = {
  port: parseInt(process.env.PORT || "8080"),
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || "https://openrouter.ai/api/v1",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  githubToken: process.env.GITHUB_TOKEN || "",
  githubOrg: process.env.GITHUB_ORG || "Drew-Eli",
  vevriaApiUrl: process.env.VEVRIA_API_URL || "http://localhost:8080",
  callbackUrl: process.env.CALLBACK_URL || "",
};
