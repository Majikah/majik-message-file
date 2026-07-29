// majik-message-file.test.ts
//
// Refactored unit tests for the MajikMessageFile subclass.
// These tests exercise storage routing, chat/thread context bindings,
// storage type mutations, and legacy migrations.
//
// ALL CRYPTO IS REAL. Zero mocks are used. MajikFile inheritance and
// @noble/post-quantum (ML-KEM-768) implementations run purely in reality.
//
// ─────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll } from "vitest";

import { MajikMessageFile } from "../src/majik-message-file";
import {
  MajikFileError,
  FILE_SCHEMA_VERSION,
  CRYPTO_SUITE,
  type MajikFileIdentity,
  type MajikFileRecipient,
} from "@majikah/majik-file";
import type {
  MajikMessageFileJSON,
  LegacyMajikFileJSON,
} from "../src/core/types";

import type { MajikKey } from "@majikah/majik-key";
import { getTestKey } from "./helpers/crypto";

const CRYPTO_TIMEOUT = 60_000;

// ── TEST HELPERS ─────────────────────────────────────────────────────────────

interface TestFileUser {
  identity: MajikFileIdentity;
  recipient: MajikFileRecipient;
}

/** Generates real ML-KEM-768 identities and recipients */
async function createTestFileUser(): Promise<TestFileUser> {
  const keys = await getTestKey();
  return {
    identity: {
      publicKey: keys.publicKeyBase64,
      fingerprint: keys.fingerprint,
      mlKemPublicKey: keys.mlKemPublicKey,
      mlKemSecretKey: keys.mlKemSecretKey!,
    },
    recipient: {
      fingerprint: keys.fingerprint,
      publicKey: keys.publicKeyBase64,
      mlKemPublicKey: keys.mlKemPublicKey,
    },
  };
}

const DUMMY_DATA = new TextEncoder().encode(
  "Hello, Majikah Cloud! This payload is encrypted via post-quantum crypto.",
);
const USER_ID = "auth-user-alice-uuid-12345";

// ── TEST SUITE ───────────────────────────────────────────────────────────────

describe("MajikMessageFile Class Unit Tests", () => {
  let alice: TestFileUser;
  let bob: TestFileUser;
  let signerKeyA: MajikKey;

  beforeAll(async () => {
    [alice, bob, signerKeyA] = await Promise.all([
      createTestFileUser(),
      createTestFileUser(),
      getTestKey(),
    ]);
  }, CRYPTO_TIMEOUT * 5);

  // ── 1. CREATE() VALIDATION ───────────────────────────────────────────────
  describe("create() — input validation", () => {
    it("should reject when userId is missing", async () => {
      await expect(
        MajikMessageFile.create({
          data: DUMMY_DATA,
          userId: "   ",
          identity: alice.identity,
          context: "user_upload",
        }),
      ).rejects.toThrow(/userId is required/i);
    });

    it("should reject an unrecognised context value", async () => {
      await expect(
        MajikMessageFile.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          context: "not_a_real_context" as any,
        }),
      ).rejects.toThrow(/context must be one of/i);
    });

    it("should reject context 'chat_image' without conversationId", async () => {
      await expect(
        MajikMessageFile.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          context: "chat_image",
        }),
      ).rejects.toThrow(/conversationId is required/i);
    });

    it("should reject chatMessageId + threadMessageId set together", async () => {
      await expect(
        MajikMessageFile.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          context: "user_upload",
          chatMessageId: "chat-msg-1",
          threadMessageId: "thread-msg-1",
        }),
      ).rejects.toThrow(/cannot both be set/i);
    });

    it("should reject isTemporary without expiresAt", async () => {
      await expect(
        MajikMessageFile.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          context: "user_upload",
          isTemporary: true,
          expiresAt: undefined,
        }),
      ).rejects.toThrow(/expiresAt is required for temporary files/i);
    });
  });

  // ── 2. QUICK-CREATE WRAPPERS ─────────────────────────────────────────────
  describe("Quick-create wrappers", () => {
    it(
      "createChatImage() should succeed for a valid image",
      async () => {
        const file = await MajikMessageFile.createChatImage({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          conversationId: "conv-123",
          mimeType: "image/png",
          originalName: "avatar.png",
        });
        expect(file.context).toBe("chat_image");
        expect(file.conversationId).toBe("conv-123");
        expect(file.storageType).toBe("permanent");
      },
      CRYPTO_TIMEOUT,
    );

    it("createChatImage() should reject a non-image mimeType", async () => {
      await expect(
        MajikMessageFile.createChatImage({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          conversationId: "conv-123",
          mimeType: "application/pdf",
        }),
      ).rejects.toThrow(/mimeType must be an image/i);
    });

    it("createChatImage() should reject files over the 25MB chat-image limit", async () => {
      const oversized = new Uint8Array(25 * 1024 * 1024 + 1);
      await expect(
        MajikMessageFile.createChatImage({
          data: oversized,
          userId: USER_ID,
          identity: alice.identity,
          conversationId: "conv-123",
          mimeType: "image/png",
        }),
      ).rejects.toThrow(/exceeds the.*limit/i);
    });

    it(
      "createChatAttachment() should create an unattached chat attachment when conversationId is omitted",
      async () => {
        const file = await MajikMessageFile.createChatAttachment({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          chatMessageId: "chat-msg-1",
          originalName: "doc.txt",
          mimeType: "text/plain",
        });

        expect(file.context).toBe("chat_attachment");
        expect(file.chatMessageId).toBe("chat-msg-1");
        expect(file.conversationId).toBeNull();
      },
      CRYPTO_TIMEOUT,
    );

    it(
      "createThreadAttachment() should succeed without a conversationId",
      async () => {
        const file = await MajikMessageFile.createThreadAttachment({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          threadId: "thread-1",
          originalName: "memo.txt",
          mimeType: "text/plain",
        });
        expect(file.context).toBe("thread_attachment");
        expect(file.threadId).toBe("thread-1");
      },
      CRYPTO_TIMEOUT,
    );

    it(
      "createUserUpload() should succeed and respect isShared",
      async () => {
        const file = await MajikMessageFile.createUserUpload({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          originalName: "notes.txt",
          isShared: true,
        });
        expect(file.context).toBe("user_upload");
        expect(file.storageType).toBe("permanent");
        expect(file.isShared).toBe(true);
      },
      CRYPTO_TIMEOUT,
    );

    it(
      "createTemporaryUpload() should default to a 15-day duration",
      async () => {
        const file = await MajikMessageFile.createTemporaryUpload({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
        });
        expect(file.storageType).toBe("temporary");
        expect(file.expiresAt).not.toBeNull();

        const days =
          (new Date(file.expiresAt!).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24);
        expect(days).toBeGreaterThan(14.9);
        expect(days).toBeLessThan(15.1);
      },
      CRYPTO_TIMEOUT,
    );

    it(
      "createTemporaryUpload() should respect a custom duration",
      async () => {
        const file = await MajikMessageFile.createTemporaryUpload({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          duration: 3,
        });
        const days =
          (new Date(file.expiresAt!).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24);
        expect(days).toBeGreaterThan(2.9);
        expect(days).toBeLessThan(3.1);
      },
      CRYPTO_TIMEOUT,
    );
  });

  // ── 3. STORAGE TYPE, SHARING, EXPIRY ─────────────────────────────────────
  describe("Storage type mutation, sharing, and expiry", () => {
    it(
      "setTemporary() / setPermanent() should toggle storage type and R2 key",
      async () => {
        const file = await MajikMessageFile.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          context: "user_upload",
        });
        expect(file.storageType).toBe("permanent");
        const permKey = file.r2Key;

        file.setTemporary(7);
        expect(file.storageType).toBe("temporary");
        expect(file.r2Key).not.toBe(permKey);
        expect(file.expiresAt).not.toBeNull();

        file.setPermanent();
        expect(file.storageType).toBe("permanent");
        expect(file.expiresAt).toBeNull();
      },
      CRYPTO_TIMEOUT,
    );

    it(
      "setStorageType() should refuse to mutate chat_image files",
      async () => {
        const file = await MajikMessageFile.createChatImage({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          conversationId: "conv-1",
          mimeType: "image/png",
        });
        expect(() => file.setPermanent()).toThrow(
          /chat_image files are conversation-scoped/i,
        );
      },
      CRYPTO_TIMEOUT,
    );

    it(
      "toggleSharing() should turn sharing on (auto token) and off (clears token)",
      async () => {
        const file = await MajikMessageFile.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          context: "user_upload",
        });
        expect(file.hasShareToken).toBe(false);

        const token = file.toggleSharing();
        expect(token).toBeTruthy();
        expect(file.isShared).toBe(true);
        expect(file.hasShareToken).toBe(true);

        const cleared = file.toggleSharing();
        expect(cleared).toBeNull();
        expect(file.isShared).toBe(false);
        expect(file.hasShareToken).toBe(false);
      },
      CRYPTO_TIMEOUT,
    );

    it(
      "toggleSharing() should accept an explicit token and reject a blank one",
      async () => {
        const file = await MajikMessageFile.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          context: "user_upload",
        });
        const token = file.toggleSharing("custom-token-abc");
        expect(token).toBe("custom-token-abc");

        file.toggleSharing(); // turn off
        expect(() => file.toggleSharing("   ")).toThrow(
          /token must be a non-empty string/i,
        );
      },
      CRYPTO_TIMEOUT,
    );

    it("isExpired / isTemporary should strictly reflect the stored expiry date", () => {
      const baseJson = {
        id: "id-1",
        schema_version: FILE_SCHEMA_VERSION,
        kind: "message_file",
        user_id: USER_ID,
        r2_key: "files/public/15/x_y.mjkb",
        original_name: null,
        mime_type: null,
        size_original: 10,
        size_stored: 20,
        file_hash: "abc",
        encryption_iv: "abc",
        kem_alg: CRYPTO_SUITE.kemAlg,
        cipher_alg: CRYPTO_SUITE.cipherAlg,
        is_shared: false,
        share_token: null,
        context: "user_upload",
        chat_message_id: null,
        thread_message_id: null,
        thread_id: null,
        participants: [],
        conversation_id: null,
        timestamp: new Date().toISOString(),
        last_update: new Date().toISOString(),
        signature: null,
      } as unknown as MajikMessageFileJSON;

      const expired = MajikMessageFile.fromJSON({
        ...baseJson,
        storage_type: "temporary",
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
      expect(expired.isExpired).toBe(true);
      expect(expired.isTemporary).toBe(true);

      const notExpired = MajikMessageFile.fromJSON({
        ...baseJson,
        storage_type: "temporary",
        expires_at: new Date(Date.now() + 1_000_000).toISOString(),
      });
      expect(notExpired.isExpired).toBe(false);

      const permanent = MajikMessageFile.fromJSON({
        ...baseJson,
        storage_type: "permanent",
        expires_at: null,
      });
      expect(permanent.isExpired).toBe(false);
      expect(permanent.isTemporary).toBe(false);
    });
  });

  // ── 4. THREAD / CHAT BINDINGS ────────────────────────────────────────────
  describe("bindToThreadMail() / bindToChatConversation()", () => {
    it(
      "bindToThreadMail() should succeed exactly once for a thread_attachment file",
      async () => {
        const file = await MajikMessageFile.createThreadAttachment({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          threadId: "thread-1",
        });
        expect(file.threadMessageId).toBeNull();

        file.bindToThreadMail("thread-1", "thread-msg-1");
        expect(file.threadId).toBe("thread-1");
        expect(file.threadMessageId).toBe("thread-msg-1");

        expect(() => file.bindToThreadMail("thread-2", "thread-msg-2")).toThrow(
          /already bound to a thread mail/i,
        );
      },
      CRYPTO_TIMEOUT,
    );

    it(
      "bindToThreadMail() should reject the wrong context",
      async () => {
        const file = await MajikMessageFile.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          context: "user_upload",
        });
        expect(() => file.bindToThreadMail("t", "m")).toThrow(
          /only thread_attachment files can be bound/i,
        );
      },
      CRYPTO_TIMEOUT,
    );

    it("bindToChatConversation() should bind cleanly on an unattached chat_attachment hydrated from JSON", () => {
      const unattachedChatJson = {
        id: "65629544-ea98-41ed-9c32-2a42a06bc904",
        schema_version: FILE_SCHEMA_VERSION,
        kind: "message_file",
        user_id: USER_ID,
        r2_key: "files/unattached/x_y.mjkb",
        context: "chat_attachment",
        storage_type: "permanent",
        chat_message_id: null,
        conversation_id: null,
        thread_id: null,
        thread_message_id: null,
        original_name: "doc.txt",
        mime_type: "text/plain",
        size_original: DUMMY_DATA.length,
        size_stored: 1024,
        file_hash:
          "2c3506cb925e11cc13a9a69c5bd0fafe56559bd9ce2ef1d7bde00487abf47098",
        encryption_iv: "39e9bfd62ae2317474e35a67",
        kem_alg: CRYPTO_SUITE.kemAlg,
        cipher_alg: CRYPTO_SUITE.cipherAlg,
        is_shared: false,
        share_token: null,
        expires_at: null,
        participants: [alice.recipient.fingerprint],
        timestamp: new Date().toISOString(),
        last_update: new Date().toISOString(),
        signature: null,
      } as MajikMessageFileJSON;

      const hydrated = MajikMessageFile.fromJSON(unattachedChatJson);

      hydrated.bindToChatConversation("conv-99", "chat-msg-99");
      expect(hydrated.conversationId).toBe("conv-99");
      expect(hydrated.chatMessageId).toBe("chat-msg-99");

      expect(() =>
        hydrated.bindToChatConversation("conv-other", "chat-msg-other"),
      ).toThrow(/already bound to a chat conversation/i);
    });
    it(
      "bindToChatConversation() should reject the wrong context",
      async () => {
        const file = await MajikMessageFile.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          context: "user_upload",
        });
        expect(() => file.bindToChatConversation("c", "m")).toThrow(
          /only chat_attachment files can be bound/i,
        );
      },
      CRYPTO_TIMEOUT,
    );
  });

  // ── 5. SERIALIZATION: toJSON() / fromJSON() / fromLegacyJSON() ──────────
  describe("Serialization and legacy migration", () => {
    let originalFile: MajikMessageFile;

    beforeAll(async () => {
      originalFile = await MajikMessageFile.create({
        data: DUMMY_DATA,
        userId: USER_ID,
        identity: alice.identity,
        context: "user_upload",
        originalName: "backup-archive.zip",
        mimeType: "application/zip",
      });
    }, CRYPTO_TIMEOUT);

    it("toJSON() should yield a complete MajikMessageFileJSON structure", () => {
      const json = originalFile.toJSON();
      expect(json.kind).toBe("message_file");
      expect(json.r2_key).toBeDefined();
      expect(json.storage_type).toBe("permanent");
      expect(json.context).toBe("user_upload");
      expect(json.is_shared).toBe(false);
      expect(json.schema_version).toBe(FILE_SCHEMA_VERSION);
    });

    it("fromJSON() should hydrate a metadata-only MajikMessageFile", () => {
      const restored = MajikMessageFile.fromJSON(originalFile.toJSON());
      expect(restored).toBeInstanceOf(MajikMessageFile);
      expect(restored.hasBinary).toBe(false);
      expect(restored.context).toBe("user_upload");
    });

    it("fromJSON() should transparently migrate a LegacyMajikFileJSON flat record", () => {
      const legacyJson: LegacyMajikFileJSON = {
        id: "legacy-id",
        user_id: USER_ID,
        r2_key: "files/legacy.mjkb",
        original_name: "old.txt",
        mime_type: "text/plain",
        size_original: 10,
        size_stored: 20,
        file_hash: "hash",
        encryption_iv: "iv",
        storage_type: "permanent",
        is_shared: false,
        share_token: null,
        context: "chat_attachment",
        chat_message_id: "chat-1",
        thread_message_id: null,
        thread_id: null,
        participants: [],
        conversation_id: "conv-1",
        expires_at: null,
        timestamp: new Date().toISOString(),
        last_update: new Date().toISOString(),
        signature: null,
      };

      expect(MajikMessageFile.isLegacyJSON(legacyJson)).toBe(true);

      const restored = MajikMessageFile.fromJSON(legacyJson);
      const outputJson = restored.toJSON();

      expect(outputJson.schema_version).toBe(FILE_SCHEMA_VERSION);
      expect(outputJson.kind).toBe("message_file");
      expect(outputJson.kem_alg).toBe(CRYPTO_SUITE.kemAlg);
      expect(restored.chatMessageId).toBe("chat-1");
    });

    it("fromJSON() should reject invalid row records", () => {
      const badJson = { ...originalFile.toJSON(), user_id: "" };
      expect(() => MajikMessageFile.fromJSON(badJson as any)).toThrow(
        MajikFileError,
      );
    });
  });

  // ── 6. CRYPTO INHERITANCE (Sanity Checks) ──────────────────────────────
  describe("Cryptography & Base inheritance bounds (sanity checks)", () => {
    it(
      "should decrypt and retrieve original bytes utilizing real keys",
      async () => {
        const file = await MajikMessageFile.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          recipients: [bob.recipient],
          context: "user_upload",
        });

        expect(file.isGroup).toBe(true);

        const decryptedAlice = await file.decryptBinary(alice.identity);
        const decryptedBob = await file.decryptBinary(bob.identity);

        expect(new TextDecoder().decode(decryptedAlice)).toBe(
          "Hello, Majikah Cloud! This payload is encrypted via post-quantum crypto.",
        );
        expect(new TextDecoder().decode(decryptedBob)).toBe(
          "Hello, Majikah Cloud! This payload is encrypted via post-quantum crypto.",
        );
      },
      CRYPTO_TIMEOUT,
    );

    it(
      "getStats() should append message-specific statistics",
      async () => {
        const file = await MajikMessageFile.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          context: "user_upload",
        });
        const stats = file.getStats();
        expect(stats.storageType).toBe("permanent");
        expect(stats.context).toBe("user_upload");
        expect(stats.r2Key).toContain("files/");
        expect(stats.isShared).toBe(false);
        expect(stats.isExpired).toBe(false);
      },
      CRYPTO_TIMEOUT,
    );
  });
});
