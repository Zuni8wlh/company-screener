# Company Screener

Upload list company (CSV) → auto-screening status, website, phone, email lewat Claude + web search.

## Cara deploy (Vercel — gratis untuk skala kecil)

1. **Punya API key Anthropic**
   Daftar/login di https://console.anthropic.com → Settings → API Keys → buat key baru.

2. **Push folder ini ke GitHub**
   ```
   cd company-screener
   git init
   git add .
   git commit -m "init"
   git remote add origin <repo-github-kamu>
   git push -u origin main
   ```

3. **Import ke Vercel**
   - Buka https://vercel.com → New Project → pilih repo GitHub ini
   - Saat setup, tambahkan Environment Variable:
     - Key: `ANTHROPIC_API_KEY`
     - Value: API key dari langkah 1
   - Klik Deploy

4. **Selesai** — Vercel kasih URL (misal `company-screener.vercel.app`), tinggal dibuka di browser mana saja, tidak perlu Claude.ai.

## Jalankan lokal dulu (opsional, sebelum deploy)

```
npm install -g vercel
cd company-screener
vercel dev
```
Lalu buat file `.env` (copy dari `.env.example`) isi API key kamu, baru jalankan `vercel dev` lagi. Buka `http://localhost:3000`.

## Struktur file

```
company-screener/
├── api/
│   └── screen.js      ← backend: pegang API key, panggil Anthropic API
├── public/
│   └── index.html     ← frontend: upload CSV, tabel hasil, export CSV
├── package.json
├── vercel.json
└── .env.example
```

## Catatan

- API key **hanya** hidup di server (env var Vercel), tidak pernah terkirim ke browser.
- Biaya jalan: hosting gratis (Vercel free tier), API usage dibayar ke Anthropic sesuai pemakaian (pay-as-you-go).
- Kalau volume company besar (ratusan/ribuan), pertimbangkan tambah database (misal Supabase) untuk simpan progress, karena proses ini masih tergantung tab browser tetap terbuka.
