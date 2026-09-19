# Dev Notes — Local Environment Gotchas

Catatan operasional untuk development di repo ini — bukan tentang kode `wangs-agent`
sendiri, tapi tentang jebakan lingkungan lokal yang sudah ketemu, supaya tidak perlu
didebug ulang dari nol kalau kejadian lagi.

---

## `npm publish` ke Verdaccio lokal hang tanpa pesan error apa pun

**Gejala**: `npm publish --registry http://localhost:4873/` jalan (proses muncul di `ps aux`)
tapi tidak pernah selesai, tidak ada output apa pun, tidak error, tidak juga sukses. Build
sebelumnya (`bun run build`/`tsdown`) selesai normal — masalahnya murni di langkah publish.

**Akar masalah (dikonfirmasi, bukan tebakan)**:

1. Verdaccio lokal (`http://localhost:4873/`) mati di tengah sesi — proses yang menjalankannya
   sebelumnya sudah tidak ada (`ps aux | grep verdaccio` kosong), padahal registry npm masih
   dikonfigurasi menunjuk ke sana (`npm config get registry` → `http://localhost:4873/`).
2. Menjalankan ulang dengan `npx verdaccio` **ikut hang tanpa output** — root cause-nya
   sirkular: `npx` perlu resolve/fetch package `verdaccio` lewat registry yang sedang
   dikonfigurasi, yaitu `http://localhost:4873/` — persis Verdaccio yang belum jalan yang
   sedang coba dinyalakan. `npx` menunggu registry yang tidak akan pernah merespons sampai
   dia sendiri yang menyalakannya — deadlock.

**Fix**: jangan pakai `npx verdaccio`. Jalankan langsung dari binary yang sudah ter-cache di
`~/.npm/_npx/<hash>/node_modules/.bin/verdaccio` (cari hash-nya dengan
`find ~/.npm/_npx -maxdepth 3 -iname "*verdaccio*"`) — ini melewati langkah resolve-versi
`npx` yang butuh registry, langsung pakai binary yang sudah ada di disk.

```bash
# cari binary yang sudah pernah dipakai npx sebelumnya
find ~/.npm/_npx -maxdepth 1 -type d | while read d; do
  [ -f "$d/node_modules/.bin/verdaccio" ] && echo "$d/node_modules/.bin/verdaccio"
done

# jalankan langsung (bukan lewat npx)
~/.npm/_npx/<hash>/node_modules/.bin/verdaccio &
```

Tunggu sampai benar-benar responsif sebelum publish lagi:

```bash
until curl -s -o /dev/null -w "%{http_code}" http://localhost:4873/ --max-time 2 | grep -q 200; do sleep 1; done
```

**Kalau tidak ada cache sama sekali** (belum pernah `npx verdaccio` jalan sukses di mesin ini):
`npm config get registry` harus sementara dialihkan ke registry publik dulu
(`npm config set registry https://registry.npmjs.org/`) supaya `npx` bisa fetch `verdaccio`
untuk pertama kalinya, baru dikembalikan ke `http://localhost:4873/` setelah itu.

---

Ditulis: 2026-09-19, saat publish `wangs-agent@0.3.4`.
