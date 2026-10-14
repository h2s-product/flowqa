/**
 * Demo "Maxxi Sales API" yang berjalan di dalam server Testora (/demo-api/:mode).
 * Tujuannya agar test demo bisa langsung dijalankan tanpa layanan eksternal.
 *   /demo-api/live     → pembayaran langsung PAID bila nominal cocok
 *   /demo-api/sandbox  → gateway sandbox: pembayaran selalu PENDING
 * Bukan bagian dari produk — boleh dihapus bersama seed demo.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomBytes } from 'node:crypto';

export const DEMO_PASSWORD = 'Demo#Pass2026';
const PRICE = 125_000;

interface Store {
  customers: Map<string, Record<string, any>>;
  orders: Map<string, Record<string, any>>;
  payments: Map<string, Record<string, any>>;
}

const stores = new Map<string, Store>();
const tokens = new Set<string>();
let sequence = 50_000;

const store = (mode: string): Store => {
  if (!stores.has(mode)) stores.set(mode, { customers: new Map(), orders: new Map(), payments: new Map() });
  return stores.get(mode)!;
};
const nextId = (prefix: string) => `${prefix}-${++sequence}`;
const latency = () => new Promise((r) => setTimeout(r, 40 + Math.random() * 160));

function requireToken(req: Request, res: Response, next: NextFunction) {
  const token = (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!tokens.has(token)) {
    res.status(401).json({ error: token ? 'Token is invalid or expired' : 'Missing Authorization token' });
    return;
  }
  next();
}

export function demoSalesApi(): Router {
  const router = Router({ mergeParams: true });
  router.use(async (_req, _res, next) => {
    await latency();
    next();
  });
  const db = (req: Request) => store(req.params.mode === 'sandbox' ? 'sandbox' : 'live');

  router.post('/auth/login', (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
    if (password !== DEMO_PASSWORD) return res.status(401).json({ error: 'Invalid email or password' });
    const token = `eyJhbGciOiJIUzI1NiJ9.${randomBytes(18).toString('base64url')}`;
    tokens.add(token);
    res.cookie('session', randomBytes(8).toString('hex'), { httpOnly: true, path: '/' });
    res.json({ token, expires_in: 3600, user: { id: 123, name: 'QA Tester', role: 'tester' } });
  });

  router.post('/auth/logout', requireToken, (req, res) => {
    tokens.delete((req.header('authorization') ?? '').replace(/^Bearer\s+/i, ''));
    res.json({ message: 'Logged out' });
  });

  router.post('/api/customers', requireToken, (req, res) => {
    const { name, phone, email } = req.body ?? {};
    if (!name) return res.status(422).json({ error: 'name is required', field: 'name' });
    if (email && !String(email).includes('@'))
      return res.status(422).json({ error: 'email is not a valid address', field: 'email' });
    const customer = {
      id: nextId('CUS'),
      name,
      phone: phone ?? null,
      email: email ?? null,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
    };
    db(req).customers.set(customer.id, customer);
    res.status(201).json(customer);
  });

  router.get('/api/customers/:id', requireToken, (req, res) => {
    const customer = db(req).customers.get(req.params.id);
    customer ? res.json(customer) : res.status(404).json({ error: `Customer ${req.params.id} not found` });
  });

  router.post('/api/orders', requireToken, (req, res) => {
    const { customer_id, product_sku, quantity } = req.body ?? {};
    if (!db(req).customers.has(customer_id))
      return res
        .status(422)
        .json({ error: `customer_id ${customer_id ?? '(empty)'} does not exist`, field: 'customer_id' });
    const qty = Number(quantity ?? 1);
    if (!Number.isInteger(qty) || qty < 1)
      return res.status(422).json({ error: 'quantity must be a whole number above 0', field: 'quantity' });
    const order = {
      id: nextId('ORD'),
      customer_id,
      status: 'CREATED',
      items: [{ sku: product_sku ?? 'SKU-1001', quantity: qty, price: PRICE }],
      quantity: qty,
      total: qty * PRICE,
      currency: 'IDR',
      note: '',
    };
    db(req).orders.set(order.id, order);
    res.status(201).json(order);
  });

  router.get('/api/orders/:id', requireToken, (req, res) => {
    const order = db(req).orders.get(req.params.id);
    order ? res.json(order) : res.status(404).json({ error: `Order ${req.params.id} not found` });
  });

  router.patch('/api/orders/:id', requireToken, (req, res) => {
    const order = db(req).orders.get(req.params.id);
    if (!order) return res.status(404).json({ error: `Order ${req.params.id} not found` });
    if (order.status !== 'CREATED')
      return res.status(409).json({ error: `Order is ${order.status} and can no longer be changed` });
    const { quantity, note } = req.body ?? {};
    if (quantity !== undefined) {
      const qty = Number(quantity);
      if (!Number.isInteger(qty) || qty < 1)
        return res.status(422).json({ error: 'quantity must be a whole number above 0', field: 'quantity' });
      order.quantity = qty;
      order.items[0].quantity = qty;
      order.total = qty * PRICE;
    }
    if (note !== undefined) order.note = note;
    res.json(order);
  });

  router.post('/api/orders/:id/cancel', requireToken, (req, res) => {
    const order = db(req).orders.get(req.params.id);
    if (!order) return res.status(404).json({ error: `Order ${req.params.id} not found` });
    if (order.status === 'CANCELLED') return res.status(409).json({ error: 'Order is already cancelled' });
    const wasPaid = order.status === 'PAID';
    order.status = 'CANCELLED';
    order.cancel_reason = req.body?.reason ?? null;
    res.json({
      id: order.id,
      status: order.status,
      cancel_reason: order.cancel_reason,
      ...(wasPaid ? { refund: { status: 'REFUND_INITIATED', amount: order.total } } : {}),
    });
  });

  router.post('/api/payments', requireToken, (req, res) => {
    const { order_id, amount, method } = req.body ?? {};
    const order = db(req).orders.get(order_id);
    if (!order)
      return res
        .status(422)
        .json({ error: `order_id ${order_id ?? '(empty)'} does not exist`, field: 'order_id' });
    if (order.status === 'CANCELLED')
      return res.status(409).json({ error: 'Cannot pay for a cancelled order' });
    const value = Number(amount);
    const sandbox = req.params.mode === 'sandbox';
    const status = !sandbox && value === order.total ? 'PAID' : 'PENDING';
    const payment: Record<string, any> = {
      id: nextId('PAY'),
      order_id,
      amount: value,
      method: method ?? 'VA_BCA',
      status,
      paid_at: status === 'PAID' ? new Date().toISOString() : null,
    };
    if (sandbox) payment.message = 'Sandbox gateway: payment awaiting bank confirmation';
    else if (value !== order.total)
      payment.message = `Amount ${value} does not match order total ${order.total}`;
    if (status === 'PAID') order.status = 'PAID';
    db(req).payments.set(payment.id, payment);
    res.status(201).json(payment);
  });

  router.get('/api/payments/:id', requireToken, (req, res) => {
    const payment = db(req).payments.get(req.params.id);
    payment ? res.json(payment) : res.status(404).json({ error: `Payment ${req.params.id} not found` });
  });

  router.use((req, res) => res.status(404).json({ error: `No demo endpoint for ${req.method} ${req.path}` }));
  return router;
}
