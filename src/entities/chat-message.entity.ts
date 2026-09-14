/**
 * Chat Message Entity (AWS DynamoDB - Single-Table Design)
 * Table: `Interviews`
 * Partition Key (PK): `interview_id` (e.g. "intv_1725700000001")
 * Sort Key (SK): `MSG#<timestamp>#<msg_id>` (e.g. "MSG#2026-09-07T10:01:00Z#msg_001")
 * Entity Type: `MESSAGE`
 */

export type MessageSender = 'AI' | 'USER' | 'SYSTEM';

export type MessageType = 'QUESTION' | 'ANSWER' | 'HINT' | 'FEEDBACK' | 'SYSTEM';

export interface InterviewMessage {
  /** Partition Key: references the interview session */
  interview_id: string;
  /** Sort Key: MSG#<timestamp>#<msg_id> */
  sk: `MSG#${string}#${string}`;
  /** Discriminator */
  entity_type: 'MESSAGE';

  sender: MessageSender;
  content: string;
  message_type: MessageType;
  created_at: string; // ISO 8601
}

export interface SendMessageInput {
  interview_id: string;
  sender: MessageSender;
  content: string;
  message_type: MessageType;
}

export const MESSAGE_SK_PREFIX = 'MSG#' as const;

export function makeMessageSK(createdAtIso: string, messageId: string): `MSG#${string}#${string}` {
  return `${MESSAGE_SK_PREFIX}${createdAtIso}#${messageId}`;
}

export function isInterviewMessageEntity(item: { entity_type?: string }): item is InterviewMessage {
  return item.entity_type === 'MESSAGE';
}
