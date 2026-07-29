/**
 * majik-message-file-validator.ts
 *
 * Validation rules specific to MajikMessageFile — context, storage type,
 * conversation/thread binding, storage-key (R2) shape. Same check/assert
 * dual-mode pattern as MajikFileValidator; composes it rather than
 * extending it, since these rules apply to a different layer of the data
 * (subclass-only fields), not a specialisation of the base rules.
 */

import { MajikFileError, MajikFileValidator } from "@majikah/majik-file";
import { FileContext, StorageType } from "./types";


const VALID_CONTEXTS: readonly FileContext[] = [
  "user_upload",
  "chat_attachment",
  "chat_image",
  "chat_voice",
  "thread_attachment",
];

/**
 * Contexts that require a conversationId. Centralised here (single source
 * of truth) instead of duplicated between create()-time validation and
 * validate()-time validation, as it was in the original SDK.
 */
const CONTEXTS_REQUIRING_CONVERSATION_ID: readonly FileContext[] = [
  "chat_image",
];

export class MajikMessageFileValidator {
  /** Re-exported so callers only need to import one validator for aggregation. */
  static assertAll = MajikFileValidator.assertAll;

  // ── context ──────────────────────────────────────────────────────────────

  static checkContext(context: unknown): string | null {
    return VALID_CONTEXTS.includes(context as FileContext)
      ? null
      : `context must be one of: ${VALID_CONTEXTS.join(" | ")} (got "${context}")`;
  }
  static assertContext(context: unknown): void {
    const err = this.checkContext(context);
    if (err) throw MajikFileError.invalidInput(err);
  }

  static contextRequiresConversationId(context: FileContext | null): boolean {
    return (
      context !== null && CONTEXTS_REQUIRING_CONVERSATION_ID.includes(context)
    );
  }

  static checkConversationIdRequired(
    context: FileContext | null,
    conversationId: string | null | undefined,
  ): string | null {
    if (!this.contextRequiresConversationId(context)) return null;
    return conversationId?.trim()
      ? null
      : `conversationId is required when context is "${context}"`;
  }
  static assertConversationIdRequired(
    context: FileContext | null,
    conversationId: string | null | undefined,
  ): void {
    const err = this.checkConversationIdRequired(context, conversationId);
    if (err) throw MajikFileError.invalidInput(err);
  }

  // ── chat/thread id mutual exclusion ─────────────────────────────────────

  static checkChatThreadMutualExclusion(
    chatMessageId: string | null,
    threadMessageId: string | null,
  ): string | null {
    return MajikFileValidator.checkMutuallyExclusive(
      chatMessageId,
      threadMessageId,
      "chat_message_id",
      "thread_message_id",
    );
  }
  static assertChatThreadMutualExclusion(
    chatMessageId: string | null,
    threadMessageId: string | null,
  ): void {
    const err = this.checkChatThreadMutualExclusion(
      chatMessageId,
      threadMessageId,
    );
    if (err) throw MajikFileError.invalidInput(err);
  }

  // ── storage type / expiry ───────────────────────────────────────────────

  static checkStorageType(type: unknown): string | null {
    return type === "permanent" || type === "temporary"
      ? null
      : `storage_type must be "permanent" or "temporary" (got "${type}")`;
  }
  static assertStorageType(type: unknown): void {
    const err = this.checkStorageType(type);
    if (err) throw MajikFileError.invalidInput(err);
  }

  static checkExpiresAtRequired(
    storageType: StorageType,
    expiresAt: string | null,
  ): string | null {
    return storageType === "temporary" && !expiresAt
      ? "expires_at is required for temporary files"
      : null;
  }
  static assertExpiresAtRequired(
    storageType: StorageType,
    expiresAt: string | null,
  ): void {
    const err = this.checkExpiresAtRequired(storageType, expiresAt);
    if (err) throw MajikFileError.invalidInput(err);
  }

  // ── storage key (R2) shape ──────────────────────────────────────────────

  /**
   * Platform-neutral name/behaviour — checks that a storage key starts with
   * the prefix expected for its storage class. Throws storageKeyMismatch()
   * rather than invalidInput() so callers can distinguish "malformed input"
   * from "data structurally inconsistent with its own metadata."
   */
  static checkStorageKeyPrefix(
    storageKey: string,
    expectedPrefix: string,
    label: string,
  ): string | null {
    return storageKey.startsWith(expectedPrefix)
      ? null
      : `${label} must start with "${expectedPrefix}"`;
  }
  static assertStorageKeyPrefix(
    storageKey: string,
    expectedPrefix: string,
    label: string,
  ): void {
    const err = this.checkStorageKeyPrefix(storageKey, expectedPrefix, label);
    if (err) throw MajikFileError.storageKeyMismatch(err);
  }
}