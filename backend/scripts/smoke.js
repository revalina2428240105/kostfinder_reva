import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '../../.env') });
const prisma = new PrismaClient();
const base = process.env.API_URL || 'http://localhost:4000';
const startAt = new Date();
let bookingId;
let invoiceId;
let paymentId;
let tenantId;
let registeredUserId;
let proofPath;

async function cleanMarkedRuns() {
  const oldRuns = await prisma.booking.findMany({ where: { decisionNote: 'Smoke test', room: { id: 'senja-harian' } }, select: { id: true } });
  for (const row of oldRuns) {
    const invoices = await prisma.invoice.findMany({ where: { bookingId: row.id }, include: { payments: true } });
    const payments = invoices.flatMap(invoice => invoice.payments);
    for (const payment of payments) if (payment.proofUrl) {
      const fileName = new URL(payment.proofUrl, base).searchParams.get('file');
      const target = path.resolve(scriptDir, '..', 'private-uploads', path.basename(fileName || ''));
      if (fileName && fs.existsSync(target)) fs.unlinkSync(target);
    }
    const paymentIds = payments.map(payment => payment.id);
    const invoiceIds = invoices.map(invoice => invoice.id);
    await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: row.id } });
    await prisma.booking.delete({ where: { id: row.id } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [row.id, ...invoiceIds, ...paymentIds] } } });
  }
}

async function request(url, { token, ...options } = {}) {
  const response = await fetch(`${base}${url}`, {
    ...options,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, result };
}

async function login(email) {
  const { response, result } = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'KostfinderDemo123!' }),
  });
  assert.equal(response.status, 200, `Login demo gagal: ${result.error || response.status}`);
  return result;
}

try {
  await cleanMarkedRuns();
  const owner = await login('pemilik@kostfinder.test');
  const tenant = await login('penghuni@kostfinder.test');
  tenantId = tenant.user.id;

  const signupId = randomUUID().slice(0, 8);
  const { response: registerResponse, result: registered } = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Akun Uji', email: `smoke-${signupId}@kostfinder.test`, password: 'SmokeTest123!', terms: true, role: 'OWNER' }),
  });
  assert.equal(registerResponse.status, 201, 'Registrasi penghuni berhasil');
  assert.equal(registered.user.role, 'TENANT', 'Registrasi publik tidak dapat membuat akun pemilik');
  registeredUserId = registered.user.id;

  const { response: listingResponse, result: listing } = await request('/api/rooms');
  assert.equal(listingResponse.status, 200, 'Katalog guest harus terbuka');
  assert.ok(listing.total >= 4, 'Seed harus menyediakan beberapa kamar');

  const { response: forbiddenResponse } = await request('/api/properties/mine', { token: tenant.token });
  assert.equal(forbiddenResponse.status, 403, 'Penghuni tidak boleh mengakses properti pemilik');

  const room = listing.items.find(item => item.id === 'senja-harian');
  assert.ok(room, 'Kamar demo harian tersedia');
  const checkIn = new Date(Date.now() + 550 * 86400000);
  checkIn.setUTCHours(0, 0, 0, 0);
  const { response: bookingResponse, result: booking } = await request('/api/bookings', {
    token: tenant.token,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId: room.id, checkIn: checkIn.toISOString(), duration: 1 }),
  });
  assert.equal(bookingResponse.status, 201, `Booking gagal: ${booking.error || bookingResponse.status}`);
  bookingId = booking.id;
  assert.equal(Number(booking.total), Number(room.price), 'Server menghitung total dari harga kamar');
  const { response: duplicateBookingResponse } = await request('/api/bookings', {
    token: tenant.token,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId: room.id, checkIn: checkIn.toISOString(), duration: 1 }),
  });
  assert.equal(duplicateBookingResponse.status, 409, 'Booking pada periode bentrok harus ditolak');

  const { response: approvalResponse } = await request(`/api/bookings/${bookingId}/decision`, {
    token: owner.token,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'APPROVED', note: 'Smoke test' }),
  });
  assert.equal(approvalResponse.status, 200, 'Pemilik dapat menyetujui booking miliknya');

  const { result: invoices } = await request('/api/invoices/mine', { token: tenant.token });
  const invoice = invoices.find(item => item.bookingId === bookingId);
  assert.ok(invoice, 'Persetujuan booking membuat tagihan');
  invoiceId = invoice.id;

  const form = new FormData();
  form.append('invoiceId', invoiceId);
  form.append('proof', new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'smoke-proof.png');
  const { response: paymentResponse, result: payment } = await request('/api/payments', {
    token: tenant.token,
    method: 'POST',
    body: form,
  });
  assert.equal(paymentResponse.status, 201, `Upload bukti pembayaran gagal: ${payment.error || paymentResponse.status}`);
  paymentId = payment.id;
  const proofUrl = new URL(payment.proofUrl, base);
  proofPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'private-uploads', path.basename(proofUrl.searchParams.get('file')));

  const { response: anonymousProofResponse } = await request(proofUrl.pathname + proofUrl.search);
  assert.equal(anonymousProofResponse.status, 401, 'Bukti pembayaran tidak boleh dibuka guest');
  const { response: privateProofResponse } = await request(proofUrl.pathname + proofUrl.search, { token: owner.token });
  assert.equal(privateProofResponse.status, 200, 'Pemilik terkait dapat membuka bukti pembayaran');

  const { response: verifyResponse } = await request(`/api/payments/${paymentId}/decision`, {
    token: owner.token,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'APPROVED', note: 'Smoke test' }),
  });
  assert.equal(verifyResponse.status, 200, 'Pemilik dapat memverifikasi pembayaran');

  const { response: reportResponse, result: report } = await request('/api/reports/summary', { token: owner.token });
  assert.equal(reportResponse.status, 200, 'Pemilik dapat membuka ringkasan laporan');
  assert.ok(Number(report.verifiedRevenue) >= Number(payment.amount), 'Pembayaran disetujui masuk pendapatan terverifikasi');
  const { response: csvResponse, result: csv } = await request('/api/reports/transactions.csv', { token: owner.token });
  assert.equal(csvResponse.status, 200, 'Pemilik dapat mengekspor laporan');
  assert.match(csv, /Nomor Tagihan/);
  const { response: tenantReportResponse } = await request('/api/reports/summary', { token: tenant.token });
  assert.equal(tenantReportResponse.status, 403, 'Penghuni tidak boleh membuka laporan keuangan pemilik');
  console.log('Smoke test lulus: katalog guest, login dan registrasi role aman, role guard, booking dan bentrok tanggal, invoice, bukti privat, verifikasi pembayaran, laporan dan CSV.');
} finally {
  if (paymentId) await prisma.paymentStatusHistory.deleteMany({ where: { paymentId } });
  if (paymentId) await prisma.payment.deleteMany({ where: { id: paymentId } });
  if (invoiceId) await prisma.invoice.deleteMany({ where: { id: invoiceId } });
  if (bookingId) await prisma.bookingStatusHistory.deleteMany({ where: { bookingId } });
  if (bookingId) await prisma.booking.deleteMany({ where: { id: bookingId } });
  const ids = [bookingId, invoiceId, paymentId].filter(Boolean);
  if (ids.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  if (tenantId) await prisma.notification.deleteMany({ where: { userId: tenantId, createdAt: { gte: startAt } } });
  if (registeredUserId) await prisma.user.delete({ where: { id: registeredUserId } });
  if (proofPath && fs.existsSync(proofPath)) fs.unlinkSync(proofPath);
  await prisma.$disconnect();
}
