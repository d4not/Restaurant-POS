import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeStorage, makeUser } from '../helpers/factories.js';

const app = getTestApp();

interface MockPrinter {
  port: number;
  /** Returns the bytes received so far across all connections. */
  received: () => Buffer;
  connections: () => number;
  close: () => Promise<void>;
}

async function startMockPrinter(): Promise<MockPrinter> {
  const chunks: Buffer[] = [];
  let connectionCount = 0;
  const server = net.createServer((socket) => {
    connectionCount += 1;
    socket.on('data', (chunk) => chunks.push(chunk));
    // The library writes the buffer and immediately destroys the socket; we
    // just absorb whatever lands.
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock printer failed to bind');
  }
  return {
    port: address.port,
    received: () => Buffer.concat(chunks),
    connections: () => connectionCount,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function configurePrinters(
  auth: Record<string, string>,
  kitchenPort: number,
  receiptPort: number,
): Promise<void> {
  await request(app)
    .patch('/api/v1/settings')
    .set(auth)
    .send({
      printer_kitchen_ip: '127.0.0.1',
      printer_kitchen_port: String(kitchenPort),
      printer_receipt_ip: '127.0.0.1',
      printer_receipt_port: String(receiptPort),
      printer_paper_width: '80',
      business_name: 'Test Cafe',
      business_address: '500 Test Ave',
    })
    .expect(200);
}

interface Scenario {
  auth: Record<string, string>;
  registerId: string;
  orderId: string;
}

async function seedOrderWithItem(): Promise<Scenario> {
  const [user, storage] = await Promise.all([makeUser(), makeStorage({ name: 'Bar' })]);
  const auth = authHeader(user.id);

  // Backed-by-a-supply PRODUCT skips the recipe requirement — payment-time
  // deduction just draws 1 base unit of the supply per quantity. Lets the
  // test exercise the full /print/receipt flow (which depends on Payment
  // rows) without setting up modifier groups, recipes, or variants.
  const supplyCategory = await prisma.supplyCategory.create({
    data: { name: 'Coffee' },
  });
  const supply = await prisma.supply.create({
    data: {
      name: 'Latte cup',
      category_id: supplyCategory.id,
      base_unit: 'PIECE',
    },
  });
  // Pre-stock so the deduction doesn't drive negative.
  await prisma.storageStock.create({
    data: { supply_id: supply.id, storage_id: storage.id, quantity: 100 },
  });

  const category = await request(app)
    .post('/api/v1/product-categories')
    .set(auth)
    .send({ name: 'Hot Coffee' });
  expect(category.status).toBe(201);

  const product = await request(app)
    .post('/api/v1/products')
    .set(auth)
    .send({
      name: 'Latte',
      type: 'PRODUCT',
      category_id: category.body.data.id,
      sell_price: 6500,
      supply_id: supply.id,
    });
  expect(product.status).toBe(201);
  const productId = product.body.data.id as string;

  const register = await request(app)
    .post('/api/v1/registers')
    .set(auth)
    .send({ opening_amount: 50000 });
  expect(register.status).toBe(201);
  const registerId = register.body.data.id as string;

  await request(app)
    .post('/api/v1/deduction-rules')
    .set(auth)
    .send({ pos_register_id: registerId, storage_id: storage.id })
    .expect(201);

  const order = await request(app)
    .post('/api/v1/orders')
    .set(auth)
    .send({ register_id: registerId, order_type: 'DINE_IN' });
  expect(order.status).toBe(201);
  const orderId = order.body.data.id as string;

  await request(app)
    .post(`/api/v1/orders/${orderId}/items`)
    .set(auth)
    .send({ product_id: productId, quantity: 2, notes: 'Extra hot' })
    .expect(201);

  return { auth, registerId, orderId };
}

describe('Print endpoints', () => {
  let kitchen: MockPrinter;
  let receipt: MockPrinter;

  beforeEach(async () => {
    kitchen = await startMockPrinter();
    receipt = await startMockPrinter();
  });
  afterEach(async () => {
    await kitchen.close();
    await receipt.close();
  });

  it('POST /print/kitchen sends ESC/POS bytes to the configured IP:port and marks items as sent', async () => {
    const s = await seedOrderWithItem();
    await configurePrinters(s.auth, kitchen.port, receipt.port);

    const res = await request(app)
      .post('/api/v1/print/kitchen')
      .set(s.auth)
      .send({ order_id: s.orderId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ok).toBe(true);
    expect(res.body.data.printed_count).toBeGreaterThan(0);
    expect(res.body.data.is_correction).toBe(false);
    // The lines payload includes the comanda body — verifies the formatter ran.
    const lines: string[] = res.body.data.lines;
    expect(lines.some((l) => l.includes('ORDER'))).toBe(true);
    expect(lines.some((l) => l.includes('2x Latte'))).toBe(true);
    expect(lines.some((l) => l.includes('NOTE: Extra hot'))).toBe(true);

    // Allow a tick for the TCP write callback to flush bytes to the mock.
    await new Promise((r) => setTimeout(r, 50));
    expect(kitchen.connections()).toBeGreaterThan(0);
    const payload = kitchen.received().toString('binary');
    // ESC/POS output contains the human-readable text we printed.
    expect(payload).toContain('Latte');
    expect(payload).toContain('ORDER');

    // Items now flagged sent.
    const items = await prisma.orderItem.findMany({
      where: { order_id: s.orderId },
      select: { sent_to_kitchen: true, sent_at: true },
    });
    expect(items.every((i) => i.sent_to_kitchen)).toBe(true);
    expect(items.every((i) => i.sent_at !== null)).toBe(true);
  });

  it('POST /print/kitchen is a no-op (printed_count=0, no bytes sent) when nothing is pending', async () => {
    const s = await seedOrderWithItem();
    await configurePrinters(s.auth, kitchen.port, receipt.port);

    // First call sends to kitchen.
    await request(app)
      .post('/api/v1/print/kitchen')
      .set(s.auth)
      .send({ order_id: s.orderId })
      .expect(200);

    await new Promise((r) => setTimeout(r, 30));
    const firstConnectionCount = kitchen.connections();

    // Second call has nothing new — should return ok:true with printed_count=0
    // and skip the TCP send entirely.
    const second = await request(app)
      .post('/api/v1/print/kitchen')
      .set(s.auth)
      .send({ order_id: s.orderId });
    expect(second.status).toBe(200);
    expect(second.body.data.printed_count).toBe(0);
    expect(second.body.data.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 30));
    expect(kitchen.connections()).toBe(firstConnectionCount);
  });

  it('POST /print/kitchen returns ok:false with an error message when printer is unreachable', async () => {
    const s = await seedOrderWithItem();
    await configurePrinters(s.auth, kitchen.port, receipt.port);

    // Repoint kitchen to a definitely-closed port — bytes will never arrive.
    await kitchen.close();
    // Wait a hair so the OS frees the port and the next connect fails fast.
    await new Promise((r) => setTimeout(r, 20));

    const res = await request(app)
      .post('/api/v1/print/kitchen')
      .set(s.auth)
      .send({ order_id: s.orderId });

    // Endpoint never 500s on a printer outage — the failure is data, not an exception.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ok).toBe(false);
    expect(typeof res.body.data.error).toBe('string');
    expect(res.body.data.error.length).toBeGreaterThan(0);
  });

  it('POST /print/kitchen errors out cleanly when no IP is configured', async () => {
    const s = await seedOrderWithItem();
    // Default seeded value is '' — leave it that way.

    const res = await request(app)
      .post('/api/v1/print/kitchen')
      .set(s.auth)
      .send({ order_id: s.orderId });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);
    expect(res.body.data.error).toMatch(/not configured/i);
  });

  it('POST /print/receipt formats payments + change and sends to the receipt printer', async () => {
    const s = await seedOrderWithItem();
    await configurePrinters(s.auth, kitchen.port, receipt.port);

    // 2 × 6500 = 13000. Cash 15000 → 2000 change.
    await request(app)
      .post(`/api/v1/orders/${s.orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 15000 })
      .expect(201);

    const res = await request(app)
      .post('/api/v1/print/receipt')
      .set(s.auth)
      .send({ order_id: s.orderId });

    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    const lines: string[] = res.body.data.lines;
    expect(lines.some((l) => l.trim() === 'Test Cafe')).toBe(true);
    expect(lines.some((l) => l.trim() === '500 Test Ave')).toBe(true);
    expect(lines.some((l) => /^Total: +\$130\.00$/.test(l))).toBe(true);
    expect(lines.some((l) => /^Cash: +\$150\.00$/.test(l))).toBe(true);
    expect(lines.some((l) => /^Change: +\$20\.00$/.test(l))).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    const payload = receipt.received().toString('binary');
    expect(payload).toContain('Test Cafe');
    expect(payload).toContain('Total:');
  });

  it('POST /print/receipt returns 404 for an unknown order', async () => {
    const s = await seedOrderWithItem();
    await configurePrinters(s.auth, kitchen.port, receipt.port);

    const res = await request(app)
      .post('/api/v1/print/receipt')
      .set(s.auth)
      .send({ order_id: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(404);
  });

  it('GET /print/status reports connected when the mock is listening, disconnected after close', async () => {
    const user = await makeUser();
    const auth = authHeader(user.id);
    await configurePrinters(auth, kitchen.port, receipt.port);

    const live = await request(app).get('/api/v1/print/status').set(auth);
    expect(live.status).toBe(200);
    expect(live.body.data.kitchen.configured).toBe(true);
    expect(live.body.data.kitchen.connected).toBe(true);
    expect(live.body.data.receipt.configured).toBe(true);
    expect(live.body.data.receipt.connected).toBe(true);
    expect(live.body.data.paper_width).toBe(80);

    await kitchen.close();
    await receipt.close();
    await new Promise((r) => setTimeout(r, 20));

    const dead = await request(app).get('/api/v1/print/status').set(auth);
    expect(dead.body.data.kitchen.connected).toBe(false);
    expect(dead.body.data.receipt.connected).toBe(false);
  });

  it('GET /print/status reports configured=false when IPs are blank', async () => {
    const user = await makeUser();
    const auth = authHeader(user.id);
    // Leave settings at the default empty IP.

    const res = await request(app).get('/api/v1/print/status').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.kitchen.configured).toBe(false);
    expect(res.body.data.kitchen.connected).toBe(false);
    expect(res.body.data.receipt.configured).toBe(false);
  });

  it('PATCH /settings persists printer keys end-to-end (CRUD smoke)', async () => {
    const user = await makeUser();
    const auth = authHeader(user.id);
    const before = await request(app).get('/api/v1/settings').set(auth);
    expect(before.status).toBe(200);

    const patch = {
      printer_kitchen_ip: '10.0.0.7',
      printer_kitchen_port: '9100',
      printer_receipt_ip: '10.0.0.8',
      printer_receipt_port: '9100',
      printer_paper_width: '58',
      business_name: 'Test',
      business_address: 'Anywhere',
    };
    const updated = await request(app).patch('/api/v1/settings').set(auth).send(patch);
    expect(updated.status).toBe(200);
    expect(updated.body.data.printer_kitchen_ip).toBe('10.0.0.7');
    expect(updated.body.data.printer_paper_width).toBe('58');

    // Round-trip: GET reflects the same values.
    const after = await request(app).get('/api/v1/settings').set(auth);
    expect(after.body.data.business_name).toBe('Test');
    expect(after.body.data.printer_receipt_ip).toBe('10.0.0.8');
  });
});
