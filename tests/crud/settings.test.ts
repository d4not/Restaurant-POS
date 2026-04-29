import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import {
  makeStorage,
  makeSupplier,
  makeSupply,
  makeSupplyCategory,
  makeUser,
} from '../helpers/factories.js';

const app = getTestApp();

describe('Settings — key/value store for singleton configuration', () => {
  let auth: Record<string, string>;
  beforeEach(async () => {
    auth = authHeader((await makeUser()).id);
  });

  it('returns an empty object when no settings have been written', async () => {
    const res = await request(app).get('/api/v1/settings').set(auth).expect(200);
    expect(res.body.data).toEqual({});
  });

  it('upserts settings via PATCH and returns the full merged store', async () => {
    // First write.
    const first = await request(app)
      .patch('/api/v1/settings')
      .set(auth)
      .send({ default_tax_id: '' })
      .expect(200);
    expect(first.body.data).toEqual({ default_tax_id: '' });

    // Second write — overwrites one key, adds another.
    const second = await request(app)
      .patch('/api/v1/settings')
      .set(auth)
      .send({ timezone: 'America/Mexico_City' })
      .expect(200);
    expect(second.body.data).toEqual({
      default_tax_id: '',
      timezone: 'America/Mexico_City',
    });
  });

  it('rejects default_tax_id pointing at a non-existent tax', async () => {
    const res = await request(app)
      .patch('/api/v1/settings')
      .set(auth)
      .send({ default_tax_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(400);
  });

  it('accepts a valid default_tax_id referencing an existing tax', async () => {
    const tax = await request(app)
      .post('/api/v1/taxes')
      .set(auth)
      .send({ name: 'IVA 16%', rate: 16 })
      .expect(201);

    const res = await request(app)
      .patch('/api/v1/settings')
      .set(auth)
      .send({ default_tax_id: tax.body.data.id })
      .expect(200);
    expect(res.body.data.default_tax_id).toBe(tax.body.data.id);
  });

  it('requires at least one key in the PATCH body', async () => {
    const res = await request(app).patch('/api/v1/settings').set(auth).send({});
    expect(res.status).toBe(422);
  });

  it('rejects non-admin writes to report-template keys (XSS guard)', async () => {
    // Cashier tries to inject a stylesheet that would otherwise render raw
    // into the printable corte-Z. Renderer escapes business fields but
    // interpolates report_custom_css verbatim, so write access must be
    // ADMIN-only. See settings/controller.ts:ADMIN_ONLY_SETTING_KEYS.
    const cashier = await makeUser({ role: 'CASHIER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const res = await request(app)
      .patch('/api/v1/settings')
      .set(cashierAuth)
      .send({ report_custom_css: '</style><script>alert(1)</script>' });
    expect(res.status).toBe(403);
  });

  it('rejects non-admin writes to non-printer business keys', async () => {
    // Same gate covers business_name etc. — printer keys stay open to
    // CASHIER+ so the operations-hub printer-check assign keeps working.
    const cashier = await makeUser({ role: 'CASHIER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const res = await request(app)
      .patch('/api/v1/settings')
      .set(cashierAuth)
      .send({ business_name: 'Hijacked' });
    expect(res.status).toBe(403);
  });

  it('allows non-admin writes to printer keys', async () => {
    const cashier = await makeUser({ role: 'CASHIER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const res = await request(app)
      .patch('/api/v1/settings')
      .set(cashierAuth)
      .send({ printer_kitchen_ip: '192.168.1.50', printer_kitchen_port: '9100' });
    expect(res.status).toBe(200);
    expect(res.body.data.printer_kitchen_ip).toBe('192.168.1.50');
  });
});

describe('Default tax — applied at order-item time when Product.tax_id is null', () => {
  async function seed(): Promise<{
    auth: Record<string, string>;
    registerId: string;
    productId: string;
    ivaTaxId: string;
  }> {
    const user = await makeUser();
    const auth = authHeader(user.id);
    const [cat, supplier, barra] = await Promise.all([
      makeSupplyCategory(),
      makeSupplier(),
      makeStorage({ name: 'Bar' }),
    ]);
    const supply = await makeSupply({
      category_id: cat.id,
      base_unit: 'BOTTLE',
    });

    // Stock so the close-flow doesn't stall — these tests don't verify
    // deduction, only that the line tax was picked up from settings.
    const purchase = await request(app).post('/api/v1/purchases').set(auth).send({
      supplier_id: supplier.id,
      storage_id: barra.id,
      date: '2026-04-22T00:00:00Z',
      items: [
        { supply_id: supply.id, packaging_id: null, package_quantity: 20, price_per_package: 1000 },
      ],
    });
    expect(purchase.status).toBe(201);
    await request(app)
      .post(`/api/v1/purchases/${purchase.body.data.id}/confirm`)
      .set(auth)
      .expect(200);

    // Product with NO tax_id — the default setting should fill it in.
    const product = await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send({
        name: 'Untagged Water',
        type: 'PRODUCT',
        sell_price: 1000,
        supply_id: supply.id,
      })
      .expect(201);

    const tax = await request(app)
      .post('/api/v1/taxes')
      .set(auth)
      .send({ name: 'IVA 16%', rate: 16 })
      .expect(201);

    const register = await request(app)
      .post('/api/v1/registers')
      .set(auth)
      .send({ opening_amount: 0 })
      .expect(201);

    await request(app)
      .post('/api/v1/deduction-rules')
      .set(auth)
      .send({ pos_register_id: register.body.data.id, storage_id: barra.id })
      .expect(201);

    return {
      auth,
      registerId: register.body.data.id as string,
      productId: product.body.data.id as string,
      ivaTaxId: tax.body.data.id as string,
    };
  }

  it('applies the default_tax_id to products without their own tax_id', async () => {
    const s = await seed();
    await request(app)
      .patch('/api/v1/settings')
      .set(s.auth)
      .send({ default_tax_id: s.ivaTaxId })
      .expect(200);

    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);

    const added = await request(app)
      .post(`/api/v1/orders/${order.body.data.id}/items`)
      .set(s.auth)
      .send({ product_id: s.productId, quantity: 1 })
      .expect(201);

    // Default 16% flowed in: line 1000 inc. tax → base 862, tax 138.
    const item = added.body.data.items[0];
    expect(item.tax_rate).toBe('16');
    expect(item.base_amount).toBe('862');
    expect(item.tax_amount).toBe('138');
  });

  it('does not apply a default when default_tax_id setting is absent', async () => {
    const s = await seed();

    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);

    const added = await request(app)
      .post(`/api/v1/orders/${order.body.data.id}/items`)
      .set(s.auth)
      .send({ product_id: s.productId, quantity: 1 })
      .expect(201);

    const item = added.body.data.items[0];
    expect(item.tax_rate).toBe('0');
    expect(item.tax_amount).toBe('0');
    expect(item.base_amount).toBe('1000');
  });

  it('default is ignored when the product has its own tax_id (even if rate is 0)', async () => {
    const s = await seed();
    await request(app)
      .patch('/api/v1/settings')
      .set(s.auth)
      .send({ default_tax_id: s.ivaTaxId })
      .expect(200);

    // Mark the product Tax Exempt explicitly with a 0% tax row.
    const exemptTax = await request(app)
      .post('/api/v1/taxes')
      .set(s.auth)
      .send({ name: 'Tax Exempt', rate: 0 })
      .expect(201);
    await request(app)
      .patch(`/api/v1/products/${s.productId}`)
      .set(s.auth)
      .send({ tax_id: exemptTax.body.data.id })
      .expect(200);

    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);

    const added = await request(app)
      .post(`/api/v1/orders/${order.body.data.id}/items`)
      .set(s.auth)
      .send({ product_id: s.productId, quantity: 1 })
      .expect(201);

    const item = added.body.data.items[0];
    expect(item.tax_rate).toBe('0');
    expect(item.tax_amount).toBe('0');
    expect(item.base_amount).toBe('1000');
  });
});
