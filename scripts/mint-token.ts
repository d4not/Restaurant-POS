import jwt from 'jsonwebtoken';
import { prisma } from '../src/lib/prisma.js';
import { env } from '../src/config/env.js';

async function main(): Promise<void> {
  const u = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
  const token = jwt.sign({ sub: u.id, role: u.role }, env.JWT_SECRET, { expiresIn: '1h' });
  console.log(token);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
