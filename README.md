# KostFinder

Platform pencarian, pemesanan, dan pengelolaan kos. Aplikasi memakai React + Vite, Express, Prisma, dan PostgreSQL.

## Kebutuhan

- Node.js 20 atau lebih baru dan npm.
- PostgreSQL 14+ lokal, atau Docker Desktop untuk menjalankan PostgreSQL dari `docker-compose.yml`.
- Port 5432, 4000, dan 5173 tersedia.

## Menjalankan di komputer lokal

1. Salin `.env.example` menjadi `.env` di folder utama. Untuk konfigurasi Docker yang disediakan, nilai `DATABASE_URL` contoh dapat digunakan. Ganti `JWT_SECRET` dengan string rahasia acak yang panjang (minimal 32 karakter).
2. Buka terminal pada folder proyek, lalu jalankan `docker compose up -d postgres`. Alternatifnya, siapkan database PostgreSQL bernama `kostfinder` dan sesuaikan `DATABASE_URL` pada `.env`.
3. Jalankan `npm install`.
4. Jalankan `npm run db:generate`.
5. Jalankan `npm run db:migrate -- --name init` untuk membuat tabel.
6. Jalankan `npm run db:seed` untuk data demonstrasi.
7. Jalankan `npm run dev`. Situs tersedia di `http://localhost:5173`, API di `http://localhost:4000/api/health`.

Untuk memeriksa alur utama setelah API berjalan, jalankan `npm run test:smoke`. Pemeriksaan ini membuat lalu menghapus data booking dan pembayaran uji.

Di Windows PowerShell yang membatasi `npm.ps1`, gunakan `npm.cmd` sebagai pengganti `npm` pada perintah di atas (contoh: `npm.cmd run dev`). Perintah generate Prisma memerlukan akses unduh satu kali ke mesin Prisma. Docker Compose juga mengunduh image PostgreSQL pada pemakaian pertama.

Perintah 4–6 hanya perlu diulang ketika skema database berubah (generate/migrate) atau data demo ingin dibuat ulang (seed). Seed mempertahankan akun dan kamar demonstrasi yang sudah ada.

## Pratinjau publik di Render

Repository menyertakan `render.yaml` untuk membuat satu web service yang menyajikan frontend React dan API Express, database PostgreSQL, migrasi skema, serta akun pemilik awal. Deploy memerlukan repository GitHub yang sudah di-push dan akun Render.

1. Push folder proyek ini ke repository GitHub milikmu.
2. Di Render, pilih **New → Blueprint**, hubungkan repository itu, lalu deploy `render.yaml`.
3. Saat diminta, isi `OWNER_EMAIL` dan `OWNER_PASSWORD` milikmu sendiri. Password harus minimal 12 karakter. Jangan memakai akun/password demo lokal.
4. Setelah deploy sehat, buka URL `*.onrender.com`, masuk sebagai pemilik, buat properti dan kamar, lalu terbitkan listing.

Blueprint saat ini memakai paket gratis untuk pratinjau: web service tidur setelah 15 menit tanpa trafik, PostgreSQL gratis kedaluwarsa setelah 30 hari, dan foto/bukti transfer yang diunggah berada di penyimpanan sementara. Jangan masukkan data penghuni atau pembayaran sungguhan ke deploy pratinjau. Untuk penggunaan nyata, pindahkan PostgreSQL ke paket berbayar dan unggahan ke object storage persisten sebelum menerima data. Render menjelaskan batas ini di [dokumentasi paket gratis](https://render.com/docs/free) dan [penyimpanan persisten](https://render.com/docs/disks).

Render menjalankan migrasi Prisma otomatis saat service mulai. Akun pemilik pertama dibuat sekali melalui `initialDeployHook`; pendaftaran publik tetap hanya membuat akun penghuni. Data demo lokal tidak dimasukkan ke database publik.

## Akun demonstrasi

- Pemilik: `pemilik@kostfinder.test`
- Penghuni: `penghuni@kostfinder.test`
- Password kedua akun: `KostfinderDemo123!`

Akun pemilik tidak dapat dibuat lewat registrasi publik. Registrasi publik selalu membuat akun penghuni. Akun demo hanya untuk lingkungan lokal; ganti kredensial dan rahasia sebelum penggunaan nyata.

## Database dan data

Schema Prisma ada di `backend/prisma/schema.prisma`. Semua nilai uang disimpan sebagai `Decimal`. Tabel mencakup user, properti, kamar, fasilitas, booking dan riwayat status, invoice, pembayaran dan riwayat status, notifikasi, serta audit log. Properti dan kamar yang telah punya riwayat transaksi tidak dapat dihapus; kamar dapat diarsipkan.

Database Docker menyimpan datanya di volume `kostfinder_pg`. Perintah menghentikan layanan tanpa menghapus volume: `docker compose down`.

## API utama

Semua respons error JSON menggunakan bentuk `{ "error": "..." }`. Endpoint terlindungi memerlukan `Authorization: Bearer <token>`.

| Metode | Endpoint | Akses |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | Publik |
| GET | `/api/auth/me` | Login |
| GET | `/api/rooms`, `/api/rooms/:id`, `/api/facilities` | Publik |
| POST/PATCH | `/api/properties`, `/api/properties/:id` | Pemilik |
| GET | `/api/properties/mine` | Pemilik |
| POST/PATCH/DELETE | `/api/rooms`, `/api/rooms/:id` | Pemilik |
| POST/GET | `/api/bookings`, `/api/bookings/mine` | Penghuni |
| GET/PATCH | `/api/bookings/owner`, `/api/bookings/:id/decision` | Pemilik |
| GET/POST | `/api/invoices/mine`, `/api/payments` | Penghuni |
| GET/POST | `/api/invoices/owner`, `/api/invoices` | Pemilik |
| GET/PATCH | `/api/payments/owner`, `/api/payments/:id/decision` | Pemilik |
| GET | `/api/reports/summary`, `/api/reports/transactions.csv`, `/api/tenants` | Pemilik |
| GET/PATCH | `/api/profile`, `/api/notifications` | Login |
| POST | `/api/uploads` | Login |

Pencarian menerima `q`, `city`, `min`, `max`, `type`, `facility`, `sort`, dan `page`. Bukti pembayaran diakses melalui API oleh pengguna yang berwenang; unggahan lokal disimpan dalam `backend/uploads`.

## Alur booking dan pembayaran

Penghuni mengajukan tanggal dan durasi; harga dihitung server dari harga kamar. Pemilik menyetujui atau menolak. Persetujuan menerbitkan invoice. Penghuni mengunggah bukti transfer; pemilik memverifikasi. Hanya pembayaran yang disetujui masuk pendapatan terverifikasi. Versi ini menyediakan pembayaran transfer manual, bukan gateway otomatis.

## Catatan batasan versi demonstrasi

- JWT disimpan pada `sessionStorage` browser sehingga sesi berakhir saat tab/sesi browser ditutup. Untuk produksi, gunakan cookie HttpOnly, HTTPS, rotasi token, dan proteksi CSRF.
- Upload lokal untuk demo, batas 5 MB. Storage publik dan signed URL perlu disiapkan sebelum deployment.
- Foto beberapa kamar seed memakai Unsplash; internet diperlukan untuk gambar eksternal tersebut.
- Filter lokasi dan harga, listing publik, profil, alur booking, verifikasi manual, ringkasan keuangan, dan unduh CSV tersedia melalui API. Integrasi payment gateway tidak diaktifkan.

## Struktur

```text
backend/    Express API, Prisma schema/seed, unggahan lokal
frontend/   React/Vite, halaman publik dan dashboard peran
```
