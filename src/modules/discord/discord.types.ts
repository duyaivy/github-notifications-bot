export interface DiscordSendMessageInput {
  channelId: string;
  content?: string;
  embeds?: DiscordEmbed[];
}

export interface DiscordEditMessageInput {
  channelId: string;
  messageId: string;
  content?: string;
  embeds?: DiscordEmbed[];
}

export interface DiscordMessage {
  id: string;
  channelId: string;
}

export interface DiscordCreateThreadInput {
  channelId: string;
  name: string;
}

export interface DiscordSendMessageBody {
  content?: string;
  embeds?: DiscordEmbed[];
  allowed_mentions: {
    parse: [];
  };
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  author?: {
    name: string;
  };
  fields?: DiscordEmbedField[];
  footer?: {
    text: string;
  };
  timestamp?: string;
}

export interface DiscordCreateThreadBody {
  name: string;
  auto_archive_duration: 10080;
  type: 11;
}

export interface DiscordThread {
  id: string;
  name: string;
  parentId?: string | null;
  archived?: boolean;
  locked?: boolean;
  archiveTimestamp?: string;
}

export interface DiscordChannelInfo {
  id: string;
  name: string;
  type: number;
  guildId?: string;
  parentId?: string | null;
}

export interface DiscordCreateGuildChannelInput {
  guildId: string;
  name: string;
  parentId?: string | null;
  topic?: string;
}
