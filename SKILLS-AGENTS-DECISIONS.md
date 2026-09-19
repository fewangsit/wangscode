# Keputusan Skill / Subagent / Rules — Log

Catatan hidup: setiap keputusan soal skill, subagent, atau rules di `wangs-agent` dicatat di
sini saat diputuskan — bukan ditulis ulang dari ingatan nanti. Urut kronologis, entri terbaru
di bawah. Status tiap entri: **DIPUTUSKAN** (sudah diimplementasikan), **TERBUKA** (rekomendasi
sudah diberikan, belum dikonfirmasi user), atau **DITINGGALKAN** (sempat diputuskan, lalu
dibatalkan — lihat §"Dibatalkan").

---

## 1. Subagent dibundel programatik (`Options.agents`), bukan file `.claude/agents/*.md`

**Status: DIPUTUSKAN.** 4 subagent (`wangs-ui-querier`, `ui-design-reader`, `functional-reader`,
`test-case-reader`) didefinisikan sebagai objek `AgentDefinition` langsung di
`src/subagents.ts`, bukan file markdown yang harus di-generate ulang per proyek konsumen.
Alasan: consumer repo butuh nol config untuk fitur ini — cukup install `wangs-agent`, tidak
perlu `.claude/agents/`.

## 2. Skill dibundel via `Options.plugins`, bukan `.claude/skills/*/SKILL.md`

**Status: DIPUTUSKAN.** 4 skill proyek-spesifik (`feature-workflow`, `slicing-review`,
`design-system`, `component-spliting`) dibundel fisik sebagai file `SKILL.md` di
`wangs-plugin/`, dimuat lewat `Options.plugins`. Sama alasannya dengan §1 — zero-config di
consumer repo, dan update `wangs-agent` = update skill-nya, tidak perlu sync manual per
proyek (`pnpm skills:sync` di `wangs-monorepo-foundation` sudah dipangkas jadi cuma
menyisakan sync untuk skill `@wangs-ui/skills`).

## 3. MCP server `wangs-ui` di-scope hanya ke `wangs-ui-querier`, bukan sesi utama

**Status: DIPUTUSKAN.** `mcpServers` diatur di level `AgentDefinition.mcpServers` subagent
itu sendiri, bukan `Options.mcpServers` sesi utama. Konsekuensi: sesi utama secara
**struktural** tidak punya akses tool `mcp__wangs-ui__*` — bukan cuma aturan di prompt
("jangan panggil MCP langsung") yang bisa diabaikan model, tapi memang tidak ada tool-nya di
daftar. Lebih ketat dari desain aslinya.

## 4. `@wangs-ui/mcp` dijalankan via stdio (`npx -y @wangs-ui/mcp@latest`), tanpa `--registry=` hardcoded

**Status: DIPUTUSKAN.** Config awal salah (URL `http`/Chromatic pribadi, diambil keliru dari
`~/.claude.json` milik sesi ini sendiri). Diperbaiki jadi `stdio` sesuai template kanonik
`wangs-ui-react`. `@wangs-ui/mcp` **tidak ada** di registry npm publik (dicek langsung ke
`registry.npmjs.org`). Diputuskan **tidak** hardcode `--registry=` (beda dari
`tagsamurai-monorepo` yang hardcode IP LAN `192.168.1.102` — tidak stabil, uptime terbatas) —
mengandalkan `.npmrc` consumer untuk scope `@wangs-ui`, sama seperti syarat install
`@wangs-ui/react-core` dkk lainnya. Detail lengkap: `TAGSAMURAI-NOTES.md` §5.

## 5. Penempatan validator: tabel tiga-tingkat, bukan folder `model/` baru

**Status: DIPUTUSKAN.** Ditambahkan ke `feature-workflow` skill, Step 3: validator
screen-only → co-located di `ui/screens/[Screen]/`; lintas-screen satu fitur →
`features/*/ui/validators/`; lintas-fitur → `packages/core/ui/validators/`. Meniru pola
placement table yang sudah ada di `component-spliting` skill untuk komponen. Detail lengkap dan
bukti kode ada di `TAGSAMURAI-NOTES.md` §1–2.

## 6. 8 skill milik `@wangs-ui/skills` — TIDAK dibundel ke `wangs-agent`

**Status: TERBUKA — rekomendasi sudah diberikan, belum ada konfirmasi eksplisit dari user.**

Ditanya user: "mending dibundle dan di-manage di dalam sini?" Rekomendasi saya: **tidak** —
`@wangs-ui/skills` (`create-form`, `data-table`, `dialog-modal`, `i18n-usage`,
`layout-navigation`, `wangs-ui-components`, dan 2 yang sekarang sudah pindah status, lihat §7)
dimiliki & dirilis tim Wangs UI React sendiri, siklus rilis terpisah dari `wangs-agent`, dan
paketnya sudah punya distribusi sendiri yang lebih luas (Antigravity, OpenCode, Kilo — bukan
cuma Claude Code) yang tidak terbantu kalau di-vendor ke `wangs-agent`. Risiko: setiap
`@wangs-ui/skills` rilis, `wangs-agent` juga harus rilis ulang untuk konten yang bukan
miliknya, dan makin jarang `wangs-agent` di-build ulang, makin basi (bukti nyata: isinya
sekarang masih pakai nama tool MCP versi lama).

Catatan teknis yang ditemukan sambil investigasi (relevan kalau opsi ini dibuka lagi nanti):
paket `@wangs-ui/skills` **tidak** punya `.claude-plugin/plugin.json`, jadi tidak bisa
langsung ditunjuk lewat `Options.plugins` seperti `wangs-plugin/` sendiri — kalau suatu saat
mau dibundel, butuh langkah vendoring/copy eksplisit (dependency + build script), bukan
sekadar path pointer.

## 7. `react19-compiler-typescript` + `typescript-strict-typing` — jadi _primary rules_, bukan skill

**Status: DIPUTUSKAN.** Diklasifikasi ulang oleh user secara eksplisit: "ini bukan skill, itu
rules utama". Bedanya dengan skill (§2): skill itu _discoverable_ — model boleh pilih
invoke atau tidak (dan sering diabaikan, sesuai keluhan user sebelumnya). Rules utama harus
selalu ada di context, tidak digantungkan ke keputusan model.

Implementasi: `rules/react19-compiler-typescript.md` + `rules/typescript-strict-typing.md`
(isi lengkap, disalin verbatim dari `@wangs-ui/skills`, TIDAK diringkas — pilihan eksplisit
user). Disimpan sebagai file markdown biasa, bukan TS string constant, "biar maintainnya
gampang" (permintaan eksplisit user). Loader kecil di `src/coding-rules.ts` baca kedua file
saat module-load, digabung jadi `CODING_RULES`.

Disuntik ke **dua tempat**:

- `session-options.ts` — chat interaktif, digabung dengan `WANGS_PERSONA_APPEND`.
- `pipeline/agent-runner.ts` — **bug nyata ditemukan sambil implementasi**: file ini (satu-
  satunya pemanggil model untuk fase pipeline) sebelumnya **tidak punya `systemPrompt` sama
  sekali**. Tidak ada rule `wangs-agent` apa pun yang pernah nyampe ke fase yang justru
  menulis kode (`data-layer`, `test-contract`, `ui-slice`, `connect`, `review`) — cuma nyampe
  ke chat ad-hoc. Sudah diperbaiki di commit yang sama.

Alasan memilih isi lengkap (bukan ringkas): dicek dulu secara kuantitatif — dari 1409 baris
gabungan 8 skill `@wangs-ui/skills`, cuma ~6% yang benar-benar soal "panggil MCP tool ini";
sisanya domain knowledge/konvensi yang tidak bisa didapat dari MCP mana pun. Dua skill ini
spesifik malah 0% MCP.

## 8. `graphify.md` (rule tagsamurai) — TIDAK perlu dibundel, dan dikonfirmasi otomatis tersedia

**Status: DIPUTUSKAN — dikonfirmasi live, bukan asumsi.** `tagsamurai-monorepo/.agents/rules/graphify.md`
mengarahkan pemakaian tool `graphify` (knowledge graph codebase) — tapi itu skill level
**akun** developer (`~/.claude/skills/graphify`), bukan konvensi Wangs Foundation. Dites
langsung: jalankan sesi `wangs-agent` nyata lewat `session-options.ts`, panggil
`q.supportedCommands()` — `graphify` **muncul otomatis**, ditandai `(user)`:

```json
{ "name": "graphify", "description": "Use for any question about a codebase...", ... }
```

Kesimpulan: `wangs-agent` tidak perlu bundel apa pun untuk ini — SDK session-nya sudah
mewarisi skill level akun developer yang menjalankannya (`settingSources` tidak dibatasi di
`session-options.ts`, jadi default "semua sumber dimuat" berlaku). Membundel graphify ke
`wangs-agent` justru salah asumsi — mengasumsikan setiap pengguna `wangs-agent` pasti punya
graphify ter-install di mesinnya sendiri, padahal itu murni setup personal, bukan sesuatu
yang Wangs Foundation proyek-nya syaratkan.

## 9. `i18n-usage` — TIDAK naik jadi primary rule, tetap skill eksternal

**Status: TERBUKA — rekomendasi sudah diberikan, belum ada konfirmasi eksplisit dari user.**

Ditanya user: setelah react19-compiler-typescript & typescript-strict-typing naik status jadi
_primary rules_ (§7), apa `i18n-usage` juga perlu naik status yang sama? Rekomendasi saya:
**tidak** — tetap di kelompok §6 (skill eksternal `@wangs-ui/skills`, bukan dibundel).

Garis pembeda yang dipakai (bukan "seberapa sering dipakai" — i18n hampir selalu relevan,
tiap screen punya teks user-facing — tapi **siapa pemilik kontennya**):

- react19-compiler-typescript & typescript-strict-typing: disiplin TypeScript/React murni,
  tetap berlaku walau proyeknya nol komponen Wangs UI.
- `i18n-usage`: seluruhnya tentang API `@wangs-ui/react-i18n` spesifik (`useI18n()`,
  `useLocaleFormatter()`, `WangsUiI18nProvider`, backend JIT) — kategori sama dengan
  `data-table`/`dialog-modal`, dimiliki & dirilis tim Wangs UI React, bukan `wangs-agent`.
  Risiko sama seperti §6: `wangs-agent` harus ikut rilis ulang tiap `@wangs-ui/react-i18n`
  berubah API, untuk konten yang bukan miliknya.

Jaring pengaman yang sudah ada tanpa perlu bundling penuh: skill `design-system` (sudah
dibundel) sudah eksplisit mewajibkan `t('...')` di tiap string user-facing — aturan dasarnya
tetap selalu ada di context; detail dalamnya (sintaks ICU, larangan dotted key, dll) tetap di
skill `i18n-usage` yang discoverable via `@wangs-ui/skills`.

## 10. Doc arsitektur (`docs/01-overview.md`, `03-feature-pattern.md`, `10-conventions.md`) — pindah jadi primary rules juga

**Status: DIPUTUSKAN.** User bertanya balik: "kenapa 10 dokumen arsitektur ini malah ada di repo
[target] itu sendiri? kenapa bukan bagian dari agent ini, karena agent ini ditujukan untuk
menghasilkan kode sesuai arsitektur itu." Pertanyaan ini muncul setelah saya melaporkan
`10-conventions.md` dirujuk skill `slicing-review` tapi tidak ada di `wangs-monorepo-foundation`.

Bukti konkret yang langsung ditemukan sambil investigasi (bukan hipotetis): isi
`wangs-monorepo-foundation/docs/01-overview.md` **masih** bilang selector cuma
`aria-label`/`accessibilityLabel` — persis versi basi yang baru diperbaiki di skill `wangs-agent`
beberapa commit sebelumnya (§ fix TestSpectra `title`/`aria-labelledby`). Dua sumber yang
seharusnya konsisten sudah drift dalam hitungan menit. Konfirmasi juga: isi `01-overview.md` dan
`03-feature-pattern.md` genuinely generik (pakai "catalog" sebagai contoh placeholder, scope
`@wangs-foundation/*` ilustratif, nol konten spesifik bisnis) — tidak ada alasan itu harus tinggal
per-proyek.

Mekanisme akses (dikonfirmasi user): **disuntik ke system prompt**, sama seperti
react19-compiler-typescript/typescript-strict-typing (§7) — bukan file yang di-`Read` model dari
proyek target. `src/coding-rules.ts` diganti nama jadi `src/primary-rules.ts` (`CODING_RULES` →
`PRIMARY_RULES`) karena cakupannya sekarang bukan cuma gaya coding, tapi juga arsitektur.

Implementasi:

- `rules/architecture-overview.md`, `rules/feature-pattern.md` — diadaptasi verbatim dari
  `wangs-monorepo-foundation/docs/01-overview.md`/`03-feature-pattern.md`, sekalian diperbaiki
  tabel selector-nya.
- `rules/conventions.md` — **baru**, karena `wangs-monorepo-foundation` tidak pernah punya
  `docs/10-conventions.md` meski dirujuk skill. Diadaptasi dari versi `tagsamurai-monorepo`
  (`@tagsamurai/*` → scope ilustratif, referensi `.agents/AGENTS.md` dihapus).
- Semua rujukan `docs/NN-*.md` di skill (`feature-workflow`, `design-system`, `slicing-review`)
  dan `prompts.ts` diganti ke nama rule baru.

**Sisi `wangs-monorepo-foundation`**: `docs/01-overview.md`/`03-feature-pattern.md` **tidak
dihapus** — diubah jadi pointer singkat + ringkasan (bukan duplikat penuh), karena 8+ file kode
produksi nyata (`FeatureGraphBuilder.ts`, `CatalogList.tsx`, `SystemStatus.tsx`, dst.) masih
mengutip path itu di komentar; menghapusnya akan membuat referensi itu menggantung. Duplikat penuh
juga sengaja dihindari — itu persis yang menyebabkan drift yang baru ditemukan. Ditemukan juga
(dicatat, tidak diperbaiki — di luar cakupan): `CatalogList.tsx`/`SystemStatus.tsx` mengutip
section "Top-Level Screens and Tabs Must Not Accept Props" yang tidak ada di versi manapun
(termasuk sebelum migrasi ini) — referensi menggantung lama yang tidak terkait migrasi ini.

---

## Terbuka / belum ditindaklanjuti

Hal-hal yang sudah diajukan tapi user belum memutuskan — jangan diasumsikan disetujui:

- **Perluasan gate mekanis di `gates.ts`** — saya usulkan menambah grep nyata untuk hal yang
  sekarang cuma soft-enforced lewat skill/rules (mis. keberadaan folder `model/`, lokasi
  validator relatif ke jumlah screen pemakainya) — pola sama dengan
  `checkSelectorContract`/`checkDependencyRules` yang sudah ada. User belum merespons usulan
  konkretnya.
- **§6 di atas** (bundel 8 skill `@wangs-ui/skills`) — rekomendasi "jangan" sudah diberikan,
  belum ada konfirmasi final.
- **§9 di atas** (`i18n-usage` naik jadi primary rule) — rekomendasi "jangan, tetap eksternal"
  sudah diberikan, belum ada konfirmasi final.

## Dibatalkan

- Diagram Mermaid di `docs/source-map.html` sempat diganti total jadi CSS/HTML murni (karena
  dikira mermaid-nya bermasalah), lalu **di-undo** (`git reset --hard`) setelah root cause
  ditemukan (alias `OPT` bentrok keyword reserved `opt`) — mermaid dipertahankan, cuma
  di-rename. Bukan keputusan skill/rules, dicatat di sini cuma sebagai contoh: jangan ganti
  arsitektur besar kalau akar masalahnya ternyata kecil.
