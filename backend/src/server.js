import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const prisma = new PrismaClient();
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const uploadDir = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const privateUploadDir = path.resolve(__dirname, '..', process.env.PRIVATE_UPLOAD_DIR || 'private-uploads');
fs.mkdirSync(privateUploadDir, { recursive: true });
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'https://images.unsplash.com'] } } }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadDir));
const validUpload = (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype) || file.mimetype === 'application/pdf');
const upload = multer({ dest: uploadDir, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: validUpload });
const proofUpload = multer({ dest: privateUploadDir, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: validUpload });
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = asyncRoute(async (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Sesi tidak valid. Silakan masuk kembali.' }); }
});
const role = (...roles) => (req, res, next) => roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Anda tidak memiliki akses.' });
const audit = (actorId, action, entity, entityId, details) => prisma.auditLog.create({ data: { actorId, action, entity, entityId, details } });
const publicRoom = { property: { select: { id: true, name: true, address: true, city: true, district: true, description: true, rules: true, contactPhone: true, facilities: { include: { facility: true } } } }, facilities: { include: { facility: true } } };

app.get('/api/health', asyncRoute(async (_req, res) => { await prisma.$queryRaw`SELECT 1`; res.json({ status: 'ok' }); }));
app.post('/api/auth/register', authLimit, asyncRoute(async (req, res) => {
  const data = z.object({ name: z.string().min(2), email: z.string().email(), phone: z.string().optional(), password: z.string().min(8), terms: z.literal(true) }).parse(req.body);
  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await prisma.user.create({ data: { name: data.name, email: data.email.toLowerCase(), phone: data.phone, passwordHash, role: 'TENANT' }, select: { id: true, name: true, email: true, role: true } });
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.status(201).json({ user, token });
}));
app.post('/api/auth/login', authLimit, asyncRoute(async (req, res) => {
  const data = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) return res.status(401).json({ error: 'Email atau password tidak sesuai.' });
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, token });
}));
app.get('/api/auth/me', auth, asyncRoute(async (req, res) => res.json(await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, name: true, email: true, phone: true, role: true } }))));

app.get('/api/facilities', asyncRoute(async (_req, res) => res.json(await prisma.facility.findMany({ orderBy: { name: 'asc' } }))));
app.get('/api/rooms', asyncRoute(async (req, res) => {
  const { q, city, min, max, type, facility, sort = 'asc', page = '1' } = req.query;
  const where = { status: 'AVAILABLE', property: { published: true }, ...(type ? { type: String(type) } : {}), ...(min || max ? { price: { ...(min ? { gte: Number(min) } : {}), ...(max ? { lte: Number(max) } : {}) } } : {}), ...(facility ? { facilities: { some: { facility: { name: String(facility) } } } } : {}), ...((q || city) ? { property: { published: true, ...(city ? { city: { contains: String(city), mode: 'insensitive' } } : {}), ...(q ? { OR: ['name', 'city', 'district', 'address'].map(key => ({ [key]: { contains: String(q), mode: 'insensitive' } })) } : {}) } } : {}) };
  const take = 12; const skip = (Math.max(1, Number(page)) - 1) * take;
  const [items, total] = await prisma.$transaction([prisma.room.findMany({ where, include: publicRoom, orderBy: { price: sort === 'desc' ? 'desc' : 'asc' }, skip, take }), prisma.room.count({ where })]);
  res.json({ items, total, page: Math.max(1, Number(page)), pages: Math.ceil(total / take) });
}));
app.get('/api/rooms/:id', asyncRoute(async (req, res) => { const room = await prisma.room.findFirst({ where: { id: req.params.id, status: { not: 'ARCHIVED' }, property: { published: true } }, include: publicRoom }); if (!room) return res.status(404).json({ error: 'Kamar tidak ditemukan.' }); res.json(room); }));
app.get('/api/properties/mine', auth, role('OWNER'), asyncRoute(async (req, res) => res.json(await prisma.property.findMany({ where: { ownerId: req.user.id }, include: { rooms: true } }))));
app.post('/api/properties', auth, role('OWNER'), asyncRoute(async (req, res) => { const d = z.object({ name: z.string().min(2), description: z.string().min(5), address: z.string().min(3), city: z.string().min(2), district: z.string().min(2), contactPhone: z.string().optional(), rules: z.string().optional() }).parse(req.body); const row = await prisma.property.create({ data: { ...d, ownerId: req.user.id } }); await audit(req.user.id, 'CREATE', 'Property', row.id); res.status(201).json(row); }));
app.patch('/api/properties/:id', auth, role('OWNER'), asyncRoute(async (req, res) => { const d = z.object({ name: z.string().min(2).optional(), description: z.string().min(5).optional(), address: z.string().min(3).optional(), city: z.string().min(2).optional(), district: z.string().min(2).optional(), contactPhone: z.string().optional(), rules: z.string().optional(), published: z.boolean().optional() }).parse(req.body); const owned = await prisma.property.findFirst({ where: { id: req.params.id, ownerId: req.user.id } }); if (!owned) return res.status(404).json({ error: 'Properti tidak ditemukan.' }); res.json(await prisma.property.update({ where: { id: owned.id }, data: d })); }));
app.post('/api/rooms', auth, role('OWNER'), asyncRoute(async (req, res) => { const d = z.object({ propertyId: z.string(), name: z.string().min(1), type: z.string().min(1), description: z.string().min(5), price: z.number().positive(), period: z.enum(['MONTHLY', 'DAILY']).default('MONTHLY'), capacity: z.number().int().positive().default(1), photoUrl: z.string().optional(), facilities: z.array(z.string()).default([]) }).parse(req.body); const p = await prisma.property.findFirst({ where: { id: d.propertyId, ownerId: req.user.id } }); if (!p) return res.status(404).json({ error: 'Properti tidak ditemukan.' }); const room = await prisma.room.create({ data: { ...d, facilities: { create: d.facilities.map(facilityId => ({ facility: { connect: { id: facilityId } } })) } }, include: publicRoom }); await audit(req.user.id, 'CREATE', 'Room', room.id); res.status(201).json(room); }));
app.patch('/api/rooms/:id', auth, role('OWNER'), asyncRoute(async (req, res) => { const room = await prisma.room.findFirst({ where: { id: req.params.id, property: { ownerId: req.user.id } } }); if (!room) return res.status(404).json({ error: 'Kamar tidak ditemukan.' }); const d = z.object({ name: z.string().min(1).optional(), type: z.string().optional(), description: z.string().optional(), price: z.number().positive().optional(), status: z.enum(['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'ARCHIVED']).optional(), period: z.enum(['MONTHLY','DAILY']).optional(), capacity: z.number().int().positive().optional(), photoUrl: z.string().optional() }).parse(req.body); res.json(await prisma.room.update({ where: { id: room.id }, data: d })); }));
app.delete('/api/rooms/:id', auth, role('OWNER'), asyncRoute(async (req, res) => { const room = await prisma.room.findFirst({ where: { id: req.params.id, property: { ownerId: req.user.id } } }); if (!room) return res.status(404).json({ error: 'Kamar tidak ditemukan.' }); if (await prisma.booking.count({ where: { roomId: room.id } })) return res.status(409).json({ error: 'Kamar memiliki riwayat booking dan tidak dapat dihapus. Arsipkan kamar.' }); await prisma.room.delete({ where: { id: room.id } }); res.json({ ok: true }); }));
app.post('/api/uploads', auth, upload.single('file'), asyncRoute(async (req, res) => { if (!req.file) return res.status(400).json({ error: 'File gambar atau PDF maksimal 5 MB diperlukan.' }); const ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' })[req.file.mimetype]; const dest = path.join(uploadDir, `${req.file.filename}${ext}`); fs.renameSync(req.file.path, dest); res.status(201).json({ url: `/uploads/${path.basename(dest)}` }); }));

app.post('/api/bookings', auth, role('TENANT'), asyncRoute(async (req, res) => {
  const d = z.object({ roomId: z.string(), checkIn: z.string().datetime(), duration: z.number().int().min(1).max(24) }).parse(req.body);
  const result = await prisma.$transaction(async tx => {
    const room = await tx.room.findFirst({ where: { id: d.roomId, status: 'AVAILABLE', property: { published: true } } });
    if (!room) throw Object.assign(new Error('Kamar tidak tersedia.'), { status: 409 });
    const start = new Date(d.checkIn); const end = new Date(start); if (room.period === 'DAILY') end.setDate(end.getDate() + d.duration); else end.setMonth(end.getMonth() + d.duration);
    const candidates = await tx.booking.findMany({ where: { roomId: room.id, status: { in: ['PENDING', 'APPROVED'] } }, select: { checkIn: true, duration: true } });
    const collision = candidates.some(existing => { const oldEnd = new Date(existing.checkIn); if (room.period === 'DAILY') oldEnd.setDate(oldEnd.getDate() + existing.duration); else oldEnd.setMonth(oldEnd.getMonth() + existing.duration); return start < oldEnd && existing.checkIn < end; });
    if (collision) throw Object.assign(new Error('Kamar sudah memiliki booking pada periode tersebut.'), { status: 409 });
    const booking = await tx.booking.create({ data: { userId: req.user.id, roomId: room.id, checkIn: start, duration: d.duration, total: room.price.mul(d.duration), histories: { create: { actorId: req.user.id, status: 'PENDING' } } }, include: { room: { include: publicRoom } } });
    await tx.notification.create({ data: { userId: (await tx.property.findUnique({ where: { id: room.propertyId }, select: { ownerId: true } })).ownerId, title: 'Booking baru', body: `${req.user.name} mengajukan booking ${room.name}.` } });
    return booking;
  }, { isolationLevel: 'Serializable' }); res.status(201).json(result);
}));
app.get('/api/bookings/mine', auth, role('TENANT'), asyncRoute(async (req, res) => res.json(await prisma.booking.findMany({ where: { userId: req.user.id }, include: { room: { include: publicRoom }, invoices: { include: { payments: true } }, histories: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' } }))));
app.get('/api/bookings/owner', auth, role('OWNER'), asyncRoute(async (req, res) => res.json(await prisma.booking.findMany({ where: { room: { property: { ownerId: req.user.id } } }, include: { user: { select: { id: true, name: true, email: true, phone: true } }, room: { include: publicRoom }, invoices: true, histories: true }, orderBy: { createdAt: 'desc' } }))));
app.patch('/api/bookings/:id/decision', auth, role('OWNER'), asyncRoute(async (req, res) => {
  const d = z.object({ status: z.enum(['APPROVED', 'REJECTED']), note: z.string().optional() }).parse(req.body);
  const booking = await prisma.booking.findFirst({ where: { id: req.params.id, room: { property: { ownerId: req.user.id } }, status: 'PENDING' }, include: { room: true } });
  if (!booking) return res.status(404).json({ error: 'Booking menunggu tidak ditemukan.' });
  const result = await prisma.$transaction(async tx => {
    const updated = await tx.booking.update({ where: { id: booking.id }, data: { status: d.status, decisionNote: d.note, histories: { create: { actorId: req.user.id, status: d.status, note: d.note } } } });
    if (d.status === 'APPROVED') { const end = new Date(booking.checkIn); if (booking.room.period === 'DAILY') end.setDate(end.getDate() + booking.duration); else end.setMonth(end.getMonth() + booking.duration); await tx.invoice.create({ data: { number: `INV-${Date.now()}-${booking.id.slice(-5)}`, bookingId: booking.id, tenantId: booking.userId, amount: booking.total, periodStart: booking.checkIn, periodEnd: end, dueAt: new Date() } }); }
    await tx.notification.create({ data: { userId: booking.userId, title: `Booking ${d.status === 'APPROVED' ? 'disetujui' : 'ditolak'}`, body: d.note || 'Periksa detail booking Anda.' } }); await tx.auditLog.create({ data: { actorId: req.user.id, action: d.status, entity: 'Booking', entityId: booking.id } }); return updated;
  }); res.json(result);
}));
app.patch('/api/bookings/:id/cancel', auth, role('TENANT'), asyncRoute(async (req, res) => { const b = await prisma.booking.findFirst({ where: { id: req.params.id, userId: req.user.id, status: 'PENDING' } }); if (!b) return res.status(404).json({ error: 'Booking pending tidak ditemukan.' }); res.json(await prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED', histories: { create: { actorId: req.user.id, status: 'CANCELLED' } } } })); }));

app.get('/api/invoices/mine', auth, role('TENANT'), asyncRoute(async (req, res) => res.json(await prisma.invoice.findMany({ where: { tenantId: req.user.id }, include: { booking: { include: { room: { include: publicRoom } } }, payments: true }, orderBy: { dueAt: 'desc' } }))));
app.get('/api/invoices/owner', auth, role('OWNER'), asyncRoute(async (req, res) => res.json(await prisma.invoice.findMany({ where: { booking: { room: { property: { ownerId: req.user.id } } } }, include: { tenant: { select: { id: true, name: true, email: true, phone: true } }, booking: { include: { room: { include: publicRoom } } }, payments: true }, orderBy: { issuedAt: 'desc' } }))));
app.post('/api/invoices', auth, role('OWNER'), asyncRoute(async (req, res) => { const d = z.object({ bookingId: z.string(), amount: z.number().positive(), dueAt: z.string().datetime(), periodStart: z.string().datetime(), periodEnd: z.string().datetime() }).parse(req.body); const booking = await prisma.booking.findFirst({ where: { id: d.bookingId, status: 'APPROVED', room: { property: { ownerId: req.user.id } } } }); if (!booking) return res.status(404).json({ error: 'Booking aktif tidak ditemukan.' }); const invoice = await prisma.invoice.create({ data: { number: `INV-${Date.now()}-${booking.id.slice(-5)}`, bookingId: booking.id, tenantId: booking.userId, amount: d.amount, dueAt: new Date(d.dueAt), periodStart: new Date(d.periodStart), periodEnd: new Date(d.periodEnd) } }); res.status(201).json(invoice); }));
app.post('/api/payments', auth, role('TENANT'), proofUpload.single('proof'), asyncRoute(async (req, res) => { const invoice = await prisma.invoice.findFirst({ where: { id: req.body.invoiceId, tenantId: req.user.id, status: { in: ['UNPAID', 'OVERDUE', 'REJECTED'] } } }); if (!invoice) return res.status(404).json({ error: 'Tagihan aktif tidak ditemukan.' }); if (!req.file) return res.status(400).json({ error: 'Unggah bukti transfer (JPG, PNG, WebP, PDF; maks. 5 MB).' }); const ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' })[req.file.mimetype]; const dest = path.join(privateUploadDir, `${req.file.filename}${ext}`); fs.renameSync(req.file.path, dest); const proofUrl = `/api/payments/${encodeURIComponent(invoice.id)}/proof?file=${encodeURIComponent(path.basename(dest))}`; const payment = await prisma.$transaction(async tx => { const p = await tx.payment.create({ data: { invoiceId: invoice.id, amount: invoice.amount, proofUrl, histories: { create: { actorId: req.user.id, status: 'PENDING' } } } }); await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'PENDING_REVIEW' } }); await tx.auditLog.create({ data: { actorId: req.user.id, action: 'SUBMIT_PAYMENT', entity: 'Payment', entityId: p.id } }); return p; }); res.status(201).json(payment); }));
app.get('/api/payments/:id/proof', auth, asyncRoute(async (req, res) => { const fileName = path.basename(String(req.query.file || '')); const payment = await prisma.payment.findFirst({ where: { invoiceId: req.params.id, proofUrl: { contains: fileName } }, include: { invoice: { include: { booking: { include: { room: { include: { property: true } } } } } } } }); if (!payment || !fileName) return res.status(404).json({ error: 'Bukti pembayaran tidak ditemukan.' }); const allowed = payment.invoice.tenantId === req.user.id || (req.user.role === 'OWNER' && payment.invoice.booking.room.property.ownerId === req.user.id); if (!allowed) return res.status(403).json({ error: 'Anda tidak memiliki akses.' }); res.sendFile(path.join(privateUploadDir, fileName), err => { if (err && !res.headersSent) res.status(404).json({ error: 'File bukti tidak ditemukan.' }); }); }));
app.get('/api/payments/mine', auth, role('TENANT'), asyncRoute(async (req, res) => res.json(await prisma.payment.findMany({ where: { invoice: { tenantId: req.user.id } }, include: { invoice: true, histories: true }, orderBy: { submittedAt: 'desc' } }))));
app.get('/api/payments/owner', auth, role('OWNER'), asyncRoute(async (req, res) => {
  const rows = await prisma.payment.findMany({
    where: { invoice: { booking: { room: { property: { ownerId: req.user.id } } } } },
    include: { invoice: { include: { tenant: true, booking: { include: { room: { include: publicRoom } } } } }, histories: true },
    orderBy: { submittedAt: 'desc' },
  });
  res.json(rows);
}));
app.patch('/api/payments/:id/decision', auth, role('OWNER'), asyncRoute(async (req, res) => { const d = z.object({ status: z.enum(['APPROVED', 'REJECTED']), note: z.string().optional() }).parse(req.body); const p = await prisma.payment.findFirst({ where: { id: req.params.id, invoice: { booking: { room: { property: { ownerId: req.user.id } } } }, status: 'PENDING' }, include: { invoice: true } }); if (!p) return res.status(404).json({ error: 'Pembayaran menunggu verifikasi tidak ditemukan.' }); const result = await prisma.$transaction(async tx => { const updated = await tx.payment.update({ where: { id: p.id }, data: { status: d.status, reviewNote: d.note, reviewedAt: new Date(), histories: { create: { actorId: req.user.id, status: d.status, note: d.note } } } }); await tx.invoice.update({ where: { id: p.invoiceId }, data: { status: d.status === 'APPROVED' ? 'PAID' : 'REJECTED' } }); await tx.notification.create({ data: { userId: p.invoice.tenantId, title: `Pembayaran ${d.status === 'APPROVED' ? 'disetujui' : 'ditolak'}`, body: d.note || `Status pembayaran: ${d.status}` } }); await tx.auditLog.create({ data: { actorId: req.user.id, action: d.status, entity: 'Payment', entityId: p.id } }); return updated; }); res.json(result); }));
app.get('/api/reports/summary', auth, role('OWNER'), asyncRoute(async (req, res) => { const prop = { booking: { room: { property: { ownerId: req.user.id } } } }; const [rooms, bookings, invoices, payments, properties, approvedPayments] = await Promise.all([prisma.room.count({ where: { property: { ownerId: req.user.id }, status: { not: 'ARCHIVED' } } }), prisma.booking.count({ where: { room: { property: { ownerId: req.user.id } } } }), prisma.invoice.findMany({ where: { ...prop, ...(req.query.from || req.query.to ? { issuedAt: { ...(req.query.from ? { gte: new Date(String(req.query.from)) } : {}), ...(req.query.to ? { lte: new Date(String(req.query.to)) } : {}) } } : {}) }, select: { amount: true, status: true } }), prisma.payment.count({ where: { status: 'PENDING', invoice: prop } }), prisma.property.count({ where: { ownerId: req.user.id } }), prisma.payment.findMany({ where: { status: 'APPROVED', invoice: prop }, select: { amount: true, reviewedAt: true } })]); const monthly = Array.from({ length: 12 }, (_, month) => ({ month, amount: approvedPayments.filter(p => p.reviewedAt && p.reviewedAt.getFullYear() === new Date().getFullYear() && p.reviewedAt.getMonth() === month).reduce((sum, p) => sum + Number(p.amount), 0) })); res.json({ properties, rooms, available: await prisma.room.count({ where: { property: { ownerId: req.user.id }, status: 'AVAILABLE' } }), occupied: await prisma.room.count({ where: { property: { ownerId: req.user.id }, status: 'OCCUPIED' } }), bookings, pendingBookings: await prisma.booking.count({ where: { room: { property: { ownerId: req.user.id } }, status: 'PENDING' } }), pendingPayments: payments, invoiced: invoices.reduce((a, x) => a + Number(x.amount), 0), unpaid: invoices.filter(x => x.status === 'UNPAID' || x.status === 'OVERDUE').reduce((a, x) => a + Number(x.amount), 0), verifiedRevenue: approvedPayments.reduce((sum, p) => sum + Number(p.amount), 0), monthly }); }));
app.get('/api/reports/transactions.csv', auth, role('OWNER'), asyncRoute(async (req, res) => { const rows = await prisma.payment.findMany({ where: { invoice: { booking: { room: { property: { ownerId: req.user.id } } } } }, include: { invoice: { include: { tenant: true } } }, orderBy: { submittedAt: 'desc' } }); const csv = ['ID,Nomor Tagihan,Penghuni,Nominal,Status,Tanggal', ...rows.map(x => [x.id, x.invoice.number, x.invoice.tenant.name, x.amount, x.status, x.submittedAt.toISOString()].map(v => `"${String(v).replaceAll('"', '""')}"`).join(','))].join('\r\n'); res.type('text/csv').attachment('kostfinder-transaksi.csv').send(csv); }));
app.get('/api/tenants', auth, role('OWNER'), asyncRoute(async (req, res) => res.json(await prisma.user.findMany({ where: { role: 'TENANT', bookings: { some: { status: 'APPROVED', room: { property: { ownerId: req.user.id } } } } }, select: { id: true, name: true, email: true, phone: true, bookings: { where: { status: 'APPROVED', room: { property: { ownerId: req.user.id } } }, include: { room: { include: publicRoom } } } } }))));
app.get('/api/notifications', auth, asyncRoute(async (req, res) => res.json(await prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 30 }))));
app.patch('/api/profile', auth, asyncRoute(async (req, res) => { const d = z.object({ name: z.string().min(2).optional(), phone: z.string().optional() }).parse(req.body); res.json(await prisma.user.update({ where: { id: req.user.id }, data: d, select: { id: true, name: true, email: true, phone: true, role: true } })); }));
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(frontendDist, 'index.html')));
}
app.use((err, _req, res, _next) => { console.error(err); if (err instanceof z.ZodError) return res.status(400).json({ error: 'Periksa kembali data yang dimasukkan.', details: err.issues }); if (err.code === 'P2002') return res.status(409).json({ error: 'Data tersebut sudah digunakan.' }); if (err.code === 'P2025') return res.status(404).json({ error: 'Data tidak ditemukan.' }); res.status(err.status || 500).json({ error: err.status ? err.message : 'Terjadi kesalahan pada server.' }); });
const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`KostFinder API berjalan di http://localhost:${port}`));
