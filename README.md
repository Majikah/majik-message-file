# Majik Message File

[![Developed by Zelijah](https://img.shields.io/badge/Developed%20by-Zelijah-red?logo=github&logoColor=white)](https://thezelijah.world) ![GitHub Sponsors](https://img.shields.io/github/sponsors/jedlsf?style=plastic&label=Sponsors&link=https%3A%2F%2Fgithub.com%2Fsponsors%2Fjedlsf)

[![Static Badge](https://img.shields.io/badge/IANA-vnd.majikah.bundle-green)](https://www.iana.org/assignments/media-types/application/vnd.majikah.bundle)

**Messaging-specific post-quantum file encryption for Majikah.** `MajikMessageFile` is the storage/context/binding-aware subclass of [`MajikFile`](https://www.npmjs.com/package/@majikah/majik-file) — it adds R2 routing, chat/thread bindings, sharing, and temporary-file expiry on top of the same `.mjkb` cryptographic pipeline, without duplicating a single line of crypto logic.

> **Note on Architecture:** This package does **not** implement encryption, compression, or the `.mjkb` binary codec — that all lives in the platform-agnostic [`@majikah/majik-file`](https://www.npmjs.com/package/@majikah/majik-file) base class, which this package depends on and extends. If you need generic file encryption with no chat/thread/storage concepts attached, use `MajikFile` directly instead.

![npm](https://img.shields.io/npm/v/@majikah/majik-message-file) ![npm downloads](https://img.shields.io/npm/dm/@majikah/majik-message-file) ![npm bundle size](https://img.shields.io/bundlephobia/min/%40majikah%2Fmajik-message-file) [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0) ![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)

---

## Contents

- [Majik Message File](#majik-message-file)
  - [Contents](#contents)
  - [Why a subclass](#why-a-subclass)
  - [File contexts](#file-contexts)
  - [R2 key routing](#r2-key-routing)
  - [Installation](#installation)
  - [Quick start](#quick-start)
    - [Chat image](#chat-image)
    - [Chat attachment](#chat-attachment)
    - [Chat voice note](#chat-voice-note)
    - [Thread attachment](#thread-attachment)
    - [User upload (vault)](#user-upload-vault)
    - [Temporary upload](#temporary-upload)
    - [Decrypting](#decrypting)
  - [Binding files after creation](#binding-files-after-creation)
  - [Storage type \& sharing](#storage-type--sharing)
  - [API reference](#api-reference)
    - [`MajikMessageFile.create(options)`](#majikmessagefilecreateoptions)
    - [Quick-create wrappers](#quick-create-wrappers)
    - [Instance methods](#instance-methods)
    - [Instance getters](#instance-getters)
  - [Type reference](#type-reference)
    - [`MajikMessageFileJSON`](#majikmessagefilejson)
    - [`FileContext`](#filecontext)
    - [`TempFileDuration`](#tempfileduration)
  - [Legacy migration](#legacy-migration)
  - [Validation \& errors](#validation--errors)
  - [Storage model](#storage-model)
  - [Relationship to `MajikFile`](#relationship-to-majikfile)
  - [Related Projects](#related-projects)
    - [Majik Message](#majik-message)
    - [Majik File](#majik-file)
    - [Majik Key](#majik-key)
    - [Majik Envelope](#majik-envelope)
  - [License](#license)
  - [Author](#author)

---

## Why a subclass

Everything cryptographic — hashing, compression policy, ML-KEM-768 encapsulation, AES-256-GCM sealing, `.mjkb` encoding/decoding, signing, zeroization — is owned entirely by `MajikFile`. `MajikMessageFile` never re-implements or forks any of it. Instead it **composes** the base pipeline through `MajikFile._encryptCore()` and layers on exactly the fields a messaging platform needs:

- Where the encrypted binary is stored (R2 key, storage type, expiry)
- What kind of message artefact it is (`FileContext`)
- What it's attached to (chat message, thread mail, conversation)
- Whether it's publicly shareable

This keeps the base library reusable by any platform, while this package stays free to evolve storage/routing/binding concerns independently.

The only crypto-adjacent thing this subclass overrides is `_preProcess()` — the hook `MajikFile` exposes specifically so platforms can transform bytes before compression. Here it's used to convert images to WebP for `chat_image` and `chat_attachment` contexts.

---

## File contexts

```typescript
type FileContext =
  | "user_upload"        // general file vault
  | "chat_attachment"    // file attached to a chat message
  | "chat_image"         // inline image in a chat conversation
  | "chat_voice"         // voice note attached to a chat message
  | "thread_attachment"  // attachment on a thread mail
```

| Context | WebP conversion | `conversationId` | Binds via |
|---|---|---|---|
| `user_upload` | No | — | — |
| `chat_attachment` | Yes, if the file is an image | Not required at creation | `bindToChatConversation()` |
| `chat_image` | Yes, always | **Required** at creation | — (bound at creation) |
| `chat_voice` | No | Used to scope the conversation | — |
| `thread_attachment` | No | — | `bindToThreadMail()` |

WebP conversion runs through the Canvas API and is best-effort: on any failure (unsupported source format, canvas unavailable) the original bytes pass through unchanged — it is never a hard requirement for encryption to succeed.

---

## R2 key routing

`create()` picks the object key automatically based on context and storage type:

```
context === "chat_image"   → images/chats/<conversationId>/<userId>_<fileHash>.mjkb
isTemporary === true       → files/public/<userId>_<fileHash>.mjkb
otherwise (permanent)      → files/user/<userId>/<fileHash>.mjkb
```

`chat_image` files are always conversation-scoped and permanent — `setStorageType()` refuses to change storage class on them (see [Storage type & sharing](#storage-type--sharing)). All other contexts follow the temporary/permanent branch.

---

## Installation

```bash
npm install @majikah/majik-message-file @majikah/majik-file
```

`@majikah/majik-file` is a peer dependency — `MajikMessageFile` extends `MajikFile` directly, so both packages need to resolve to compatible versions. Requires the same browser-like environment as the base package (Web Crypto, `Blob`, `Canvas` for WebP conversion).

---

## Quick start

### Chat image

```typescript
import { MajikMessageFile } from '@majikah/majik-message-file'

const majikFile = await MajikMessageFile.createChatImage({
  data: imageBytes,
  userId: 'user-uuid',
  identity,                        // MajikFileIdentity from your key store
  conversationId: 'conv-uuid',     // required — scopes the R2 key
  mimeType: 'image/png',
  originalName: 'photo.png',
})

const blob = majikFile.toMJKB()     // upload to R2 at majikFile.r2Key
const metadata = majikFile.toJSON() // insert into Supabase
```

Images are always converted to WebP for this context. There's a hard 25 MB cap on the source bytes — `createChatImage()` throws before any encryption work happens if the file exceeds it.

### Chat attachment

```typescript
const majikFile = await MajikMessageFile.createChatAttachment({
  data: fileBytes,
  userId: 'user-uuid',
  identity,
  chatMessageId: 'chat-msg-uuid',
  originalName: 'report.pdf',
  mimeType: 'application/pdf',
})
```

If the attachment happens to be an image, it's converted to WebP the same way `chat_image` is. `conversationId` isn't required up front — attach it afterward with [`bindToChatConversation()`](#binding-files-after-creation).

### Chat voice note

```typescript
const majikFile = await MajikMessageFile.create({
  data: audioBytes,
  userId: 'user-uuid',
  identity,
  context: 'chat_voice',
  conversationId: 'conv-uuid',
  chatMessageId: 'chat-msg-uuid',
  mimeType: 'audio/webm',
})
```

There's no dedicated `createChatVoice()` wrapper yet — call `create()` directly with `context: 'chat_voice'`.

### Thread attachment

```typescript
const majikFile = await MajikMessageFile.createThreadAttachment({
  data: fileBytes,
  userId: 'user-uuid',
  identity,
  threadId: 'thread-uuid',
  originalName: 'contract.docx',
})
```

### User upload (vault)

```typescript
const majikFile = await MajikMessageFile.createUserUpload({
  data: fileBytes,
  userId: 'user-uuid',
  identity,
  originalName: 'notes.txt',
  isShared: false,
})
```

### Temporary upload

```typescript
const majikFile = await MajikMessageFile.createTemporaryUpload({
  data: fileBytes,
  userId: 'user-uuid',
  identity,
  duration: 7, // days — one of 1, 2, 3, 5, 7, 15. Defaults to 15.
})

majikFile.isExpired   // false, until expiresAt passes
majikFile.expiresAt   // ISO-8601 string
```

Temporary files route to `files/public/` and are expected to be swept by an R2 lifecycle policy after the chosen duration — this library enforces `expiresAt` at the metadata level only; bucket-level deletion is an infrastructure concern.

### Decrypting

Decryption is entirely inherited from `MajikFile` — nothing message-specific about it:

```typescript
const { bytes, originalName, mimeType } = await MajikMessageFile.decryptWithMetadata(
  mjkbBlob,
  { fingerprint: identity.fingerprint, mlKemSecretKey: identity.mlKemSecretKey }
)
```

See the [`MajikFile` README](https://www.npmjs.com/package/@majikah/majik-file) for `decrypt()`, `decryptHydrate()`, `batchDecrypt()`, signing, and verification — all available unchanged on `MajikMessageFile` instances.

---

## Binding files after creation

Two contexts support deferred binding — encrypt the file first, create the chat/thread record second, then attach the IDs. Both bindings are **write-once**: calling them again throws.

```typescript
// chat_attachment
majikFile.bindToChatConversation(conversationId, chatMessageId)

// thread_attachment
majikFile.bindToThreadMail(threadId, threadMessageId)
```

Each throws `MajikFileError("INVALID_INPUT")` if called on the wrong context, with missing arguments, or a second time on an already-bound instance.

---

## Storage type & sharing

```typescript
majikFile.setTemporary(7)   // switch to temporary, 7-day expiry, recomputes r2Key
majikFile.setPermanent()    // switch back to permanent, clears expiresAt, recomputes r2Key

const token = majikFile.toggleSharing()        // enable sharing, auto-generated token
majikFile.toggleSharing()                      // call again to disable — returns null
```

`chat_image` files cannot change storage type — they're always permanent and conversation-scoped; `setStorageType()` throws `INVALID_INPUT` if attempted.

---

## API reference

### `MajikMessageFile.create(options)`

```typescript
static async create(options: MajikMessageFileCreateOptions): Promise<MajikMessageFile>
```

`MajikMessageFileCreateOptions` extends the base `MajikFileCreateOptions` (`data`, `userId`, `identity`, `recipients?`, `originalName?`, `mimeType?`, `id?`, `bypassSizeLimit?`, `compressionLevel?`) with:

| Field | Type | Required | Description |
|---|---|---|---|
| `context` | `FileContext` | ✓ | Determines WebP handling and R2 routing |
| `isTemporary` | `boolean` | — | Default `false`. Requires `expiresAt` if `true` |
| `isShared` | `boolean` | — | Default `false` |
| `expiresAt` | `TempFileDuration` | — | Days until expiry. Required when `isTemporary` |
| `chatMessageId` | `string` | — | Mutually exclusive with `threadMessageId` |
| `threadMessageId` | `string` | — | Mutually exclusive with `chatMessageId` |
| `threadId` | `string` | — | |
| `conversationId` | `string` | — | Required when `context = "chat_image"` |

Throws `MajikFileError("INVALID_INPUT")` on an invalid context, a missing `conversationId` where required, both `chatMessageId` and `threadMessageId` set at once, or a temporary file missing `expiresAt`. Throws `MajikFileError("VALIDATION_FAILED")` if the resulting R2 key doesn't match the expected prefix for its declared storage class — an internal consistency check run only during `create()`.

### Quick-create wrappers

Thin, narrower-typed convenience wrappers around `create()` — each hard-codes its `context` and permanent/temporary status:

| Method | Context | Notes |
|---|---|---|
| `createChatImage(options)` | `chat_image` | Requires `conversationId`, `mimeType` must be `image/*`. 25 MB hard cap |
| `createChatAttachment(options)` | `chat_attachment` | Requires `chatMessageId` |
| `createThreadAttachment(options)` | `thread_attachment` | Requires `threadId` |
| `createUserUpload(options)` | `user_upload` | Supports `isShared` |
| `createTemporaryUpload(options)` | `user_upload` (temporary) | `duration?: TempFileDuration`, defaults to 15 |

Plus `createAndSign(options, key, signOptions?)`, which runs `create()` then immediately calls `.sign(key)` on the result — inherited pattern from `MajikFile.createAndSign()`.

### Instance methods

| Method | Returns | Description |
|---|---|---|
| `bindToChatConversation(conversationId, chatMessageId)` | `void` | Write-once; only on `chat_attachment` |
| `bindToThreadMail(threadId, threadMessageId)` | `void` | Write-once; only on `thread_attachment` |
| `setStorageType(type, expiresAt, duration?)` | `void` | Recomputes `r2Key`. Blocked for `chat_image` |
| `setPermanent()` | `void` | Shorthand for `setStorageType('permanent', null)` |
| `setTemporary(duration?)` | `void` | Shorthand for `setStorageType('temporary', ...)` |
| `toggleSharing(token?)` | `string \| null` | Toggles sharing; returns active token or `null` |
| `toJSON()` | `MajikMessageFileJSON` | Extends base `toJSON()` |
| `toDangerousJSON()` | `MajikMessageFileJSON & { decrypted_base64 }` | ⚠️ Includes plaintext if hydrated |
| `validate()` | `void` | Combines base + message-specific checks |
| `getStats()` | `MajikMessageFileStats` | Extends base `getStats()` |

All base `MajikFile` instance methods — `toMJKB()`, `toBinaryBytes()`, `decryptBinary()`, `decryptHydrate()`, `decryptWithMetadata()`, `sign()`, `verify()`, `verifyBinary()`, `toSignedMJKB()`, `secureLock()`, `canDecrypt()`, `isDuplicateOf()`, `exceedsSize()`, `attachBinary()`, `clearBinary()` — are inherited unchanged.

### Instance getters

| Getter | Type | Description |
|---|---|---|
| `r2Key` | `string` | Full R2 object key |
| `storageType` | `"permanent" \| "temporary"` | |
| `isShared` | `boolean` | |
| `shareToken` | `string \| null` | |
| `hasShareToken` | `boolean` | |
| `context` | `FileContext \| null` | |
| `chatMessageId` | `string \| null` | |
| `threadMessageId` | `string \| null` | |
| `threadId` | `string \| null` | |
| `conversationId` | `string \| null` | |
| `expiresAt` | `string \| null` | ISO-8601 |
| `isExpired` | `boolean` | Derived from `expiresAt` |
| `isTemporary` | `boolean` | `storageType === "temporary"` |

Plus every base getter from `MajikFile` (`id`, `originalName`, `mimeType`, `fileHash`, `sizeMB`, `isGroup`, `isSigned`, `isInlineViewable`, `safeFilename`, etc.).

---

## Type reference

### `MajikMessageFileJSON`

Mirrors the `majikah.majik_files` Supabase table. Extends the base `MajikFileJSON` (minus its `kind` literal, widened to `string`).

```typescript
interface MajikMessageFileJSON extends Omit<MajikFileJSON, "kind"> {
  kind: string                       // "message_file"
  r2_key: string
  storage_type: "permanent" | "temporary"
  is_shared: boolean
  share_token: string | null
  context: FileContext | null
  chat_message_id: string | null
  thread_message_id: string | null
  thread_id: string | null
  conversation_id: string | null
  expires_at: string | null
}
```

### `FileContext`

```typescript
type FileContext =
  | "user_upload"
  | "chat_attachment"
  | "chat_image"
  | "chat_voice"
  | "thread_attachment"
```

### `TempFileDuration`

```typescript
type TempFileDuration = 1 | 2 | 3 | 5 | 7 | 15  // days — maps 1:1 to R2 lifecycle prefixes
```

---

## Legacy migration

Pre-refactor records were a flat shape with no `schema_version` or `kind` field. `fromJSON()` auto-detects and migrates transparently — callers never need to know a row's age:

```typescript
// Works for both current and legacy rows
const majikFile = MajikMessageFile.fromJSON(row, binaryBytes)

// Or explicitly, for bulk/offline migration tooling
const migrated = MajikMessageFile.fromLegacyJSON(legacyRow, binaryBytes)
```

`isLegacyJSON(json)` and `isMessageJSON(json)` are exposed as static type guards if you need to branch on shape yourself. Legacy migration stamps the current `schema_version`, `kind: "message_file"`, and the current `CRYPTO_SUITE` (the only suite that ever existed pre-refactor) onto the migrated record.

`fromJSONWithBlob(json, binary)` is the async variant that accepts a `Blob` directly (e.g. fetched from R2), for both current and legacy shapes.

---

## Validation & errors

`validate()` combines the base `MajikFile` invariants with:

- `context` is a recognised `FileContext`
- `conversationId` is present when required by context
- `chatMessageId` and `threadMessageId` are not both set
- `storageType` is `"permanent"` or `"temporary"`
- `expiresAt` is present when `storageType === "temporary"`

`create()` additionally runs a stricter, R2-prefix-aware check (`_validateCreate()`) that isn't repeated on every `validate()` call — it confirms the generated `r2Key` actually matches the prefix implied by the file's context/storage class.

All errors are `MajikFileError` instances — same error codes as the base package (`INVALID_INPUT`, `VALIDATION_FAILED`, `ENCRYPTION_FAILED`, `DECRYPTION_FAILED`, `FORMAT_ERROR`, `SIZE_EXCEEDED`, `MISSING_BINARY`, `UNSUPPORTED_VERSION`). See the [`MajikFile` README](https://www.npmjs.com/package/@majikah/majik-file#error-handling) for the full table.

---

## Storage model

Same two-artefact split as the base library:

| Artefact | What it is | Where it goes |
|---|---|---|
| `toMJKB()` → `Blob` | Encrypted binary | Cloudflare R2 at `r2Key` |
| `toJSON()` → object | Metadata record | Supabase `majikah.majik_files` |

This package doesn't perform R2 uploads or Supabase inserts — it only produces the data and computes the correct key. Persistence is the caller's responsibility.

`.mjkb` files remain write-once at the crypto layer (inherited from `MajikFile`); the message-specific metadata mutators (`bindTo...`, `setStorageType`, `toggleSharing`) only ever touch the JSON record, never the encrypted binary or its key material.

---

## Relationship to `MajikFile`

| Concern | Owned by |
|---|---|
| Hashing, compression, ML-KEM-768, AES-256-GCM, `.mjkb` codec | `MajikFile` |
| Signing, verification, zeroization | `MajikFile` |
| R2 key, storage type, expiry | `MajikMessageFile` |
| `FileContext`, chat/thread bindings | `MajikMessageFile` |
| Sharing tokens | `MajikMessageFile` |
| WebP conversion policy | `MajikMessageFile` (via `_preProcess` override) |

If your platform isn't Majikah messaging and you just need self-contained encrypted files, depend on [`@majikah/majik-file`](https://www.npmjs.com/package/@majikah/majik-file) directly — it has no knowledge of this package at all.

---

## Related Projects

### [Majik Message](https://apps.microsoft.com/detail/9pmjgvzzjspn)
The secure messaging product this library powers. Available on Windows and WebApp.

### [Majik File](https://majikah.solutions/sdk/majik-file)
The platform-agnostic base class this package extends.

### [Majik Key](https://majikah.solutions/sdk/majik-key)
Seed phrase account library for generating deterministic ML-KEM-768 keypairs.

### [Majik Envelope](https://majikah.solutions/sdk/majik-envelope)
The core cryptographic engine handling message encryption and multi-recipient key encapsulation.

---

## License

[Apache-2.0](LICENSE) — free for personal and commercial use.

---

## Author

Made with 💙 by [@thezelijah](https://github.com/jedlsf)

- **Developer**: Josef Elijah Fabian
- **GitHub**: [https://github.com/jedlsf](https://github.com/jedlsf)
- **Official Website**: [https://www.thezelijah.world](https://www.thezelijah.world)