/**
 * Mock Pumble SDK bot client for E2E testing.
 *
 * Records all API calls so tests can assert on them.
 */

export interface SentMessage {
  channelId: string;
  text: string;
  blocks?: unknown[];
}

export interface AddedReaction {
  messageId: string;
  code: string;
}

export interface EditedMessage {
  messageId: string;
  channelId: string;
  text: string;
  blocks?: unknown[];
}

let messageIdCounter = 0;

export function createMockBotClient() {
  const sentMessages: SentMessage[] = [];
  const addedReactions: AddedReaction[] = [];
  const editedMessages: EditedMessage[] = [];
  const dmChannels = new Map<string, string>(); // userId -> channelId

  const client = {
    v1: {
      channels: {
        getDirectChannel: async (userIds: string[]) => {
          const userId = userIds[0]!;
          let channelId = dmChannels.get(userId);
          if (!channelId) {
            channelId = `dm_${userId}`;
            dmChannels.set(userId, channelId);
          }
          return { channel: { id: channelId, name: `DM with ${userId}` } };
        },
        listChannels: async () => [],
      },
      messages: {
        postMessageToChannel: async (channelId: string, msg: { text: string; blocks?: unknown[] }) => {
          const id = `msg_${++messageIdCounter}`;
          sentMessages.push({ channelId, text: msg.text, blocks: msg.blocks });
          return { id };
        },
        dmUser: async (userId: string, msg: { text: string }) => {
          sentMessages.push({ channelId: `dm_${userId}`, text: msg.text });
          return { id: `msg_${++messageIdCounter}` };
        },
        addReaction: async (messageId: string, reaction: { code: string }) => {
          addedReactions.push({ messageId, code: reaction.code });
        },
        editMessage: async (messageId: string, channelId: string, msg: { text: string; blocks?: unknown[] }) => {
          editedMessages.push({ messageId, channelId, text: msg.text, blocks: msg.blocks });
        },
      },
      users: {
        listUsers: async () => [],
      },
    },
  };

  return {
    client,
    sentMessages,
    addedReactions,
    editedMessages,
    dmChannels,
    reset() {
      sentMessages.length = 0;
      addedReactions.length = 0;
      editedMessages.length = 0;
      dmChannels.clear();
      messageIdCounter = 0;
    },
  };
}

export type MockBotClient = ReturnType<typeof createMockBotClient>['client'];
