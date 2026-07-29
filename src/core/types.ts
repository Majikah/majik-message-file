/**
 * core/types/message.ts
 *
 * Types specific to MajikMessageFile — the Majikah-messaging subclass of
 * MajikFile. Everything storage/context/binding related lives here, kept
 * fully separate from the platform-agnostic base types.
 */

import type { MajikKeyAddress } from "@majikah/majik-key";
import type {
  MajikFileJSON,
  MajikFileCreateOptions,
  MajikFileStats,
} from "@majikah/majik-file";

// ─── Domain Types ─────────────────────────────────────────────────────────────

export type FileContext =
  | "user_upload"
  | "chat_attachment"
  | "chat_image"
  | "chat_voice"
  | "thread_attachment";

export type StorageType = "permanent" | "temporary";

/** Allowed TTLs for temporary files in days. Maps 1:1 to R2 lifecycle prefixes. */
export type TempFileDuration = 1 | 2 | 3 | 5 | 7 | 15;

/** MajikMessageFile's kind discriminator — see MajikFileKind in base.ts. */
export type MajikMessageFileKind = "message_file";

// ─── MajikMessageFileJSON ─────────────────────────────────────────────────────

/**
 * Serialised representation of a MajikMessageFile. Extends the base
 * MajikFileJSON with everything storage/messaging-specific. Maps 1-to-1
 * with the `majikah.majik_files` Supabase table.
 */
export interface MajikMessageFileJSON extends Omit<MajikFileJSON, "kind"> {
  kind: string;
  /** R2 object key — unique path within the bucket. */
  r2_key: string;
  storage_type: StorageType;
  is_shared: boolean;
  /** Opaque token for shareable public links. Only meaningful when is_shared. */
  share_token: string | null;
  context: FileContext | null;
  /** Foreign key → majik_message_chat.id. */
  chat_message_id: string | null;
  /** Foreign key → majik_message_mail.id. */
  thread_message_id: string | null;
  /** Foreign key → majik_message_thread.id. */
  thread_id: string | null;
  /**
   * Conversation (channel / DM) ID. Required when context is "chat_image" —
   * used to scope the R2 key: images/chats/<conversationId>/<userId>_<fileHash>.mjkb
   */
  conversation_id: string | null;
  /** ISO-8601 expiry timestamp. Required for temporary files. */
  expires_at: string | null;
}

// ─── MajikMessageFileCreateOptions ────────────────────────────────────────────

export interface MajikMessageFileCreateOptions extends MajikFileCreateOptions {
  /** File context — affects storage routing and downstream UX. */
  context: FileContext;
  /**
   * If true, the file is stored under the temporary R2 prefix and
   * auto-deleted by the bucket lifecycle policy. Requires expiresAt.
   * @default false
   */
  isTemporary?: boolean;
  /** If true, a share_token can be generated to allow public access. @default false */
  isShared?: boolean;
  /** Temporary file duration in days. Required when isTemporary = true. */
  expiresAt?: TempFileDuration;
  chatMessageId?: string;
  threadMessageId?: string;
  threadId?: string;
  /** Required when context is "chat_image". */
  conversationId?: string;
}

// ─── MajikMessageFileStats ─────────────────────────────────────────────────────

export interface MajikMessageFileStats extends MajikFileStats {
  storageType: StorageType;
  context: FileContext | null;
  isShared: boolean;
  isExpired: boolean;
  expiresAt: string | null;
  r2Key: string;
}

// ─── Legacy (pre-refactor) shape ───────────────────────────────────────────────

/**
 * @deprecated Input type for MajikMessageFile.fromLegacyJSON() only. This is
 * the exact flat MajikFileJSON shape produced by the pre-refactor SDK —
 * `schema_version` and `kind` are absent by definition, which is precisely
 * what MajikFile.isLegacyJSON() checks for to trigger auto-migration.
 * Do not use this type for anything new.
 */
export interface LegacyMajikFileJSON {
  id: string;
  user_id: string;
  r2_key: string;
  original_name: string | null;
  mime_type: string | null;
  size_original: number;
  size_stored: number;
  file_hash: string;
  encryption_iv: string;
  storage_type: StorageType;
  is_shared: boolean;
  share_token: string | null;
  context: FileContext | null;
  chat_message_id: string | null;
  thread_message_id: string | null;
  thread_id: string | null;
  participants: MajikKeyAddress[];
  conversation_id: string | null;
  expires_at: string | null;
  timestamp: string | null;
  last_update: string | null;
  signature: string | null;
}