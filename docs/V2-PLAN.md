# PBHUB V2 — audit, plan, and the rules we work by

Phase 1 output. No code has been changed to produce this document.

The V2 brief was written against `HANDOFF.md` rather than against the source, so
some of its 66 sections are already implemented, a few do not apply, and a few
are the most valuable work in the list. This separates them, and sets the format
and the gates for everything after.

---

## 1. First-response format

Every phase ends with one report in exactly this shape. Nothing else counts as
the phase being finished.

```
PHASE n — <name>                                    DONE / BLOCKED / PARTIAL

WHAT CHANGED
  <file:line>   one line on what and why
  ...

WHAT IT FIXES
  The concrete attack, bug or failure this removes. Not a feature name.

WHAT IT DOES NOT FIX
  The nearest thing someone would assume this covers, and does not.

MIGRATION
  Old data: <opens / re-paired / unreadable>
  Failure behaviour: <what happens if migration throws>

TESTS            before: N passed   after: M passed   new: <names>
TYPECHECK        pass / fail
ANDROID BUILD    pass / fail        installed and driven on 2 emulators: yes / no
IOS              pass / fail / not tested (and why)

RISK
  What I am least sure about, in one sentence.

NEXT
  The single next thing, not a list.
```

Rules for the report:

- "Done" means tested on two devices, not compiled.
- A security feature that is half-built is reported as **PARTIAL** with the
  missing half named. Never as done.
- If a phase is abandoned, the report says so and why. Silence is a failure.

---

## 2. Phase exit criteria

A phase is over when every line is true. Not when the code is written.

### Phase 1 — Audit
- [x] Every source file read, not skimmed
- [x] Architecture map written down (§4 below)
- [x] Security findings listed with `file:line` evidence
- [x] Every V2 section triaged: already done / do / defer / recommend against
- [x] No code changed

### Phase 2 — Crypto foundation
- [ ] Pairing secret ≥ 128 bits, generated only by CSPRNG
- [ ] Key separation: message, media, signalling and storage keys are different
      keys derived by labelled HKDF from one root
- [ ] `v` (protocol version) on every envelope; unknown versions rejected, not
      guessed
- [ ] Replay protection survives a restart, proven by a test that restarts
- [ ] Decrypted envelopes validated by shape before use, not cast
- [ ] Migration: an old vault either upgrades or fails **without destroying
      itself**, proven by a test
- [ ] Two emulators: pair, send, lock, unlock, send again, offline delivery
- [ ] Full suite green, typecheck clean, release APK installs

### Phase 3 — Session security (forward secrecy)
- [ ] A written protocol document before a line of ratchet code
- [ ] Out-of-order, duplicate, and skipped messages all handled, each with a test
- [ ] Both phones survive: restart, reinstall one side, 100 messages offline
- [ ] Old keys destroyed where the platform allows; where it does not, said so
- [ ] **If it cannot be finished safely: stop, document, ship nothing.** A fake
      ratchet is worse than none.

### Phase 4 — Relay
- [ ] Per-connection rate limit, tested by flooding it
- [ ] Malformed, oversized, truncated frames rejected without crashing
- [ ] Mailbox expiry
- [ ] No plaintext, key, secret or IP in any log line
- [ ] Old client + new relay, and new client + old relay, both behave

### Phase 5 — Media
- [ ] Nothing plaintext on disk, including thumbnails and temp files
- [ ] EXIF stripped before send
- [ ] One-look: reopening by any route fails, tested by trying

### Phase 6 — Calls
- [ ] Wi-Fi → mobile mid-call recovers or ends cleanly, never hangs
- [ ] Screen off, headset, speaker, camera swap: all driven by hand once

### Phase 7 — Authentication
- [ ] Biometric gates key material; biometric is never used as a key
- [ ] PIN fallback always reachable
- [ ] Lockout survives restart and a moved clock (already true — keep it true)

### Phase 8–9 — Privacy UX, polish
- [ ] Nothing sensitive in the app switcher
- [ ] No technical error text reaches a normal screen
- [ ] Reduced-motion respected by PB

### Phase 10 — iOS
- [ ] An actual build on an actual iPhone. Until then: **NOT TESTED**.

---

## 3. What the audit found

### Already implemented — do not rebuild

| V2 asks for | Reality |
|---|---|
| Authenticated ciphertext (§8) | XChaCha20-Poly1305 on every message, every media blob, every signalling frame. `vault.ts:172-206` |
| Nonce handling (§8) | Fresh 24-byte random nonce per seal. XChaCha's 192-bit nonce makes collision a non-issue. `vault.ts:173` |
| Relay blind to content (§19) | Relay sees room id + ciphertext only. SDP and ICE are sealed before it sees them. |
| Relay limits (§19) | `MAX_ROOM 2`, `MAX_FRAME 12MB`, `MAX_MAIL_ITEMS 500`, `MAX_MAIL_BYTES 32MB`, ping/idle sweep, terminate on error. `server/index.js:22-36` |
| Duplicate delivery (§9) | Ids deduplicated in memory. `App.tsx:152, 550, 589, 743` |
| Failed-PIN lockout (§12) | 3 strikes → vault closes → 20s / 1m / 5m, persisted, clock-clamped, 8 tests. `store/guard.ts` |
| Private notifications (§16) | No sender, no preview, no sound, no badge, `SECRET` lockscreen. `net/notify.ts` |
| Peer fingerprint (§29) | Settings shows the first 8 of the room id, both phones compare. `VaultSettings.tsx` |
| PB stays local (§35) | Word list in one file, output is which of six faces. `ui/pbMood.ts` |
| Media at rest (§22) | Status media sealed on disk; **chat media never touches disk at all** — it lives as a data URI in memory and dies with the app |
| User-controlled privacy (§54) | Read receipts, screenshots, auto-lock, TTL, notification dot are all already switches |

### Real gaps, in the order I would fix them

1. **64-bit pairing secret** — `wordlist.ts:81`. The floor under everything. Now
   that pairing is a QR code, 256 bits costs the user nothing.
2. **One key does five jobs** — `msgKey` seals messages, media, signalling, the
   mailbox, and local storage. No domain separation. One mistake anywhere is a
   mistake everywhere.
3. **Replay does not survive a restart** — `App.tsx:368` clears the seen-set on
   every unlock. Someone who captured a sealed message (the relay operator, for
   instance) could re-deliver it after a restart and it would appear as new. The
   ciphertext is old and unaltered, so nothing detects it.
4. **No protocol version** — envelopes carry no `v`. Every future change is a
   guess about what the other phone is running.
5. **Decrypted envelopes are cast, not checked** — `App.tsx:251`,
   `peer.ts:159`. Only the partner holds the key, so the risk is low; the cost
   of checking is lower.
6. **No forward secrecy** — one compromise reads the whole history.
7. **Vault key is not hardware-backed** — PBKDF2 at 12,000 rounds is all that
   stands between a stolen phone's storage and an offline PIN search. A Keystore
   / Keychain-wrapped key would make that search need the phone itself.
8. **Relay has no rate limit** — frame size and mailbox are capped; the number of
   frames per second is not.

### Recommend against, or defer — with reasons

- **Decoy PIN (§14).** Two PINs, two note sets, two vaults, two migration paths.
  It doubles the state and the ways to lock yourself out, for a coercion threat
  that is not the one this app is built for. This project's owner has asked for
  *simpler* at every turn. Decline unless the threat model changes.
- **Encrypted cloud backup and recovery phrase (§37, §38).** Directly at odds
  with "nothing is stored". It creates the second copy this app exists to avoid.
  Defer indefinitely; the honest answer stays "there is no recovery".
- **Search (§27).** Needs a persistent index of a conversation whose default is
  not to persist. Defer.
- **Reactions (§26), design system (§52), accessibility (§47).** Worth doing,
  none of them security. After Phase 4.
- **Device change detection (§30).** There are no long-term identity keys to
  change — identity *is* the pairing secret. Nothing to detect. Skip.
- **Background execution (§17).** Already at the platform's limit, and already
  documented in the app's own Settings. No work available here that does not
  cost the disguise.

---

## 4. Architecture map

```
Notes disguise            NotesList, NoteEditor            plaintext, deliberately
  └ hold +  ───────────►  VaultGate (PIN, PB, 3 strikes) ─► guard.ts (persisted)
                             │
                             ├ setup ─► PairScreen (QR) ─► pairingCode / pairingNumber
                             │                                    └► 8-byte secret
                             └ unlock ─► vault.ts  PIN ─PBKDF2(12k)─► key
                                                   key ─XChaCha20─► stored secret
                                                             │
                                          HKDF ──────────────┴──► roomId + msgKey
                                                                        │
App.tsx (state machine) ────────────────────────────────────────────────┤
  ├ signaling.ts ─ WebSocket ─► server/index.js   join/sig/mail/live/peek
  ├ peer.ts ─ WebRTC data channel + media          (STUN + TURN)
  ├ store/  messages · history · outbox · status · statusMedia · notes · settings
  ├ screens/ Chat · Call · VaultSettings · SharedSheet
  └ ui/ PBBot · pbMood
```

Everything sealed for storage or for the wire goes through `seal`/`unseal` in
`vault.ts`, with `msgKey`. That single fact is finding #2.

---

## 5. Order of work

Phase 2 first, and it is one commit per line:

1. `protocol: add version to every envelope` — cheap, unblocks everything
2. `crypto: derive separate keys by label` — same secret, different keys
3. `crypto: 256-bit pairing secret` — needs a re-pair; see below
4. `security: replay protection that survives a restart`
5. `protocol: validate envelopes before use`

Then Phase 4 (relay limits) before Phase 3 (ratchet), because the relay work is
half a day and the ratchet is several days, and shipping the cheap hardening
first is worth more than starting the expensive thing sooner.

`docs/SECURITY.md` (threat model) and `docs/SECURITY_AUDIT.md` are written at
the end of Phase 2, when there is a real construction to describe rather than an
intention.

---

## 6. The one decision that blocks Phase 2

Raising the pairing secret from 8 bytes to 32 means **new key material**. Old
key material cannot be stretched into it — that is what "more entropy" means.

So either:

- **Re-pair once.** Both phones scan a new QR. Thirty seconds, and the
  conversation history on each phone is kept (it is sealed with the PIN, not the
  pairing secret). Every future session is 256-bit.
- **Keep 64 bits for existing pairs, 256 for new ones.** No re-pairing, but the
  weakness the whole exercise is about stays on the two phones that matter.

The first is right. It needs the owner to say so, because it is the one change
that asks something of both people rather than only of the code.
