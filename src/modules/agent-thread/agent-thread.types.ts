export interface AgentThread {
  id: number;
  agentKey: string;
  discordChannelId: string;
  discordThreadId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentThreadConfig {
  githubChannelId: string;
  guildId?: string | undefined;
  agentChannelId?: string | undefined;
  agentChannelName: string;
}
