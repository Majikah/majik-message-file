import {
  generateUUID,
  inferMimeTypeFromFilename,
  convertImageToWebP,
  arrayToBase64,
  MajikFile,
  MajikFileValidator,
  MajikFileError,
  FILE_SCHEMA_VERSION,
  CRYPTO_SUITE,
  MajikFileIdentity,
  MajikFileRecipient,
  MajikFileJSON,
} from "@majikah/majik-file";
import {
  R2_PREFIX,
  buildPermanentR2Key,
  buildTemporaryR2Key,
  buildChatImageR2Key,
  buildExpiryDate,
  isExpired,
} from "./core/utils";
import type {
  FileContext,
  StorageType,
  TempFileDuration,
  MajikMessageFileJSON,
  MajikMessageFileCreateOptions,
  MajikMessageFileStats,
  LegacyMajikFileJSON,
} from "./core/types";

import type { MajikKey } from "@majikah/majik-key";
import { MajikMessageFileValidator } from "./core/validator";

/**
 * Opaque payload MajikMessageFile hands to the base `_preProcess()` hook
 * via `EncryptCoreInput.preProcessExtra` — see MajikFile's class-level doc
 * comment on the hook dispatch mechanism.
 */
interface MessagePreProcessExtra {
  context: FileContext;
}

/**
 * MajikMessageFile
 * ----------------
 * The Majikah-messaging MajikFile: everything storage/context/binding
 * related. Composes the base crypto pipeline (`_encryptCore()`) rather
 * than inheriting `create()` — this class has its own extra fields to
 * layer on afterward. See MajikFile's class-level doc comment for the
 * extensibility design (hooks, sealing, versioning).
 *
 * ⚠️ R2_PREFIX values in core/message/message-utils.ts are partially
 * inferred, not confirmed — see that file's header comment.
 */
export class MajikMessageFile extends MajikFile {
  protected _r2Key: string;
  protected _storageType: StorageType;
  protected _isShared: boolean;
  protected _shareToken: string | null;
  protected readonly _context: FileContext | null;
  protected _chatMessageId: string | null;
  protected _threadMessageId: string | null;
  protected _threadId: string | null;
  protected _conversationId: string | null;
  protected _expiresAt: string | null;

  protected constructor(
    json: MajikMessageFileJSON,
    binary: Uint8Array | null,
    isGroup: boolean,
  ) {
    super(json, binary, isGroup);
    this._r2Key = json.r2_key;
    this._storageType = json.storage_type;
    this._isShared = json.is_shared;
    this._shareToken = json.share_token;
    this._context = json.context;
    this._chatMessageId = json.chat_message_id;
    this._threadMessageId = json.thread_message_id;
    this._threadId = json.thread_id;
    this._conversationId = json.conversation_id;
    this._expiresAt = json.expires_at;
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get r2Key(): string {
    return this._r2Key;
  }
  get storageType(): StorageType {
    return this._storageType;
  }
  get isShared(): boolean {
    return this._isShared;
  }
  get shareToken(): string | null {
    return this._shareToken;
  }
  get context(): FileContext | null {
    return this._context;
  }
  get chatMessageId(): string | null {
    return this._chatMessageId;
  }
  get threadMessageId(): string | null {
    return this._threadMessageId;
  }
  get threadId(): string | null {
    return this._threadId;
  }
  get conversationId(): string | null {
    return this._conversationId;
  }
  get expiresAt(): string | null {
    return this._expiresAt;
  }
  get hasShareToken(): boolean {
    return this._shareToken !== null && this._shareToken.length > 0;
  }
  get isExpired(): boolean {
    return isExpired(this._expiresAt);
  }
  get isTemporary(): boolean {
    return this._storageType === "temporary";
  }

  // ── EXTENSIBILITY HOOK OVERRIDE ──────────────────────────────────────────

  /**
   * Convert to WebP for image files in chat_image (always) or
   * chat_attachment (when the attached file happens to be an image)
   * contexts. Mirrors the original create() pipeline's step 2, just moved
   * into the overridable hook so the base crypto pipeline stays
   * context-agnostic. `extra` is cast back from the `unknown` bag passed
   * through `_encryptCore` — see MessagePreProcessExtra above.
   */
  protected static async _preProcess(
    raw: Uint8Array,
    mimeType: string | null,
    extra?: unknown,
  ): Promise<{ bytes: Uint8Array; mimeType: string | null }> {
    const context = (extra as MessagePreProcessExtra | undefined)?.context;
    const isImage = mimeType?.startsWith("image/") ?? false;
    const shouldConvert =
      isImage && (context === "chat_image" || context === "chat_attachment");

    if (!shouldConvert || !mimeType) return { bytes: raw, mimeType };
    return convertImageToWebP(raw, mimeType);
  }

  // ── CREATE ────────────────────────────────────────────────────────────────

  static async create(
    options: MajikMessageFileCreateOptions,
  ): Promise<MajikMessageFile> {
    const {
      data,
      identity,
      recipients = [],
      originalName = null,
      mimeType: rawMimeType = null,
      isTemporary = false,
      isShared = false,
      id = generateUUID(),
      bypassSizeLimit = false,
      expiresAt,
      chatMessageId = null,
      threadMessageId = null,
      threadId = null,
      conversationId = null,
      userId,
      compressionLevel,
      context,
    } = options;

    MajikFileValidator.assertUserId(userId);
    if (!identity) throw MajikFileError.invalidInput("identity is required");
    MajikMessageFileValidator.assertContext(context);
    MajikMessageFileValidator.assertConversationIdRequired(
      context,
      conversationId,
    );
    MajikMessageFileValidator.assertChatThreadMutualExclusion(
      chatMessageId,
      threadMessageId,
    );
    if (isTemporary && !expiresAt) {
      throw MajikFileError.invalidInput(
        "expiresAt is required for temporary files. Use MajikMessageFile.buildExpiryDate() to generate one.",
      );
    }

    const mimeType =
      rawMimeType ??
      (originalName ? inferMimeTypeFromFilename(originalName) : null);

    // `this` here is MajikMessageFile (static method invoked on this
    // class), so _encryptCore's internal `this._preProcess(...)` call
    // dispatches to the override above — see MajikFile's class doc.
    const core = await this._encryptCore({
      data,
      identity,
      recipients,
      originalName,
      mimeType,
      bypassSizeLimit,
      compressionLevel,
      preProcessExtra: { context } satisfies MessagePreProcessExtra,
    });

    let r2Key: string;
    if (context === "chat_image") {
      r2Key = buildChatImageR2Key(conversationId!, userId, core.fileHash);
    } else if (isTemporary) {
      r2Key = buildTemporaryR2Key(userId, core.fileHash, expiresAt!);
    } else {
      r2Key = buildPermanentR2Key(userId, core.fileHash);
    }

    const now = new Date().toISOString();
    const json: MajikMessageFileJSON = {
      id,
      schema_version: FILE_SCHEMA_VERSION,
      kind: "message_file",
      user_id: userId,
      original_name: originalName,
      mime_type: core.resolvedMimeType,
      size_original: core.sizeOriginal,
      size_stored: core.sizeStored,
      file_hash: core.fileHash,
      encryption_iv: core.ivHex,
      participants: core.participants,
      kem_alg: CRYPTO_SUITE.kemAlg,
      cipher_alg: CRYPTO_SUITE.cipherAlg,
      timestamp: now,
      last_update: now,
      signature: null,
      r2_key: r2Key,
      storage_type: isTemporary ? "temporary" : "permanent",
      is_shared: isShared,
      share_token: null,
      context,
      chat_message_id: chatMessageId,
      thread_message_id: threadMessageId,
      thread_id: threadId,
      conversation_id: conversationId,
      expires_at: isTemporary ? buildExpiryDate(expiresAt) : null,
    };

    const instance = new MajikMessageFile(json, core.binary, core.isGroup);
    instance._validateCreate();
    return instance._sealInstance();
  }

  static async createAndSign(
    options: MajikMessageFileCreateOptions,
    key: MajikKey,
    signOptions?: { contentType?: string; timestamp?: string },
  ): Promise<MajikMessageFile> {
    const file = await MajikMessageFile.create(options);
    await file.sign(key, signOptions);
    return file;
  }

  // ── QUICK-CREATE WRAPPERS ─────────────────────────────────────────────────

  static async createChatImage(options: {
    data: Uint8Array | ArrayBuffer;
    userId: string;
    identity: MajikFileIdentity;
    conversationId: string;
    mimeType: string;
    originalName?: string;
    recipients?: MajikFileRecipient[];
    chatMessageId?: string;
  }): Promise<MajikMessageFile> {
    const raw =
      options.data instanceof Uint8Array
        ? options.data
        : new Uint8Array(options.data);

    if (!options.mimeType?.startsWith("image/")) {
      throw MajikFileError.invalidInput(
        `createChatImage: mimeType must be an image/* type (got "${options.mimeType}")`,
      );
    }
    const CHAT_IMAGE_MAX = 25 * 1024 * 1024; // 25 MB
    if (raw.byteLength > CHAT_IMAGE_MAX) {
      throw MajikFileError.sizeExceeded(raw.byteLength, CHAT_IMAGE_MAX);
    }

    return MajikMessageFile.create({
      data: raw,
      userId: options.userId,
      identity: options.identity,
      context: "chat_image",
      conversationId: options.conversationId,
      mimeType: options.mimeType,
      originalName: options.originalName,
      recipients: options.recipients ?? [],
      chatMessageId: options.chatMessageId,
      isTemporary: false,
    });
  }

  static async createChatAttachment(options: {
    data: Uint8Array | ArrayBuffer;
    userId: string;
    identity: MajikFileIdentity;
    chatMessageId: string;
    originalName?: string;
    mimeType?: string;
    recipients?: MajikFileRecipient[];
  }): Promise<MajikMessageFile> {
    return MajikMessageFile.create({
      data: options.data,
      userId: options.userId,
      identity: options.identity,
      context: "chat_attachment",
      chatMessageId: options.chatMessageId,
      originalName: options.originalName,
      mimeType: options.mimeType,
      recipients: options.recipients ?? [],
      isTemporary: false,
    });
  }

  static async createThreadAttachment(options: {
    data: Uint8Array | ArrayBuffer;
    userId: string;
    identity: MajikFileIdentity;
    threadId: string;
    threadMessageId?: string;
    originalName?: string;
    mimeType?: string;
    recipients?: MajikFileRecipient[];
  }): Promise<MajikMessageFile> {
    return MajikMessageFile.create({
      data: options.data,
      userId: options.userId,
      identity: options.identity,
      context: "thread_attachment",
      threadId: options.threadId,
      threadMessageId: options.threadMessageId,
      originalName: options.originalName,
      mimeType: options.mimeType,
      recipients: options.recipients ?? [],
      isTemporary: false,
    });
  }

  static async createUserUpload(options: {
    data: Uint8Array | ArrayBuffer;
    userId: string;
    identity: MajikFileIdentity;
    originalName?: string;
    mimeType?: string;
    isShared?: boolean;
    recipients?: MajikFileRecipient[];
  }): Promise<MajikMessageFile> {
    return MajikMessageFile.create({
      data: options.data,
      userId: options.userId,
      identity: options.identity,
      context: "user_upload",
      originalName: options.originalName,
      mimeType: options.mimeType,
      isShared: options.isShared ?? false,
      recipients: options.recipients ?? [],
      isTemporary: false,
    });
  }

  /** @param duration Days until expiry. Defaults to 15. */
  static async createTemporaryUpload(options: {
    data: Uint8Array | ArrayBuffer;
    userId: string;
    identity: MajikFileIdentity;
    originalName?: string;
    mimeType?: string;
    duration?: TempFileDuration;
    recipients?: MajikFileRecipient[];
  }): Promise<MajikMessageFile> {
    const duration = options.duration ?? 15;
    return MajikMessageFile.create({
      data: options.data,
      userId: options.userId,
      identity: options.identity,
      context: "user_upload",
      originalName: options.originalName,
      mimeType: options.mimeType,
      recipients: options.recipients ?? [],
      isTemporary: true,
      expiresAt: duration,
    });
  }

  // ── BINDING ──────────────────────────────────────────────────────────────

  /**
   * Bind this file to a thread mail after initial creation. Can only be
   * called once — IDs are immutable once set.
   */
  bindToThreadMail(threadId: string, threadMessageId: string): void {
    if (this._context !== "thread_attachment") {
      throw MajikFileError.invalidInput(
        "bindToThreadMail: only thread_attachment files can be bound to a mail",
      );
    }
    if (!threadId?.trim()) {
      throw MajikFileError.invalidInput(
        "bindToThreadMail: threadId is required",
      );
    }
    if (!threadMessageId?.trim()) {
      throw MajikFileError.invalidInput(
        "bindToThreadMail: threadMessageId is required",
      );
    }
    if (this._threadMessageId) {
      throw MajikFileError.invalidInput(
        "bindToThreadMail: this file is already bound to a thread mail — IDs are immutable once set",
      );
    }
    if (this._threadId && this._threadId !== threadId) {
      throw MajikFileError.invalidInput(
        "bindToThreadMail: this file is already bound to a different thread mail",
      );
    }

    this._threadId = threadId;
    this._threadMessageId = threadMessageId;
    this._lastUpdate = new Date().toISOString();
  }

  /**
   * Bind this file to a chat conversation after initial creation. Can only
   * be called once — IDs are immutable once set.
   *
   * NOTE: your memory notes mention two known issues in the pre-refactor
   * createChatAttachment()/bindToChatConversation() pairing — conversationId
   * never being forwarded from createChatAttachment, and an unreachable
   * success path in this method. The body below matches the original
   * document you provided verbatim (which reads as correct — no unreachable
   * path visible in it), so I haven't "fixed" anything here since I can't
   * verify against whatever version the memory note refers to. Please diff
   * this method against your actual current source before relying on it.
   */
  bindToChatConversation(conversationID: string, chatMessageID: string): void {
    if (this._context !== "chat_attachment") {
      throw MajikFileError.invalidInput(
        "bindToChatConversation: only chat_attachment files can be bound to a mail",
      );
    }
    if (this._chatMessageId || this._conversationId) {
      throw MajikFileError.invalidInput(
        "bindToChatConversation: this file is already bound to a chat conversation — IDs are immutable once set",
      );
    }
    if (!conversationID?.trim()) {
      throw MajikFileError.invalidInput(
        "bindToChatConversation: conversationID is required",
      );
    }
    if (!chatMessageID?.trim()) {
      throw MajikFileError.invalidInput(
        "bindToChatConversation: chatMessageID is required",
      );
    }
    this._conversationId = conversationID;
    this._chatMessageId = chatMessageID;
    this._lastUpdate = new Date().toISOString();
  }

  // ── STORAGE TYPE MUTATION ─────────────────────────────────────────────────

  setStorageType(
    type: StorageType,
    expiresAt: string | null,
    duration: TempFileDuration = 15,
  ): void {
    MajikMessageFileValidator.assertStorageType(type);
    if (type === "temporary" && !expiresAt) {
      throw MajikFileError.invalidInput(
        "setStorageType: expiresAt is required when switching to temporary. Use setTemporary(days?) instead.",
      );
    }
    if (this._context === "chat_image") {
      throw MajikFileError.invalidInput(
        "setStorageType: chat_image files are conversation-scoped and cannot change storage type.",
      );
    }

    const newR2Key =
      type === "temporary"
        ? buildTemporaryR2Key(this._userId, this._fileHash, duration)
        : buildPermanentR2Key(this._userId, this._fileHash);

    this._storageType = type;
    this._expiresAt = type === "temporary" ? expiresAt : null;
    this._r2Key = newR2Key;
    this._lastUpdate = new Date().toISOString();
  }

  setPermanent(): void {
    this.setStorageType("permanent", null);
  }

  /** @param duration Days until expiry. Must be one of: 1 | 2 | 3 | 5 | 7 | 15. Defaults to 15. */
  setTemporary(duration: TempFileDuration = 15): void {
    this.setStorageType("temporary", buildExpiryDate(duration), duration);
  }

  // ── SHARING ───────────────────────────────────────────────────────────────

  /**
   * Toggle shareable state. OFF→ON assigns a token (auto-generated if
   * omitted); ON→OFF clears it. Returns the active token, or null if
   * sharing was disabled.
   */
  toggleSharing(token?: string): string | null {
    if (this._isShared) {
      this._isShared = false;
      this._shareToken = null;
      this._lastUpdate = new Date().toISOString();
      return null;
    }
    if (token !== undefined && !token.trim()) {
      throw MajikFileError.invalidInput(
        "toggleSharing: token must be a non-empty string when provided",
      );
    }
    this._isShared = true;
    this._shareToken = token?.trim() ?? generateUUID();
    this._lastUpdate = new Date().toISOString();
    return this._shareToken;
  }

  // ── SERIALISATION ─────────────────────────────────────────────────────────

  toJSON(): MajikMessageFileJSON {
    const base = super.toJSON();
    return {
      ...base,
      kind: "message_file",
      r2_key: this._r2Key,
      storage_type: this._storageType,
      is_shared: this._isShared,
      share_token: this._shareToken,
      context: this._context,
      chat_message_id: this._chatMessageId,
      thread_message_id: this._threadMessageId,
      thread_id: this._threadId,
      conversation_id: this._conversationId,
      expires_at: this._expiresAt,
    };
  }

  toDangerousJSON(): MajikMessageFileJSON & {
    decrypted_base64: string | null;
  } {
    return {
      ...this.toJSON(),
      decrypted_base64: this.decryptedFile
        ? arrayToBase64(this.decryptedFile)
        : null,
    };
  }

  validate(): void {
    const errors = this._collectErrors();
    const push = (err: string | null) => {
      if (err) errors.push(err);
    };

    push(MajikMessageFileValidator.checkContext(this._context));
    push(
      MajikMessageFileValidator.checkConversationIdRequired(
        this._context,
        this._conversationId,
      ),
    );
    push(
      MajikMessageFileValidator.checkChatThreadMutualExclusion(
        this._chatMessageId,
        this._threadMessageId,
      ),
    );
    push(MajikMessageFileValidator.checkStorageType(this._storageType));
    push(
      MajikMessageFileValidator.checkExpiresAtRequired(
        this._storageType,
        this._expiresAt,
      ),
    );

    MajikMessageFileValidator.assertAll(errors);
  }

  /**
   * Stricter validation used only during create() — includes R2 prefix
   * checks against the file's declared storage class.
   */
  private _validateCreate(): void {
    this.validate();

    const errors: string[] = [];
    const permanentPrefix = `${R2_PREFIX.PERMANENT}/${this._userId}/`;
    const temporaryPrefix = `${R2_PREFIX.TEMPORARY}/`;
    const chatImagePrefix = `${R2_PREFIX.CHAT_IMAGE}/`;

    if (this._context === "chat_image") {
      const err = MajikMessageFileValidator.checkStorageKeyPrefix(
        this._r2Key,
        chatImagePrefix,
        "r2_key for chat_image files",
      );
      if (err) errors.push(err);
    } else if (this._storageType === "permanent") {
      const err = MajikMessageFileValidator.checkStorageKeyPrefix(
        this._r2Key,
        permanentPrefix,
        "r2_key for permanent files",
      );
      if (err) errors.push(err);
    } else if (this._storageType === "temporary") {
      const err = MajikMessageFileValidator.checkStorageKeyPrefix(
        this._r2Key,
        temporaryPrefix,
        "r2_key for temporary files",
      );
      if (err) errors.push(err);
    }

    if (errors.length > 0) throw MajikFileError.validationFailed(errors);
  }

  // ── fromJSON / legacy migration ────────────────────────────────────────────

  /**
   * True if `json` is the pre-refactor flat shape — identified purely by
   * the absence of `schema_version`, which no legacy record ever had.
   */
  static isLegacyJSON(json: unknown): json is LegacyMajikFileJSON {
    return (
      json != null &&
      typeof json === "object" &&
      !("schema_version" in (json as Record<string, unknown>)) &&
      "r2_key" in (json as Record<string, unknown>)
    );
  }

  /**
   * True if `json` carries the message-file fields (r2_key, context, etc.)
   * on top of the base MajikFileJSON shape.
   */
  static isMessageJSON(json: unknown): json is MajikMessageFileJSON {
    return (
      json != null &&
      typeof json === "object" &&
      "r2_key" in (json as Record<string, unknown>) &&
      "storage_type" in (json as Record<string, unknown>)
    );
  }

  /**
   * Restore a MajikMessageFile from its serialised JSON — auto-detects and
   * transparently migrates legacy (pre-refactor) rows via fromLegacyJSON().
   * Callers never need to know a row's age.
   *
   * Parameter type is deliberately widened to `MajikFileJSON` (the base
   * type) rather than narrowed to `MajikMessageFileJSON` in the signature —
   * TypeScript requires a subclass's static method parameters to be
   * contravariant with the base class's (accept at least what the base
   * accepts), so narrowing here would make `typeof MajikMessageFile`
   * structurally incompatible with `typeof MajikFile`. The actual
   * message-shape check happens at runtime via isMessageJSON() below.
   */
  static fromJSON(
    json: MajikFileJSON | LegacyMajikFileJSON,
    binary?: Uint8Array | ArrayBuffer | null,
  ): MajikMessageFile {
    if (!json || typeof json !== "object") {
      throw MajikFileError.invalidInput(
        "fromJSON: json must be a non-null object",
      );
    }
    if (MajikMessageFile.isLegacyJSON(json)) {
      return MajikMessageFile.fromLegacyJSON(json, binary ?? undefined);
    }
    if (!MajikMessageFile.isMessageJSON(json)) {
      throw MajikFileError.invalidInput(
        "fromJSON: json does not look like a MajikMessageFileJSON record " +
          "(missing r2_key/storage_type) — did you mean to call MajikFile.fromJSON() instead?",
      );
    }

    const current = json; // narrowed to MajikMessageFileJSON by the guard above
    MajikFileValidator.assertSchemaVersion(
      current.schema_version,
      FILE_SCHEMA_VERSION,
    );

    const binaryBytes =
      binary != null
        ? binary instanceof Uint8Array
          ? binary
          : new Uint8Array(binary)
        : null;
    const isGroup = MajikMessageFile._detectIsGroupFromBinary(binaryBytes);

    const instance = new MajikMessageFile(current, binaryBytes, isGroup);
    instance.validate();
    return instance._sealInstance();
  }

  /** Same parameter-widening rationale as fromJSON() above — see its doc comment. */
  static async fromJSONWithBlob(
    json: MajikFileJSON | LegacyMajikFileJSON,
    binary: Blob,
  ): Promise<MajikMessageFile> {
    const bytes = new Uint8Array(await binary.arrayBuffer());
    return MajikMessageFile.fromJSON(json, bytes);
  }

  /**
   * @deprecated Explicit migration shim for pre-refactor flat records.
   * Prefer letting `fromJSON()` auto-detect and delegate here — call this
   * directly only for bulk/offline migration tooling. Stamps
   * `schema_version: FILE_SCHEMA_VERSION`, `kind: "message_file"`, and the
   * current CRYPTO_SUITE (the only suite that ever existed pre-refactor).
   */
  static fromLegacyJSON(
    legacy: LegacyMajikFileJSON,
    binary?: Uint8Array | ArrayBuffer | null,
  ): MajikMessageFile {
    try {
      const migrated: MajikMessageFileJSON = {
        id: legacy.id,
        schema_version: FILE_SCHEMA_VERSION,
        kind: "message_file",
        user_id: legacy.user_id,
        original_name: legacy.original_name,
        mime_type: legacy.mime_type,
        size_original: legacy.size_original,
        size_stored: legacy.size_stored,
        file_hash: legacy.file_hash,
        encryption_iv: legacy.encryption_iv,
        participants: legacy.participants,
        kem_alg: CRYPTO_SUITE.kemAlg,
        cipher_alg: CRYPTO_SUITE.cipherAlg,
        timestamp: legacy.timestamp,
        last_update: legacy.last_update,
        signature: legacy.signature,
        r2_key: legacy.r2_key,
        storage_type: legacy.storage_type,
        is_shared: legacy.is_shared,
        share_token: legacy.share_token,
        context: legacy.context,
        chat_message_id: legacy.chat_message_id,
        thread_message_id: legacy.thread_message_id,
        thread_id: legacy.thread_id,
        conversation_id: legacy.conversation_id,
        expires_at: legacy.expires_at,
      };

      const binaryBytes =
        binary != null
          ? binary instanceof Uint8Array
            ? binary
            : new Uint8Array(binary)
          : null;
      const isGroup = MajikMessageFile._detectIsGroupFromBinary(binaryBytes);

      const instance = new MajikMessageFile(migrated, binaryBytes, isGroup);
      instance.validate();
      return instance._sealInstance();
    } catch (err) {
      if (err instanceof MajikFileError) throw err;
      throw MajikFileError.legacyMigrationFailed(err);
    }
  }

  // ── STATS ─────────────────────────────────────────────────────────────────

  getStats(): MajikMessageFileStats {
    const base = super.getStats();
    return {
      ...base,
      storageType: this._storageType,
      context: this._context,
      isShared: this._isShared,
      isExpired: this.isExpired,
      expiresAt: this._expiresAt,
      r2Key: this._r2Key,
    };
  }
}
