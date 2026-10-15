import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });
const prisma = new PrismaClient();
const hash = await bcrypt.hash('KostfinderDemo123!', 12);
const owner = await prisma.user.upsert({ where: { email: 'pemilik@kostfinder.test' }, update: {}, create: { name: 'Ayu Pemilik', email: 'pemilik@kostfinder.test', phone: '081234567890', passwordHash: hash, role: 'OWNER' } });
const tenant = await prisma.user.upsert({ where: { email: 'penghuni@kostfinder.test' }, update: {}, create: { name: 'Bima Pratama', email: 'penghuni@kostfinder.test', phone: '081234567891', passwordHash: hash } });
const features = ['Wi-Fi', 'Kamar Mandi Dalam', 'AC', 'Parkir Motor', 'Dapur Bersama', 'Laundry'];
for (const name of features) await prisma.facility.upsert({ where: { name }, update: {}, create: { name } });
const property = await prisma.property.upsert({ where: { id: 'kost-senja' }, update: {}, create: { id: 'kost-senja', ownerId: owner.id, name: 'Kost Senja Residence', description: 'Hunian tenang dan nyaman dengan akses mudah ke pusat kota.', address: 'Jl. Kaliurang KM 5', city: 'Yogyakarta', district: 'Depok', contactPhone: '081234567890', rules: 'Jam tenang pukul 22.00. Tidak diperkenankan merokok di dalam kamar.' } });
const room = await prisma.room.upsert({ where: { id: 'kamar-nyaman-01' }, update: {}, create: { id: 'kamar-nyaman-01', propertyId: property.id, name: 'Kamar 01', type: 'Single', description: 'Kamar terang dengan jendela besar dan perabot esensial.', price: 1450000, photoUrl: 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1000&q=85' } });
const secondProperty = await prisma.property.upsert({ where: { id: 'rumah-nara' }, update: {}, create: { id: 'rumah-nara', ownerId: owner.id, name: 'Paviliun Nara', description: 'Paviliun asri dengan ruang bersama yang hangat dan akses dekat kampus.', address: 'Jl. Dipatiukur No. 18', city: 'Bandung', district: 'Coblong', contactPhone: '081234567890', rules: 'Tamu wajib lapor kepada penjaga.' } });
const rooms = [
  room,
  await prisma.room.upsert({ where: { id: 'nara-kamar-a' }, update: {}, create: { id: 'nara-kamar-a', propertyId: secondProperty.id, name: 'Kamar A', type: 'Studio', description: 'Studio lapang dengan pencahayaan alami.', price: 1850000, photoUrl: 'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=1000&q=85' } }),
  await prisma.room.upsert({ where: { id: 'nara-kamar-b' }, update: {}, create: { id: 'nara-kamar-b', propertyId: secondProperty.id, name: 'Kamar B', type: 'Single', description: 'Kamar sederhana di lingkungan yang teduh.', price: 1250000, photoUrl: 'https://images.unsplash.com/photo-1617104678098-de229db51175?auto=format&fit=crop&w=1000&q=85' } }),
  await prisma.room.upsert({ where: { id: 'senja-harian' }, update: {}, create: { id: 'senja-harian', propertyId: property.id, name: 'Kamar Transit', type: 'Double', description: 'Kamar harian nyaman untuk kunjungan singkat.', price: 180000, period: 'DAILY', photoUrl: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1000&q=85' } }),
];
const facility = await prisma.facility.findUnique({ where: { name: 'Wi-Fi' } });
for (const r of rooms) await prisma.roomFacility.upsert({ where: { roomId_facilityId: { roomId: r.id, facilityId: facility.id } }, update: {}, create: { roomId: r.id, facilityId: facility.id } });
const bathroom = await prisma.facility.findUnique({ where: { name: 'Kamar Mandi Dalam' } });
await prisma.roomFacility.upsert({ where: { roomId_facilityId: { roomId: rooms[1].id, facilityId: bathroom.id } }, update: {}, create: { roomId: rooms[1].id, facilityId: bathroom.id } });
const checkIn = new Date(); checkIn.setDate(checkIn.getDate() + 10); checkIn.setHours(0, 0, 0, 0);
const end = new Date(checkIn); end.setMonth(end.getMonth() + 1);
const approvedBooking = await prisma.booking.upsert({ where: { id: 'demo-booking-approved' }, update: {}, create: { id: 'demo-booking-approved', userId: tenant.id, roomId: rooms[1].id, checkIn, duration: 1, total: rooms[1].price, status: 'APPROVED', histories: { create: { actorId: owner.id, status: 'APPROVED', note: 'Data demonstrasi.' } } } });
await prisma.invoice.upsert({ where: { number: 'INV-DEMO-001' }, update: {}, create: { number: 'INV-DEMO-001', bookingId: approvedBooking.id, tenantId: tenant.id, amount: rooms[1].price, periodStart: checkIn, periodEnd: end, dueAt: new Date(Date.now() + 5 * 86400000) } });
const pendingBooking = await prisma.booking.upsert({ where: { id: 'demo-booking-pending' }, update: {}, create: { id: 'demo-booking-pending', userId: tenant.id, roomId: room.id, checkIn: new Date(Date.now() + 60 * 86400000), duration: 1, total: room.price, status: 'PENDING', histories: { create: { actorId: tenant.id, status: 'PENDING', note: 'Data demonstrasi.' } } } });
await prisma.booking.upsert({ where: { id: 'demo-booking-rejected' }, update: {}, create: { id: 'demo-booking-rejected', userId: tenant.id, roomId: rooms[2].id, checkIn: new Date(Date.now() + 90 * 86400000), duration: 1, total: rooms[2].price, status: 'REJECTED', decisionNote: 'Contoh booking ditolak.', histories: { create: { actorId: owner.id, status: 'REJECTED', note: 'Contoh booking ditolak.' } } } });
const invoice = await prisma.invoice.findUnique({ where: { number: 'INV-DEMO-001' } });
const pendingPayment = await prisma.payment.upsert({ where: { id: 'demo-payment-pending' }, update: {}, create: { id: 'demo-payment-pending', invoiceId: invoice.id, amount: invoice.amount, status: 'PENDING', histories: { create: { actorId: tenant.id, status: 'PENDING', note: 'Data demonstrasi.' } } } });
await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'PENDING_REVIEW' } });
await prisma.bookingStatusHistory.upsert({ where: { id: 'demo-pending-history' }, update: {}, create: { id: 'demo-pending-history', bookingId: pendingBooking.id, actorId: tenant.id, status: 'PENDING' } });
console.log(`Seed siap. Pemilik: ${owner.email}; penghuni: ${tenant.email}; password demo: KostfinderDemo123!`);
await prisma.$disconnect();
