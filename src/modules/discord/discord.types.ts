export interface DiscordSendMessageInput {
  channelId: string;
  content?: string;
  embeds?: DiscordEmbed[];
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

export interface DiscordEmbed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  author?: {
    name: string;
  };
}

export interface DiscordCreateThreadBody {
  name: string;
  auto_archive_duration: 10080;
  type: 11;
}

export interface DiscordThread {
  id: string;
  name: string;
}
