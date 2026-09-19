# Catatan Perbandingan: tagsamurai-monorepo vs Wangs Foundation (wangs-agent)

**Tujuan dokumen ini**: mencatat keputusan arsitektur yang diambil saat memigrasikan/mengadaptasi
skill, subagent, dan rules dari `tagsamurai-monorepo` ke `wangs-agent` — supaya kalau ada yang
mempertanyakan kenapa sesuatu berubah (atau kenapa sesuatu _sengaja_ tidak dibawa), alasannya sudah
tercatat dengan bukti konkret, bukan harus diingat-ingat atau ditebak ulang.

Sumber pembanding yang benar-benar dibaca isinya (bukan asumsi): `/Volumes/Home/Documents/tagsamurai-monorepo/.agents/{rules,agents,skills,mcp_config.json}`, dan implementasi nyata di `packages/features/auth/model/`.

Ditulis: 2026-09-19.

---

## 1. Kenapa "Model" layer dihapus, tapi validator tetap punya tempat

**Fakta yang ditemukan**: folder `model/` di tagsamurai (lihat `packages/features/auth/model/`) berisi
dua hal yang sifatnya sangat berbeda, digabung jadi satu:

- `model/validation/validation.ts` — **genuinely berguna**, platform-agnostic:

  ```ts
  import { MaxLength, Validator, Required } from "@wangs-ui/form/core";
  export const emailValidators = [Required(...), Email(...), MaxLength(120, ...)];
  export const passwordValidators = [Required(...)];
  ```

  Tidak ada import React/DOM/platform-spesifik — validator ini memang bisa dipakai dari View Web
  maupun Native karena `@wangs-ui/form/core` cross-platform.

- `model/entity/user.ts` — **stub tanpa nilai tambah**:
  ```ts
  export type UserEntity = Record<string, unknown>;
  ```
  Bayangan kosong dari DTO, tidak ada field nyata, tidak menambah apa pun.

**Keputusan**: aturan "no Model layer" di Wangs Foundation (`feature-workflow` skill, §"two code
layers") menghapus KEDUANYA sekaligus, padahal masalah sebenarnya cuma yang kedua — DTO sudah jadi
entity type, tidak perlu bayangan lagi. Yang pertama (validator lintas-platform) tetap butuh tempat.

**Jangan ditafsirkan** aturan "no Model layer" ini berarti "validator tidak boleh di-share" — itu bukan
maksudnya, dan kalau ada yang komplain "kok validator jadi susah di-share", jawabannya ada di §2.

---

## 2. Penempatan validator: tabel tiga-tingkat (bukan folder baru sejajar `data/`/`ui/`)

Mengikuti pola yang sudah ada di skill `component-spliting` untuk komponen, diterapkan ke validator
(diupdate di `feature-workflow` skill, Step 3 — commit `wangs-agent@0.3.3`):

| Cakupan validator                                                 | Lokasi                               |
| ----------------------------------------------------------------- | ------------------------------------ |
| Cuma satu screen (Web + Native-nya sekaligus, karena satu folder) | co-located di `ui/screens/[Screen]/` |
| Lintas-screen tapi masih satu fitur                               | `features/*/ui/validators/`          |
| Lintas-fitur                                                      | `packages/core/ui/validators/`       |

**Kenapa di bawah `ui/`, bukan folder baru** (`features/[feature]/validators/` sejajar `data/`/`ui/`):
menaruhnya sejajar akan mengulang pola pikir "folder ketiga di level fitur" yang justru sedang
dihindari. Validator bukan `data/` (tidak menyentuh DTO/API), jadi tetap di sisi UI — konsisten dengan
`ui/components/` yang sudah lebih dulu jadi precedent untuk "shared dalam satu fitur, bukan satu
screen".

---

## 3. Entity type: DTO adalah satu-satunya tipe, tidak ada duplikat

Tidak berubah dari keputusan awal `wangs-monorepo-foundation`, cuma dikonfirmasi ulang dengan bukti
nyata di §1: `UserEntity = Record<string, unknown>` di tagsamurai adalah contoh persis kenapa aturan
ini ada — bukan argumen untuk menghidupkannya lagi.

---

## 4. Penamaan subagent & nama tool MCP — beda, **belum diverifikasi kenapa**

Dicatat sebagai perbedaan yang diketahui, bukan diselesaikan:

|                              | tagsamurai (`.agents/agents/`, `.agents/rules/mcp-subagent-protocol.md`)                     | wangs-agent (`src/subagents.ts`)                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Penamaan subagent            | `wangs-ui_querier`, `ui_design_reader`, `functional_reader`, `test_case_reader` (underscore) | `wangs-ui-querier`, `ui-design-reader`, `functional-reader`, `test-case-reader` (kebab-case) |
| Nama tool MCP yang dipanggil | `list-all-documentation`, `get-documentation`, `get-documentation-for-story`, `query_graph`  | `mcp__wangs-ui__docs-list`, `mcp__wangs-ui__docs-show`, `mcp__wangs-ui__docs-show-story`     |

Kemungkinan ini beda versi `@wangs-ui/mcp` (tagsamurai mungkin pakai versi lebih lama dengan tool
surface berbeda), tapi ini **belum dicek langsung** — kalau ada laporan `wangs-ui-querier` gagal
manggil tool yang tidak ada, cek versi `@wangs-ui/mcp` yang ter-resolve dulu sebelum menyalahkan kode
`subagents.ts`.

---

## 5. Registry `@wangs-ui/mcp` — sengaja tidak di-hardcode

**Fakta**: `tagsamurai-monorepo/.agents/mcp_config.json` menjalankan MCP server dengan
`npx -y --registry=http://192.168.1.102:4873/ @wangs-ui/mcp@latest` — IP registry privat di-hardcode.
Dicek langsung ke `registry.npmjs.org`: `@wangs-ui/mcp` **tidak ada** di registry publik (`{"error":"Not found"}`).

**Keputusan** (dikonfirmasi user): `wangs-agent/src/subagents.ts` **tidak** hardcode `--registry=`
apa pun — mengandalkan `.npmrc` konsumer untuk scope `@wangs-ui`, persis seperti syarat install
`@wangs-ui/react-core` dkk lainnya di proyek Wangs Foundation manapun. Alasan: IP `192.168.1.102` cuma
valid di jaringan/mesin tertentu dengan uptime terbatas — bukan hostname stabil, jadi tidak layak
di-hardcode ke package yang dipublish. Untuk development tanpa server privat yang selalu nyala: build
`wangs-ui-react-main` dan publish ke Verdaccio lokal.

Kalau ada laporan `wangs-ui-querier` gagal connect MCP dengan pesan package tidak ditemukan — itu
bukan bug, itu berarti `.npmrc` proyek yang menjalankan `wangs-agent` belum mengarahkan scope
`@wangs-ui` ke registry privat yang benar.

---

## 6. Rules tagsamurai yang **tidak** dibawa ke wangs-agent, dan kenapa

Sudah dicek satu-satu isinya (bukan diasumsikan tidak relevan):

| File di tagsamurai       | Kenapa tidak dibawa                                                                                                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.md`               | Seluruh isinya tentang Model layer 3-tingkat yang memang dihapus — lihat §1 dan §3                                                                                                                                                                                   |
| `ui-slicing.md`          | Proses lebih berat: implementation-plan-first + approval gate manual per section, "Model Entity Sync" — semua asumsi 3-layer. `feature-workflow` skill wangs-agent punya proses sendiri (2-layer, approval gate per-fase lewat pipeline `needs_input`, bukan manual) |
| `code-comments.md`       | Isinya ("jangan tambah komentar kecuali diminta") sudah jadi perilaku default assistant, tidak perlu file rule terpisah                                                                                                                                              |
| `datatable.md`           | Lebih spesifik dari `design-system` skill (mewajibkan `useDataTableFetch` placeholder dst.) — belum ada padanannya di wangs-agent, **kandidat untuk ditambahkan kalau DataTable mulai dipakai di fitur nyata**                                                       |
| `wangs-ui-components.md` | Isinya ("selalu cek MCP sebelum pakai prop") sudah tercakup di persona + `design-system` skill                                                                                                                                                                       |
| `graphify.md`            | Bukan hal spesifik proyek — itu skill level akun pengguna (`~/.claude/skills/graphify`)                                                                                                                                                                              |
| `test.md`                | Proses e2e berbeda total: tagsamurai pakai Playwright-style `.page.ts` manual dengan proses per-scenario approval; wangs-agent pakai TestSpectra ambient-global (`feature-workflow` skill, Step 2)                                                                   |

**`datatable.md` ditandai sebagai satu-satunya yang genuinely mungkin masih kurang** — kalau ada fitur
nyata yang pakai `DataTable` dan sering ada masalah prop/column yang tidak terverifikasi, itu alasan
untuk menambahkan versi 2-layer dari rule ini, bukan indikasi migrasi ini salah.

---

## Perubahan terkait di `wangs-agent` (untuk ditelusuri commit-nya kalau perlu)

- `973fb57` — Merge pipeline `agentic-feature-loop` in-process
- `40a8447` — oxlint + oxfmt
- `973fb57`/`e9e0aa8` — Bundle subagent (`Options.agents`) & skill (`Options.plugins`) native ke wangs-agent
- `e9e0aa8` — Fix registry MCP wangs-ui (lihat §5)
- `f301109` — Fix mermaid syntax error (tidak terkait tagsamurai, cuma dokumentasi internal)
- commit terbaru — Validator placement table (lihat §2)
