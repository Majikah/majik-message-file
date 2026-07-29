/**
 * core/message/message-utils.ts
 *
 * Helpers specific to MajikMessageFile — R2 key construction and temporary-
 * file expiry. None of this belongs in the base MajikFile; a generic file
 * doesn't inherently know what "temporary storage" or an R2 bucket is.
 *
 * ⚠️ R2_PREFIX values below (PERMANENT, TEMPORARY) are INFERRED from JSDoc
 * in the original SDK, not confirmed against your real constants.ts.
 * CHAT_IMAGE is confirmed — the original JSDoc spelled out the exact
 * pattern ("images/chats/<conversationId>/<userId>_<fileHash>.mjkb").
 * Please replace PERMANENT/TEMPORARY with your actual values before this
 * ships anywhere near production R2 keys — a wrong prefix here would
 * silently misfile every new upload.
 */

import type { TempFileDuration } from "./types";

export const R2_PREFIX = {
  /** ⚠️ inferred — confirm against real constants.ts */
  PERMANENT: "files/permanent",
  /** ⚠️ inferred — confirm against real constants.ts */
  TEMPORARY: "files/public",
  /** confirmed via original JSDoc pattern */
  CHAT_IMAGE: "images/chats",
} as const;

// ─── R2 key builders ────────────────────────────────────────────────────────

export function buildPermanentR2Key(userId: string, fileHash: string): string {
  return `${R2_PREFIX.PERMANENT}/${userId}/${fileHash}.mjkb`;
}

/**
 * ⚠️ Duration-scoped subfolder is inferred (useful for R2 lifecycle rules
 * keyed per-TTL) — confirm this matches your actual temporary key layout.
 */
export function buildTemporaryR2Key(
  userId: string,
  fileHash: string,
  duration: TempFileDuration,
): string {
  return `${R2_PREFIX.TEMPORARY}/${duration}d/${userId}/${fileHash}.mjkb`;
}

export function buildChatImageR2Key(
  conversationId: string,
  userId: string,
  fileHash: string,
): string {
  return `${R2_PREFIX.CHAT_IMAGE}/${conversationId}/${userId}_${fileHash}.mjkb`;
}

// ─── Expiry ───────────────────────────────────────────────────────────────────

export function buildExpiryDate(days: TempFileDuration = 15): string {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

export function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}
