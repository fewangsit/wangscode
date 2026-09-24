# Keputusan Skill / Subagent / Rules — Log

Catatan hidup: setiap keputusan soal skill, subagent, atau rules di `wangscode` dicatat di
sini saat diputuskan — bukan ditulis ulang dari ingatan nanti. Urut kronologis, entri terbaru
di bawah. Status tiap entri: **DIPUTUSKAN** (sudah diimplementasikan), **TERBUKA** (rekomendasi
sudah diberikan, belum dikonfirmasi user), atau **DITINGGALKAN** (sempat diputuskan, lalu
dibatalkan — lihat §"Dibatalkan").

---

## 1. Subagent dibundel programatik (`Options.agents`), bukan file `.claude/agents/*.md`

**Status: DIPUTUSKAN.** 4 subagent (`wangs-ui-querier`, `ui-design-reader`, `functional-reader`,
`test-case-reader`) didefinisikan sebagai objek `AgentDefinition` langsung di
`src/subagents.ts`, bukan file markdown yang harus di-generate ulang per proyek konsumen.
Alasan: consumer repo butuh nol config untuk fitur ini — cukup install `wangscode`, tidak
perlu `.claude/agents/`.

## 2. Skill dibundel via `Options.plugins`, bukan `.claude/skills/*/SKILL.md`

**Status: DIPUTUSKAN.** 4 skill proyek-spesifik (`feature-workflow`, `slicing-review`,
`design-system`, `component-spliting`) dibundel fisik sebagai file `SKILL.md` di
`wangs-plugin/`, dimuat lewat `Options.plugins`. Sama alasannya dengan §1 — zero-config di
consumer repo, dan update `wangscode` = update skill-nya, tidak perlu sync manual per
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

## 6. 8 skill milik `@wangs-ui/skills` — TIDAK dibundel ke `wangscode`

**Status: TERBUKA — rekomendasi sudah diberikan, belum ada konfirmasi eksplisit dari user.**

Ditanya user: "mending dibundle dan di-manage di dalam sini?" Rekomendasi saya: **tidak** —
`@wangs-ui/skills` (`create-form`, `data-table`, `dialog-modal`, `i18n-usage`,
`layout-navigation`, `wangs-ui-components`, dan 2 yang sekarang sudah pindah status, lihat §7)
dimiliki & dirilis tim Wangs UI React sendiri, siklus rilis terpisah dari `wangscode`, dan
paketnya sudah punya distribusi sendiri yang lebih luas (Antigravity, OpenCode, Kilo — bukan
cuma Claude Code) yang tidak terbantu kalau di-vendor ke `wangscode`. Risiko: setiap
`@wangs-ui/skills` rilis, `wangscode` juga harus rilis ulang untuk konten yang bukan
miliknya, dan makin jarang `wangscode` di-build ulang, makin basi (bukti nyata: isinya
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
  sekali**. Tidak ada rule `wangscode` apa pun yang pernah nyampe ke fase yang justru
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
langsung: jalankan sesi `wangscode` nyata lewat `session-options.ts`, panggil
`q.supportedCommands()` — `graphify` **muncul otomatis**, ditandai `(user)`:

```json
{ "name": "graphify", "description": "Use for any question about a codebase...", ... }
```

Kesimpulan: `wangscode` tidak perlu bundel apa pun untuk ini — SDK session-nya sudah
mewarisi skill level akun developer yang menjalankannya (`settingSources` tidak dibatasi di
`session-options.ts`, jadi default "semua sumber dimuat" berlaku). Membundel graphify ke
`wangscode` justru salah asumsi — mengasumsikan setiap pengguna `wangscode` pasti punya
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
  `data-table`/`dialog-modal`, dimiliki & dirilis tim Wangs UI React, bukan `wangscode`.
  Risiko sama seperti §6: `wangscode` harus ikut rilis ulang tiap `@wangs-ui/react-i18n`
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
`aria-label`/`accessibilityLabel` — persis versi basi yang baru diperbaiki di skill `wangscode`
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

## 11. Gate mekanis baru: `checkNoModelFolder` — cek folder `model/` tidak lagi cuma self-review

**Status: DIPUTUSKAN.** Menutup gap yang ditemukan waktu menjelaskan "gimana agent ini bisa
memaksa patuh": aturan BLOCKER "folder `model/` tidak boleh ada" di skill `slicing-review`
sebelumnya cuma dicek lewat laporan JSON yang **model itu sendiri** tulis di fase `review`
(`findings.filter(f => f.severity === "BLOCKER")`) — tidak ada verifikasi independen. Kalau model
bikin folder `model/` lalu gagal menandainya sendiri saat review, tidak ada yang menangkap.

Ditambahkan `checkNoModelFolder()` di `gates.ts` — `fs.existsSync` murni, pola sama persis dengan
`checkDependencyRules` yang sudah ada. Dipasang di tiga fase yang menulis file
(`data-layer`, `ui-slice`, `connect`) sebelum gate spesifik fase itu sendiri; tidak set
`classification` eksplisit supaya default rewind ke fase yang sedang berjalan (fase yang baru
menulis foldernya) tetap benar.

Diverifikasi nyata (bukan cuma type-check): fixture dengan folder `model/` sungguhan →
`{"ok":false, ...}`; setelah dihapus → `{"ok":true}`.

**Penempatan validator tetap tidak digarap** (lihat daftar terbuka di bawah) — lebih rumit
(butuh hitung jumlah screen pemakai, bukan sekadar exists-check) dan belum ada fitur nyata yang
memakai skema validator baru, jadi belum ada bukti butuh.

## 12. 4 doc arsitektur tersisa dibundel (`packages`, `data-and-server-state`, `error-handling`, `cross-platform`); 3 lainnya sengaja tidak

**Status: DIPUTUSKAN.** Melanjutkan §10 — user tanya balik kemana perginya `docs/04` sampai `09`
tagsamurai yang belum pernah saya nilai. Semua 8 file sisa (`02`, `04`–`09`, `README`) dibaca
penuh, dinilai satu-satu, dipilih user untuk eksekusi 4 yang paling aman dulu.

**Dibundel** (`rules/packages.md`, `rules/data-and-server-state.md`, `rules/error-handling.md`,
`rules/cross-platform.md`) — genuinely generik, tidak konflik dengan kode nyata, melengkapi
`architecture-overview`/`feature-pattern` dengan detail yang belum ada di sana.

**Sengaja TIDAK dibundel:**

- `05-authentication.md` — strategi auth spesifik (HTTP-only cookie), bukan konvensi Wangs
  Foundation yang terkonfirmasi; belum ada fitur auth nyata di `wangs-monorepo-foundation` sebagai
  bukti. Perlu keputusan eksplisit dulu, bukan diasumsikan.
- `06-navigation.md` — **ditemukan bug nyata kalau dipaksa pindah**: API `useNavigation()` +
  `FeatureGraphBuilder` tagsamurai (nested sub-builder, `.getRoutes()`) tidak cocok dengan
  implementasi asli di `wangs-monorepo-foundation/packages/infrastructure/navigation/FeatureGraphBuilder.ts`
  yang jauh lebih sederhana (`composable(path, component): void`, `build(): RouteEntry[]`).
  Memindahkan versi tagsamurai akan mengajarkan API yang salah ke pipeline. Kalau mau dibuat rule
  navigasi, harus ditulis ulang dari kode asli, bukan disalin.
- `09-build-and-caching.md` — soal setup package/build baru (Nx graph, export conditions), bukan
  hal yang disentuh fase pipeline manapun (`data-layer`/`ui-slice`/`connect` bekerja di struktur
  yang sudah ada).
- `README.md` — cuma daftar isi + heuristik baca-berurutan untuk manusia; tidak relevan lagi
  karena semua rule sudah unconditionally ada di context, tidak ada "urutan baca" yang perlu
  dijaga.

---

## 13. `rules/navigation.md` — bundel, tapi API-nya bukan dari `06-navigation.md` tagsamurai sama sekali

**Status: DIPUTUSKAN.** Menutup item terbuka §12 soal `06-navigation.md` — tapi bukan dengan cara
yang diperkirakan semula ("tulis ulang dari `FeatureGraphBuilder.ts` asli"). Sebagai gantinya,
user minta navigasi diekstrak jadi package standalone baru (`@wangs-ui/react-navigation`, di
`/Volumes/Home/Documents/wangs-ui-react-navigation`) — dikerjakan lewat sesi terpisah yang panjang
(plan mode, iterasi desain berkali-kali) sebelum akhirnya dibundel ke sini.

**Kenapa bukan tagsamurai atau wangs-monorepo-foundation punya**: keduanya sudah dicek langsung —
tagsamurai (`NavigationGraph.ts`/`StackNavigator.tsx`) punya bug nyata (shape context Native beda
dari Web, tidak ada `replace`, tidak pernah diekspor); wangs-monorepo-foundation punya versi yang
jauh lebih sederhana dan Web-only, tanpa dukungan Native sama sekali. `@wangs-ui/react-navigation`
dibangun dari nol berdasarkan pola tagsamurai tapi dengan 3 bug nyata diperbaiki (shape parity,
`StackActions.replace` asli, `flattenRoutes` tidak lagi men-double-prefix child path yang sudah
fully-qualified), plus fitur baru yang tidak ada di source manapun:

- DSL `composable`/`navigation`/`buildGraph` (functional, bukan builder OOP) — user eksplisit
  minta gaya `pipe`/`chain` (fp-ts-like), lalu direname jadi `buildGraph` karena "pipe" cuma
  contoh, bukan nama final yang diminta.
- `startDestination` di `navigation()`, meniru Compose — Native **sengaja tetap flat** satu
  `Stack.Navigator` (bukan nested navigator), karena Compose sendiri flat di baliknya; nested
  navigator asli React Navigation justru akan menghidupkan lagi masalah `replace` lintas-graph
  yang tidak ada solusi bersih di React Navigation.
- `staticRoute`/`paramRoute` — route jadi value bertipe (mirip `data object`/`data class` Kotlin),
  bukan string path lepas. Ini alasan utama kenapa `packages.md`/`feature-pattern.md`/
  `conventions.md` ikut direvisi (contoh lama `Routes.Catalog.List` + `navigate()` string-based
  sudah tidak valid).

**Yang dibundel**: `rules/navigation.md` (baru) ke `RULE_FILES` di `primary-rules.ts`, plus revisi
di `architecture-overview.md`, `packages.md`, `feature-pattern.md`, `conventions.md`,
`data-and-server-state.md`, `error-handling.md` — semua contoh kode navigasi lama (`useNavigate`,
`navigate(Routes.X.Y)`, `FeatureGraphBuilder`) diganti API nyata `@wangs-ui/react-navigation`.
Dipublish sebagai `wangscode@0.4.3` ke Verdaccio lokal.

**Belum diverifikasi** (diwariskan dari pengembangan package-nya sendiri): tidak ada klik-through
browser atau tap-through Expo Go nyata terhadap `@wangs-ui/react-navigation` — verifikasi cuma
sampai type-check + build + unit test terhadap package yang benar-benar dipublish. Kalau pipeline
`wangscode` mulai menghasilkan kode yang memakai rule ini, perilaku runtime-nya masih perlu
dibuktikan lewat feature nyata, bukan diasumsikan benar dari dokumentasi.

---

## 14. Bug nyata: prompt pipeline nunjuk ke skill yang gak pernah bisa dimuat — diganti jadi injeksi konten langsung

**Status: DIPUTUSKAN.** User tanya balik soal §13 ("feature-workflow apa masih perlu, kan workflow
udah jadi core, bukan optional lagi") — jawabannya justru menemukan bug nyata, bukan sekadar
pertanyaan filosofis.

**Temuan**: `src/pipeline/agent-runner.ts` (headless pipeline: data-layer, test-contract, ui-slice,
connect, review) **sama sekali tidak punya field `plugins` di `Options`-nya** — beda dari
`session-options.ts` (chat interaktif) yang punya `plugins: [{type: "local", path:
WANGS_PLUGIN_ROOT}]`. Tapi `src/pipeline/prompts.ts` men-generate prompt tiap fase dengan kalimat
seperti _"Follow the `feature-workflow` skill's Step 1 exactly"_ atau _"Run the `slicing-review`
skill"_ — instruksi yang menunjuk ke skill yang **tidak mungkin ditemukan/dimuat model** di
panggilan headless itu, karena plugin bundle-nya emang gak pernah didaftarkan di sana. Ditemukan
juga bug kedua di tempat yang sama: `buildDataLayerPrompt` menyebut "the `data-sources` rule" —
rule dengan nama itu tidak pernah ada (yang benar `data-and-server-state`).

**Kenapa ini bug, bukan cuma gaya**: baris komentar `agent-runner.ts` sendiri bilang _"control flow
must live in code the model cannot talk its way around"_ — instruksi "follow skill X" yang gak
bisa dijangkau model itu justru kebalikan dari prinsip itu sendiri: kepatuhan terhadap Step 1-4
`feature-workflow` selama ini bergantung ke referensi yang mengarah ke tempat kosong.

**Fix yang dipilih** (dari 2 opsi yang ditawarkan — user pilih ini, bukan sekadar tambah `plugins:
[...]` ke `agent-runner.ts`): `src/pipeline/skill-content.ts` (baru) baca langsung isi skill dari
disk dan suntik ke string prompt, persis pola `readRule()` di `primary-rules.ts` tapi granular per
section (`readSkillSection(skill, heading)` ekstrak satu `## Heading` sampai heading berikutnya;
`readSkill(skill)` ambil seluruh file, frontmatter YAML dibuang). Setiap `buildXPrompt` di
`prompts.ts` sekarang menyisipkan konten section yang relevan langsung (Step N + "Cross-Layer
Contracts" buat data-layer/test-contract/ui-slice/connect; `design-system` + `component-spliting`
utuh buat ui-slice; `component-spliting` utuh juga buat test-contract yang sebelumnya cuma
menyebut nama skill itu tanpa isi; `slicing-review` utuh buat review) — bukan lagi menyebut nama
skill dan berharap model "menemukan"-nya sendiri.

**Bug turunan yang ketemu saat implementasi**: `skill-content.ts` awalnya menghitung
`PACKAGE_ROOT` dua level ke atas dari lokasinya sendiri (`src/pipeline/`) — benar kalau dijalankan
dari source (`bun src/cli.ts`), **salah** setelah di-build, karena `tsdown` membundel semua entry
point jadi file flat di `dist/` (bukan mempertahankan struktur folder). Diperbaiki dengan
mensentralkan resolusi `PACKAGE_ROOT` ke satu file baru (`src/package-root.ts`, sengaja diletakkan
persis satu level di bawah root — sama di source maupun hasil build), dan `primary-rules.ts` +
`session-options.ts` ikut direfactor supaya cuma ada satu sumber kebenaran, bukan tiga perhitungan
independen yang gampang divergen. Dibuktikan benar dengan mensimulasikan resolusi path terhadap
hasil `dist/` yang sebenarnya (bukan cuma dari source) — `bundler` bahkan men-dedupe jadi satu
ekspresi `PACKAGE_ROOT` yang sama di seluruh chunk, mengonfirmasi tidak ada sisa perhitungan lain
yang salah.

Dipublish sebagai `wangscode@0.4.4` ke Verdaccio lokal.

---

## Terbuka / belum ditindaklanjuti

Hal-hal yang sudah diajukan tapi user belum memutuskan — jangan diasumsikan disetujui:

- **Gate mekanis untuk penempatan validator** — beda dari cek folder `model/` (§11, sudah
  selesai), ini butuh menghitung berapa screen yang meng-import satu file validator untuk tahu
  apa dia sudah di tier yang benar — bukan sekadar exists-check. Sengaja ditunda: belum ada
  fitur nyata yang pakai skema validator 3-tingkat ini, jadi belum ada bukti konkret butuh gate
  ini sekarang (lihat prinsip "jangan desain untuk kasus hipotetis").
- **§6 di atas** (bundel 8 skill `@wangs-ui/skills`) — rekomendasi "jangan" sudah diberikan,
  belum ada konfirmasi final.
- **`05-authentication.md`** (§12) — belum diputuskan apa strategi HTTP-only cookie ini memang
  standar Wangs Foundation atau spesifik tagsamurai. Butuh jawaban eksplisit sebelum dibundel.
- **§9 di atas** (`i18n-usage` naik jadi primary rule) — rekomendasi "jangan, tetap eksternal"
  sudah diberikan, belum ada konfirmasi final.

## Dibatalkan

- Diagram Mermaid di `docs/source-map.html` sempat diganti total jadi CSS/HTML murni (karena
  dikira mermaid-nya bermasalah), lalu **di-undo** (`git reset --hard`) setelah root cause
  ditemukan (alias `OPT` bentrok keyword reserved `opt`) — mermaid dipertahankan, cuma
  di-rename. Bukan keputusan skill/rules, dicatat di sini cuma sebagai contoh: jangan ganti
  arsitektur besar kalau akar masalahnya ternyata kecil.
