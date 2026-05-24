import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';

const app = getTestApp();

describe('Printer Profiles CRUD', () => {
  let adminId: string;
  let cashierId: string;
  let waiterId: string;
  let categoryId: string;
  let categoryId2: string;

  beforeEach(async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    adminId = admin.id;
    const cashier = await makeUser({ role: 'CASHIER' });
    cashierId = cashier.id;
    const waiter = await makeUser({ role: 'WAITER' });
    waiterId = waiter.id;

    const cat = await prisma.productCategory.create({
      data: { name: 'Hot Coffee', color: '#8B4513' },
    });
    categoryId = cat.id;
    const cat2 = await prisma.productCategory.create({
      data: { name: 'Cold Drinks', color: '#1E90FF' },
    });
    categoryId2 = cat2.id;
  });

  it('creates a profile (MANAGER+)', async () => {
    const res = await request(app)
      .post('/api/v1/printer-profiles')
      .set(authHeader(adminId, 'ADMIN'))
      .send({ name: 'Bar', address: '192.168.1.50:9100', prints_comandas: true });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Bar');
    expect(res.body.data.address).toBe('192.168.1.50:9100');
    expect(res.body.data.prints_comandas).toBe(true);
  });

  it('rejects create for WAITER', async () => {
    const res = await request(app)
      .post('/api/v1/printer-profiles')
      .set(authHeader(waiterId, 'WAITER'))
      .send({ name: 'Bar' });

    expect(res.status).toBe(403);
  });

  it('lists profiles', async () => {
    await prisma.printerProfile.create({
      data: { name: 'Kitchen', address: '192.168.1.51:9100' },
    });

    const res = await request(app)
      .get('/api/v1/printer-profiles')
      .set(authHeader(cashierId, 'CASHIER'));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].name).toBe('Kitchen');
  });

  it('updates a profile', async () => {
    const profile = await prisma.printerProfile.create({
      data: { name: 'Old Name', address: '10.0.0.1:9100' },
    });

    const res = await request(app)
      .patch(`/api/v1/printer-profiles/${profile.id}`)
      .set(authHeader(adminId, 'ADMIN'))
      .send({ name: 'New Name', paper_width: 32 });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('New Name');
    expect(res.body.data.paper_width).toBe(32);
  });

  it('soft-deletes a profile and nulls category FKs', async () => {
    const profile = await prisma.printerProfile.create({
      data: { name: 'ToDelete', address: '10.0.0.2:9100' },
    });
    await prisma.productCategory.update({
      where: { id: categoryId },
      data: { printer_profile_id: profile.id },
    });

    const res = await request(app)
      .delete(`/api/v1/printer-profiles/${profile.id}`)
      .set(authHeader(adminId, 'ADMIN'));

    expect(res.status).toBe(204);

    const cat = await prisma.productCategory.findUnique({ where: { id: categoryId } });
    expect(cat!.printer_profile_id).toBeNull();

    const deleted = await prisma.printerProfile.findUnique({ where: { id: profile.id } });
    expect(deleted!.active).toBe(false);
  });

  it('assigns categories to a profile', async () => {
    const profile = await prisma.printerProfile.create({
      data: { name: 'Bar', address: '192.168.1.50:9100' },
    });

    const res = await request(app)
      .put(`/api/v1/printer-profiles/${profile.id}/categories`)
      .set(authHeader(adminId, 'ADMIN'))
      .send({ category_ids: [categoryId, categoryId2] });

    expect(res.status).toBe(200);
    expect(res.body.data.categories).toHaveLength(2);

    const cat = await prisma.productCategory.findUnique({ where: { id: categoryId } });
    expect(cat!.printer_profile_id).toBe(profile.id);
  });

  it('moves categories between profiles', async () => {
    const bar = await prisma.printerProfile.create({
      data: { name: 'Bar', address: '192.168.1.50:9100' },
    });
    const kitchen = await prisma.printerProfile.create({
      data: { name: 'Kitchen', address: '192.168.1.51:9100' },
    });

    // Assign to bar first
    await prisma.productCategory.update({
      where: { id: categoryId },
      data: { printer_profile_id: bar.id },
    });

    // Now assign to kitchen
    const res = await request(app)
      .put(`/api/v1/printer-profiles/${kitchen.id}/categories`)
      .set(authHeader(adminId, 'ADMIN'))
      .send({ category_ids: [categoryId] });

    expect(res.status).toBe(200);

    const cat = await prisma.productCategory.findUnique({ where: { id: categoryId } });
    expect(cat!.printer_profile_id).toBe(kitchen.id);
  });

  it('returns routing map', async () => {
    const profile = await prisma.printerProfile.create({
      data: { name: 'Bar', address: '192.168.1.50:9100' },
    });
    await prisma.productCategory.update({
      where: { id: categoryId },
      data: { printer_profile_id: profile.id },
    });

    const res = await request(app)
      .get('/api/v1/printer-profiles/routing-map')
      .set(authHeader(cashierId, 'CASHIER'));

    expect(res.status).toBe(200);
    expect(res.body.data[categoryId]).toBe(profile.id);
  });

  it('rejects duplicate profile name', async () => {
    await prisma.printerProfile.create({
      data: { name: 'Bar', address: '192.168.1.50:9100' },
    });

    const res = await request(app)
      .post('/api/v1/printer-profiles')
      .set(authHeader(adminId, 'ADMIN'))
      .send({ name: 'Bar' });

    expect(res.status).toBe(409);
  });
});
