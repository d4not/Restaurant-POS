import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import {
  makeUser,
  makeSupplier,
  makeStorage,
  makeSupplyCategory,
  makeSupply,
} from '../helpers/factories.js';
import { openRegister } from '../../src/modules/cash-registers/service.js';

const app = getTestApp();

interface Fixtures {
  cashier: { id: string; auth: Record<string, string> };
  manager: { id: string; auth: Record<string, string> };
  runnerId: string;
  supplierId: string;
  storageId: string;
  veggieId: string;
  registerId: string;
}

async function setupFixtures(): Promise<Fixtures> {
  const [cashier, manager, runner, supplier, storage, category] = await Promise.all([
    makeUser({ role: 'CASHIER' }),
    makeUser({ role: 'MANAGER' }),
    makeUser({ role: 'WAITER', name: 'Andrea' }),
    makeSupplier({ name: 'La Mexicana' }),
    makeStorage({ name: 'Cocina' }),
    makeSupplyCategory({ name: 'Produce' }),
  ]);
  const veggie = await makeSupply({
    category_id: category.id,
    name: 'Lechuga romana',
    base_unit: 'KG',
  });
  await prisma.supplier.update({
    where: { id: supplier.id },
    data: { kind: 'ERRAND' },
  });
  const register = await openRegister(cashier.id, { opening_amount: 100000 });
  return {
    cashier: { id: cashier.id, auth: authHeader(cashier.id, 'CASHIER') },
    manager: { id: manager.id, auth: authHeader(manager.id, 'MANAGER') },
    runnerId: runner.id,
    supplierId: supplier.id,
    storageId: storage.id,
    veggieId: veggie.id,
    registerId: register.id,
  };
}

describe('Errand purchase lifecycle — happy path', () => {
  let f: Fixtures;
  beforeEach(async () => {
    f = await setupFixtures();
  });

  it('walks DRAFT → DISPATCHED → RETURNED → VERIFIED with CashMovements', async () => {
    // 1. Cashier drafts an errand: 5 kg of lechuga at $80 (8000 centavos) each.
    const createRes = await request(app)
      .post('/api/v1/purchases')
      .set(f.cashier.auth)
      .send({
        supplier_id: f.supplierId,
        storage_id: f.storageId,
        date: '2026-05-24T08:00:00Z',
        kind: 'ERRAND',
        items: [{ supply_id: f.veggieId, package_quantity: 5, price_per_package: 8000 }],
      });
    expect(createRes.status).toBe(201);
    const id = createRes.body.data.id as string;
    const itemIds = createRes.body.data.items.map((it: { id: string }) => it.id) as string[];
    expect(createRes.body.data.kind).toBe('ERRAND');
    expect(createRes.body.data.status).toBe('DRAFT');

    // Pre-dispatch register state: expected = opening (100000).
    let reg = await prisma.cashRegister.findUniqueOrThrow({ where: { id: f.registerId } });
    expect(reg.expected_amount.toString()).toBe('100000');

    // 2. /dispatch — cashier hands $500 (50000 centavos) to the runner.
    const dispatchRes = await request(app)
      .post(`/api/v1/purchases/${id}/dispatch`)
      .set(f.cashier.auth)
      .send({ runner_user_id: f.runnerId, cash_advanced: 50000 });
    expect(dispatchRes.status).toBe(200);
    expect(dispatchRes.body.data.status).toBe('DISPATCHED');
    expect(dispatchRes.body.data.cash_advanced).toBe('50000');
    expect(dispatchRes.body.data.runner?.id).toBe(f.runnerId);
    expect(dispatchRes.body.data.dispatched_at).toBeTruthy();

    // A CASH_OUT movement attached to the purchase landed in the register.
    const movementsAfterDispatch = await prisma.cashMovement.findMany({
      where: { reference_type: 'Purchase', reference_id: id },
      orderBy: { created_at: 'asc' },
    });
    expect(movementsAfterDispatch).toHaveLength(1);
    expect(movementsAfterDispatch[0]!.type).toBe('CASH_OUT');
    expect(movementsAfterDispatch[0]!.amount.toString()).toBe('50000');
    expect(movementsAfterDispatch[0]!.register_id).toBe(f.registerId);

    // expected_amount = 100000 (opening) - 50000 (cash out) = 50000
    reg = await prisma.cashRegister.findUniqueOrThrow({ where: { id: f.registerId } });
    expect(reg.expected_amount.toString()).toBe('50000');

    // 3. Runner returns with 4kg (one short) and $80 change. Cashier captures.
    const returnRes = await request(app)
      .post(`/api/v1/purchases/${id}/return`)
      .set(f.cashier.auth)
      .send({
        cash_returned: 8000,
        items: [
          {
            id: itemIds[0],
            received_package_quantity: 4,
            shortfall_reason: 'out_of_stock',
          },
        ],
      });
    expect(returnRes.status).toBe(200);
    expect(returnRes.body.data.status).toBe('RETURNED');
    expect(returnRes.body.data.cash_returned).toBe('8000');

    // CashMovement CASH_IN for the change should now exist.
    const movementsAfterReturn = await prisma.cashMovement.findMany({
      where: { reference_type: 'Purchase', reference_id: id },
      orderBy: { created_at: 'asc' },
    });
    expect(movementsAfterReturn).toHaveLength(2);
    expect(movementsAfterReturn[1]!.type).toBe('CASH_IN');
    expect(movementsAfterReturn[1]!.amount.toString()).toBe('8000');

    // expected_amount = 100000 - 50000 + 8000 = 58000
    reg = await prisma.cashRegister.findUniqueOrThrow({ where: { id: f.registerId } });
    expect(reg.expected_amount.toString()).toBe('58000');

    // Stock still NOT absorbed — verify is the manager step.
    let stocks = await prisma.storageStock.findMany({ where: { supply_id: f.veggieId } });
    expect(stocks).toHaveLength(0);

    // 4. Manager verifies — stock absorbs the received 4kg (not the ordered 5).
    const verifyRes = await request(app)
      .post(`/api/v1/purchases/${id}/verify`)
      .set(f.manager.auth)
      .send({});
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.status).toBe('VERIFIED');

    stocks = await prisma.storageStock.findMany({ where: { supply_id: f.veggieId } });
    expect(stocks).toHaveLength(1);
    expect(stocks[0]!.quantity.toString()).toBe('4');

    // Exactly one StockMovement at unit_cost = 8000.
    const stockMoves = await prisma.stockMovement.findMany({
      where: { reference_type: 'Purchase', reference_id: id },
    });
    expect(stockMoves).toHaveLength(1);
    expect(stockMoves[0]!.quantity.toString()).toBe('4');
    expect(stockMoves[0]!.unit_cost.toString()).toBe('8000');
  });

  it('skips the CASH_IN movement when runner returns no change', async () => {
    const created = await request(app)
      .post('/api/v1/purchases')
      .set(f.cashier.auth)
      .send({
        supplier_id: f.supplierId,
        storage_id: f.storageId,
        date: '2026-05-24T08:00:00Z',
        kind: 'ERRAND',
        items: [{ supply_id: f.veggieId, package_quantity: 5, price_per_package: 8000 }],
      });
    const id = created.body.data.id as string;
    const itemIds = created.body.data.items.map((it: { id: string }) => it.id) as string[];

    await request(app)
      .post(`/api/v1/purchases/${id}/dispatch`)
      .set(f.cashier.auth)
      .send({ runner_user_id: f.runnerId, cash_advanced: 40000 })
      .expect(200);

    await request(app)
      .post(`/api/v1/purchases/${id}/return`)
      .set(f.cashier.auth)
      .send({
        cash_returned: 0,
        items: [{ id: itemIds[0], received_package_quantity: 5 }],
      })
      .expect(200);

    const movements = await prisma.cashMovement.findMany({
      where: { reference_type: 'Purchase', reference_id: id },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.type).toBe('CASH_OUT');
  });

  it('rejects /dispatch when there is no open shift', async () => {
    // Close the seeded register so dispatch has nothing to attach to.
    await prisma.cashRegister.update({
      where: { id: f.registerId },
      data: { status: 'CLOSED', closed_at: new Date() },
    });

    const created = await request(app)
      .post('/api/v1/purchases')
      .set(f.cashier.auth)
      .send({
        supplier_id: f.supplierId,
        storage_id: f.storageId,
        date: '2026-05-24T08:00:00Z',
        kind: 'ERRAND',
        items: [{ supply_id: f.veggieId, package_quantity: 1, price_per_package: 1000 }],
      });
    const id = created.body.data.id as string;

    const res = await request(app)
      .post(`/api/v1/purchases/${id}/dispatch`)
      .set(f.cashier.auth)
      .send({ runner_user_id: f.runnerId, cash_advanced: 1000 });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/no open shift/i);
  });

  it('refuses /cancel on a DISPATCHED errand — must /return first', async () => {
    const created = await request(app)
      .post('/api/v1/purchases')
      .set(f.cashier.auth)
      .send({
        supplier_id: f.supplierId,
        storage_id: f.storageId,
        date: '2026-05-24T08:00:00Z',
        kind: 'ERRAND',
        items: [{ supply_id: f.veggieId, package_quantity: 1, price_per_package: 1000 }],
      });
    const id = created.body.data.id as string;

    await request(app)
      .post(`/api/v1/purchases/${id}/dispatch`)
      .set(f.cashier.auth)
      .send({ runner_user_id: f.runnerId, cash_advanced: 1000 })
      .expect(200);

    const res = await request(app)
      .post(`/api/v1/purchases/${id}/cancel`)
      .set(f.cashier.auth)
      .send({ cancel_reason: 'runner sick' });
    expect(res.status).toBe(409);
  });
});
