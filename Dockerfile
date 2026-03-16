FROM node:22-slim

RUN apt-get update && apt-get install -y \
    curl git \
    && rm -rf /var/lib/apt/lists/*

# Install OpenCode
RUN curl -fsSL https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-x64.tar.gz \
    | tar -xz -C /usr/local/bin/ opencode && chmod +x /usr/local/bin/opencode

# Install Claude Code CLI (used by agent SDK)
RUN npm install -g @anthropic-ai/claude-code

# App directory
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Workspace for company repos
RUN mkdir -p /workspace

# Own workspace as node user
RUN chown -R node:node /workspace /app

USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
