import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { Decimal } from '../../src/lib/decimal.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';

// ──────────────────────────────────────────────────────────────────────────────
// Full-flow audit — exercises the user-facing paths from Pass 2 of the audit
// (supply→packaging→purchase→stock/WAC, DISH+SWAP→order→deduction, register
// lifecycle, payroll generation) against the live HTTP layer. Each scenario is
// a regression guard proving the "happy path" a restaurant operator hits daily.
// ──────────────────────────────────────────────────────────────────────────────

const app = getTestApp();

describe('Full-flow audit — Phase 2 scenarios', () => {
  it('supply → supplier → packaging → purchase → confirm updates stock and WAC', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const auth = authHeader(admin.id);

    // 1. Create a supply via the API.
    const category = await prisma.supplyCategory.create({ data: { name: 'Audit Dairy' } });
    const supply = await request(app)
      .post('/api/v1/supplies')
      .set(auth)
      .send({
        name: 'Audit Whole Milk 1L',
        category_id: category.id,
        base_unit: 'BOTTLE',
        content_per_unit: 1000,
        content_unit: 'ML',
      })
      .expect(201);

    // 2. Create a supplier.
    const supplier = await request(app)
      .post('/api/v1/suppliers')
      .set(auth)
      .send({ name: 'Audit Supplier Co', credit_days: 15 })
      .expect(201);

    // 3. Create a packaging that links supply + supplier.
    const packaging = await request(app)
      .post('/api/v1/packagings')
      .set(auth)
      .send({
        supply_id: supply.body.data.id,
        supplier_id: supplier.body.data.id,
        name: 'Case of 6 bottles',
        units_per_package: 6,
        price_per_package: 21000, // 210.00 / case
      })
      .expect(201);
    expect(packaging.body.data.supplier_id).toBe(supplier.body.data.id);

    // 4. Create a storage to receive stock.
    const storage = await prisma.storage.create({
      data: { name: 'Audit Warehouse' },
    });

    // 5. Create a draft purchase, 2 cases, and confirm.
    const draft = await request(app)
      .post('/api/v1/purchases')
      .set(auth)
      .send({
        supplier_id: supplier.body.data.id,
        storage_id: storage.id,
        date: '2026-04-22T09:00:00Z',
        items: [
          {
            supply_id: supply.body.data.id,
            packaging_id: packaging.body.data.id,
            package_quantity: 2,
            price_per_package: 21000,
          },
        ],
      })
      .expect(201);

    const confirm = await request(app)
      .post(`/api/v1/purchases/${draft.body.data.id}/confirm`)
      .set(auth)
      .expect(200);
    // /confirm is a legacy alias that transitions DRAFT → VERIFIED in one shot
    // (the new lifecycle uses VERIFIED as the terminal stock-landed state;
    // CONFIRMED is kept only so historical rows still parse).
    expect(confirm.body.data.status).toBe('VERIFIED');

    // 6. Re-fetch the supply via the HTTP layer — what the admin UI would show.
    const detail = await request(app)
      .get(`/api/v1/supplies/${supply.body.data.id}`)
      .set(auth)
      .expect(200);

    // 2 cases × 6 bottles = 12 units at 21000/6 = 3500 centavos/bottle WAC.
    expect(detail.body.data.average_cost).toBe('3500');
    expect(detail.body.data.last_cost).toBe('3500');

    const stocks = await request(app)
      .get(`/api/v1/supplies/${supply.body.data.id}/stocks`)
      .set(auth)
      .expect(200);
    expect(stocks.body.data.items).toHaveLength(1);
    expect(stocks.body.data.items[0].storage_id).toBe(storage.id);
    expect(stocks.body.data.items[0].quantity).toBe('12');
  });

  it('DISH + SWAP modifier → order + payment deducts almond milk (not whole milk)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const auth = authHeader(admin.id);

    // 1. Storages + deduction rule so sales land on the bar.
    const bar = await prisma.storage.create({ data: { name: 'Audit Bar' } });
    await prisma.deductionRule.create({
      data: { station_id: null, pos_register_id: null, storage_id: bar.id },
    });

    // 2. Seed supplies with stock.
    const cat = await prisma.supplyCategory.create({ data: { name: 'Audit Ingredients' } });
    const milk = await prisma.supply.create({
      data: {
        name: 'Audit Whole Milk 946',
        category_id: cat.id,
        base_unit: 'BOTTLE',
        content_per_unit: 946,
        content_unit: 'ML',
        average_cost: 3500,
        last_cost: 3500,
      },
    });
    const almond = await prisma.supply.create({
      data: {
        name: 'Audit Almond Milk 1L',
        category_id: cat.id,
        base_unit: 'BOTTLE',
        content_per_unit: 1000,
        content_unit: 'ML',
        average_cost: 5500,
        last_cost: 5500,
      },
    });
    const espresso = await prisma.supply.create({
      data: {
        name: 'Audit Espresso Beans',
        category_id: cat.id,
        base_unit: 'BAG',
        content_per_unit: 1000,
        content_unit: 'G',
        average_cost: 40000,
        last_cost: 40000,
      },
    });

    await prisma.storageStock.createMany({
      data: [
        { supply_id: milk.id, storage_id: bar.id, quantity: 5 },
        { supply_id: almond.id, storage_id: bar.id, quantity: 3 },
        { supply_id: espresso.id, storage_id: bar.id, quantity: 2 },
      ],
    });

    // 3. Build the SWAP modifier group with whole-milk default + almond alt.
    const milkGroup = await prisma.modifierGroup.create({
      data: { name: 'Audit Milk Type', type: 'SWAP', min_selection: 0, max_selection: 1 },
    });
    await prisma.modifier.create({
      data: {
        group_id: milkGroup.id,
        name: 'Whole Milk',
        extra_price: 0,
        supply_id: milk.id,
        ratio: 1,
        is_default: true,
      },
    });
    const almondMod = await prisma.modifier.create({
      data: {
        group_id: milkGroup.id,
        name: 'Almond Milk',
        extra_price: 1000,
        supply_id: almond.id,
        ratio: 1,
      },
    });

    // 4. DISH + variant with a recipe that references the SWAP group.
    const product = await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send({ name: 'Audit Latte', type: 'DISH' })
      .expect(201);

    const variant = await request(app)
      .post(`/api/v1/products/${product.body.data.id}/variants`)
      .set(auth)
      .send({ name: 'Medium 12oz', sell_price: 6500 })
      .expect(201);

    const recipe = await request(app)
      .post(`/api/v1/recipes/variants/${variant.body.data.id}`)
      .set(auth)
      .send({})
      .expect(201);
    await request(app)
      .post(`/api/v1/recipes/${recipe.body.data.id}/items`)
      .set(auth)
      .send({ modifier_group_id: milkGroup.id, quantity: 200, unit: 'ml' })
      .expect(201);
    await request(app)
      .post(`/api/v1/recipes/${recipe.body.data.id}/items`)
      .set(auth)
      .send({ supply_id: espresso.id, quantity: 18, unit: 'g' })
      .expect(201);

    // 5. Attach the SWAP group to the product so the order flow accepts the
    //    almond-milk modifier id at item-add time.
    await request(app)
      .post(`/api/v1/products/${product.body.data.id}/modifier-groups`)
      .set(auth)
      .send({ modifier_group_id: milkGroup.id })
      .expect(201);

    // 6. Full order lifecycle: open register → order → item (with almond SWAP)
    //    → cash payment → verify deduction.
    const register = await request(app)
      .post('/api/v1/registers')
      .set(auth)
      .send({ opening_amount: 100000 })
      .expect(201);

    const order = await request(app)
      .post('/api/v1/orders')
      .set(auth)
      .send({ register_id: register.body.data.id, order_type: 'DINE_IN' })
      .expect(201);

    await request(app)
      .post(`/api/v1/orders/${order.body.data.id}/items`)
      .set(auth)
      .send({
        product_id: product.body.data.id,
        variant_id: variant.body.data.id,
        quantity: 1,
        modifier_ids: [almondMod.id],
      })
      .expect(201);

    const paid = await request(app)
      .post(`/api/v1/orders/${order.body.data.id}/payments`)
      .set(auth)
      .send({ method: 'CASH', amount: 10000 })
      .expect(201);
    expect(paid.body.data.order.status).toBe('PAID');

    // 7. Stock check — whole milk untouched, almond milk drawn 0.2 bottle
    //    (200ml / 1000ml), espresso drawn 0.018 bag (18g / 1000g).
    const milkStock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: milk.id, storage_id: bar.id },
    });
    expect(new Decimal(milkStock.quantity).equals(5)).toBe(true);

    const almondStock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: almond.id, storage_id: bar.id },
    });
    expect(new Decimal(almondStock.quantity).equals('2.8')).toBe(true);

    const espressoStock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: espresso.id, storage_id: bar.id },
    });
    expect(new Decimal(espressoStock.quantity).equals('1.982')).toBe(true);

    // 8. SALE movements were logged for both consumed supplies, not for whole
    //    milk (the SWAP took it out of the slot).
    const saleMovements = await prisma.stockMovement.findMany({
      where: {
        type: 'SALE',
        reference_type: 'Order',
        reference_id: order.body.data.id,
      },
      select: { supply_id: true },
    });
    const consumed = new Set(saleMovements.map((m) => m.supply_id));
    expect(consumed.has(milk.id)).toBe(false);
    expect(consumed.has(almond.id)).toBe(true);
    expect(consumed.has(espresso.id)).toBe(true);
  });

  it('register lifecycle: open → CASH + CARD orders → close calculates expected_amount', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const auth = authHeader(admin.id);

    // Packaged PRODUCT — simplest path so the focus stays on register math.
    const cat = await prisma.supplyCategory.create({ data: { name: 'Audit Bottled' } });
    const water = await prisma.supply.create({
      data: {
        name: 'Audit Water 500',
        category_id: cat.id,
        base_unit: 'BOTTLE',
        average_cost: 1000,
        last_cost: 1000,
      },
    });
    const storage = await prisma.storage.create({ data: { name: 'Audit Storage' } });
    await prisma.storageStock.create({
      data: { supply_id: water.id, storage_id: storage.id, quantity: 100 },
    });
    await prisma.deductionRule.create({
      data: { station_id: null, pos_register_id: null, storage_id: storage.id },
    });

    const product = await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send({
        name: 'Audit Water Product',
        type: 'PRODUCT',
        sell_price: 2500,
        supply_id: water.id,
      })
      .expect(201);

    // Open register, process two orders — one cash, one card.
    const reg = await request(app)
      .post('/api/v1/registers')
      .set(auth)
      .send({ opening_amount: 50000 })
      .expect(201);

    // Cash sale: $25 item, customer pays $30, change $5, net cash +$25.
    const cashOrder = await request(app)
      .post('/api/v1/orders')
      .set(auth)
      .send({ register_id: reg.body.data.id, order_type: 'TAKEOUT', takeout_channel: 'LOCAL' })
      .expect(201);
    await request(app)
      .post(`/api/v1/orders/${cashOrder.body.data.id}/items`)
      .set(auth)
      .send({ product_id: product.body.data.id, quantity: 1 })
      .expect(201);
    await request(app)
      .post(`/api/v1/orders/${cashOrder.body.data.id}/payments`)
      .set(auth)
      .send({ method: 'CASH', amount: 3000 })
      .expect(201);

    // Card sale: $25 item paid by card — no effect on the cash drawer.
    const cardOrder = await request(app)
      .post('/api/v1/orders')
      .set(auth)
      .send({ register_id: reg.body.data.id, order_type: 'DINE_IN' })
      .expect(201);
    await request(app)
      .post(`/api/v1/orders/${cardOrder.body.data.id}/items`)
      .set(auth)
      .send({ product_id: product.body.data.id, quantity: 1 })
      .expect(201);
    await request(app)
      .post(`/api/v1/orders/${cardOrder.body.data.id}/payments`)
      .set(auth)
      .send({ method: 'CARD', amount: 2500, reference: 'auth-audit' })
      .expect(201);

    // Close the register counting exactly what's expected. Expected =
    // 50000 opening + 2500 cash sale = 52500, no drawer variance.
    const close = await request(app)
      .post(`/api/v1/registers/${reg.body.data.id}/close`)
      .set(auth)
      .send({ actual_amount: 52500 })
      .expect(200);
    expect(close.body.data.status).toBe('CLOSED');
    expect(close.body.data.expected_amount).toBe('52500');
    expect(close.body.data.actual_amount).toBe('52500');
    expect(close.body.data.difference).toBe('0');
  });

  it('payroll generation computes net_pay from attendance + bonuses', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const auth = authHeader(admin.id);

    // Employee with a 600000-centavo weekly salary and an unpaid absence,
    // tested against the SPEC.md §8.4 formula.
    const emp = await prisma.user.create({
      data: {
        name: 'Audit Employee',
        email: 'audit-emp@pos.local',
        pin: '1111',
        password_hash: 'test-hash',
        role: 'BARISTA',
        weekly_salary: 600000,
      },
    });

    // Pick the most recent Monday so week_start passes the isMonday validation.
    const today = new Date();
    const mondayOffset = (today.getUTCDay() + 6) % 7;
    const weekStart = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - mondayOffset,
    ));

    const attendance: Array<{ offset: number; status: 'PRESENT' | 'ABSENT' | 'DAY_OFF'; is_paid?: boolean }> = [
      { offset: 0, status: 'PRESENT' },
      { offset: 1, status: 'PRESENT' },
      { offset: 2, status: 'ABSENT', is_paid: false }, // No-show
      { offset: 3, status: 'PRESENT' },
      { offset: 4, status: 'PRESENT' },
      { offset: 5, status: 'PRESENT' },
      { offset: 6, status: 'DAY_OFF' },
    ];
    for (const a of attendance) {
      const date = new Date(weekStart);
      date.setUTCDate(date.getUTCDate() + a.offset);
      await prisma.attendance.create({
        data: {
          user_id: emp.id,
          date,
          status: a.status,
          is_paid: a.is_paid ?? true,
          recorded_by: admin.id,
        },
      });
    }

    // Generate payroll for the week. days_expected = 6 → daily_rate = 100000.
    const generated = await request(app)
      .post('/api/v1/payroll/generate')
      .set(auth)
      .send({ week_start: weekStart.toISOString(), days_expected: 6 })
      .expect(201);
    expect(generated.body.data.generated).toBeGreaterThan(0);

    // Find the period we just made.
    const listed = await request(app)
      .get('/api/v1/payroll')
      .query({ user_id: emp.id })
      .set(auth)
      .expect(200);
    const period = listed.body.data.items.find(
      (p: { user_id: string }) => p.user_id === emp.id,
    );
    expect(period).toBeTruthy();
    // Days worked = 5 (PRESENT), days_absent = 1 (unpaid). Deductions =
    // 1 × (600000/6) = 100000. Net = 600000 - 100000 + 0 = 500000.
    expect(period.days_worked).toBe(5);
    expect(period.unpaid_absences).toBe(1);
    expect(period.gross_pay).toBe('600000');
    expect(period.deductions).toBe('100000');
    expect(period.net_pay).toBe('500000');
    expect(period.status).toBe('DRAFT');
  });
});
