import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
const password = process.env.OWNER_PASSWORD;
const name = process.env.OWNER_NAME?.trim() || 'Pemilik KostFinder';

if (!email || !password || password.length < 12) {
  console.error('OWNER_EMAIL dan OWNER_PASSWORD wajib diisi; password minimal 12 karakter.');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'OWNER') throw new Error('Email sudah dipakai akun penghuni. Gunakan email lain.');
    console.log(`Akun pemilik ${email} sudah tersedia.`);
  } else {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({ data: { name, email, passwordHash, role: 'OWNER' } });
    console.log(`Akun pemilik ${email} berhasil dibuat.`);
  }
} finally {
  await prisma.$disconnect();
}
