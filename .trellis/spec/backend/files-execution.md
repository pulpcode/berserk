# Harness Lab File and Execution Contract

Read when changing src/files, src/execution, file APIs, Pi file tools or native file evidence. Existing conversation/resource rules remain in [Harness Lab Contract](harness-lab.md).

### Ordinary files and execution (W01-5)

FileService owns the persistent workspaces/<workspaceId>/files root and private file-storage/<workspaceId> upload records, staging, fixed downloads and execution logs. The fixed host safe-fs.py helper uses dir_fd and O_NOFOLLOW for untrusted path components and bounded regular-file reads; it has no user-code execution verb. Host Python 3 is required. Container code sees neither private storage nor session/model credentials. Do not replace anchored operations with a realpath/check-then-open race.

Streaming upload routes accept only application/octet-stream; JSON remains limited to 128 KiB. Measure actual bytes, preserve empty files, use atomic no-overwrite installation with a suffix for duplicate names, and bind upload records to workspace/task/seat. Cancellation checks scoped ownership before signalling a transfer. A completed upload is an ordinary writable file, even if no message is sent. Remove references without deleting files. Query uncertain completion before retries; startup reconciles interrupted commits without replaying writes.

Upload names reserve room for collision suffixes and are limited to 240 UTF-8 bytes. Do not apply that upload-only limit to existing script-generated filenames during publication or download. Validate a download record's name against the basename of its controlled path.

Pi read/write/edit/bash/ls/find reuse public 0.85.1 factories and container operations, keeping noTools=builtin. No second tool loop and no host fallback. DockerExecutionService owns request-scoped containers with a shared persistent workspace mount and readonly /logs; preserve same-workspace parallel sessions. Register file tools only when the runtime is available. Children use only explicitly allowed readonly tools and share their parent's sandbox without owning its cleanup. file_output copies an actual safe file into a private fixed download; parent-only, idempotent by workspace/session/request/toolCallId. Source files can change concurrently; published bytes remain fixed. No business artifact status or general conflict transaction.

Only the application model transport holds credentials. Container execution has no network, a nonroot UID/GID, readonly root, tmpfs, dropped capabilities, no-new-privileges and CPU/memory/pid limits. It never mounts the Docker socket or data root. Every command is supervised and cleans descendants. Per-request stop awaits its exact container, never removes other requests. Cleanup uncertainty must fail visibly, mark recoveryWarning and block continuation; it cannot claim stopped. Startup removes this instance's orphan containers without replay. Real verification of isolation and descendant cleanup requires Docker, not mocks.

File references enter Pi as a hidden native custom message berserk.files-input.v1 (display=false) with validated metadata and deterministic context text; original user text remains unchanged. The body is read only on tool demand. Parent output evidence berserk.files-output.v1 requires a preceding same-request native file_output call/path and matching native result; reject duplicate or foreign ownership. Published downloads are independent of later source edits/deletion. Historical refs use an on-demand files/status read to show current/changed/missing; do not hash all files during activity polling.

Bash output is archived under executions/<requestId> and mapped to /logs before callbacks, results, errors or native persistence expose it. Success, nonzero exit, cancellation and timeout must never expose Pi's host temporary output path. Log reads are readonly and survive container deletion. Text-only models cannot receive raw image bodies. Binary office/PDF formats are parsed by container scripts. Preview serves only inert UTF-8 text or bounded PNG/JPEG bytes, with nosniff/CSP; HTML/SVG stay text, other formats download as attachments.

## Signatures and contracts

- `POST /api/workspaces/:id/uploads {name,size}` registers an upload; `PUT /uploads/:uploadId/content` accepts the binary stream; `GET /uploads/:uploadId` reads status; `DELETE` cancels incomplete uploads without deleting published files.
- `GET /api/workspaces/:id/files` accepts path/search/offset/limit; `/files/status?path&hash` returns current/changed/missing; `/files/content?path&preview=1` is a bounded inert preview; `/downloads/:downloadId` returns fixed published bytes.
- `POST /api/sessions/:id/messages {text,uploadIds?,fileRefs?:[{path}]}` resolves the current seat's ordinary files before model work. Combined attachment limit applies across both arrays.
- `LAB_SEAT_ID=test-seat`, `LAB_MAX_FILE_BYTES=104857600`, `LAB_MAX_ATTACHMENTS=20`; `LAB_EXECUTION_ENABLED=true`, `LAB_EXECUTION_IMAGE=berserk-file-runtime:w01-5`, CPU/memory/PID defaults `2/1024/128`. UID/GID must be nonroot and have access to the mounted directory.
- SSH-forwarded browser and server use the same configured port so the existing Origin check remains valid. Do not loosen Origin validation to accommodate a forwarding mismatch.

## Validation and errors

| Condition | Result |
| --- | --- |
| Absolute/traversal/invalid path | INVALID_INPUT; no file operation |
| Missing/foreign scoped upload | UPLOAD_NOT_FOUND or scope rejection before abort signalling |
| Declared or measured file size too large | FILE_TOO_LARGE / HTTP 413 |
| Incomplete transfer | UPLOAD_INCOMPLETE; no visible published file |
| Reusing a nonpending upload | UPLOAD_NOT_PENDING / HTTP 409; query status before retry |
| Missing published copy | DOWNLOAD_NOT_FOUND / HTTP 404; never substitute a current source file |
| Missing host Python or unsafe filesystem operation | FILE_OPERATION_FAILED / HTTP 503; no unsafe fallback |
| Execution unavailable | Do not register file execution tools; chat and file management remain usable |

## Good, base and bad cases

- Good: upload a CSV, run a Python script, publish a report, update the ordinary file, and still download the first report's original bytes.
- Base: cancel one request, await its container cleanup, then read files saved before cancellation from a new request.
- Bad: use another seat's upload ID, follow a symlink outside the workspace, silently run on the host, or describe uncertain cleanup as successful cancellation.

## Verification

Run typecheck, lint and npm test -- --maxWorkers=2. File routes are covered by tests/file-api.test.ts, safe storage and migration by tests/files, runtime lifecycle by tests/execution, and actual Pi factory wrappers by tests/pi/file-tools.test.ts. Use probe:execution for Linux isolation and process cleanup, probe:files for real provider/file processing, probe:files-continuation for native compaction and cancellation, and browser acceptance separately. Docker unavailable is unverified, never a skipped passing acceptance. Do not use user files as destructive test data.

## Wrong vs correct

Wrong: validate an existing generated download filename with the upload-only 240-byte naming rule, causing successful publication followed by download failure. Correct: validate the controlled relative path and require the stored name to equal its basename; cover a 250-byte ordinary filename in publication/download tests.
