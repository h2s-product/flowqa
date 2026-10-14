/**
 * Demo web shop sederhana (/demo-web) sebagai target contoh UI Tester:
 * login → pilih produk → checkout → konfirmasi. Semua data hanya di browser
 * (sessionStorage), tidak ada yang disimpan di server.
 */
import { Router } from 'express';

export const DEMO_WEB_PASSWORD = 'demo123';

const layout = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Demo Shop</title>
<style>
  *{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#f4f6f5;color:#15201b}
  header{background:#15201b;color:#fff;padding:12px 24px;display:flex;align-items:center;gap:16px}header b{font-size:17px}
  header .grow{flex:1}main{max-width:880px;margin:32px auto;padding:0 16px}
  .card{background:#fff;border:1px solid #dfe6e2;border-radius:12px;padding:20px}
  label{display:block;font-weight:600;font-size:13px;margin:12px 0 4px}
  input,select{width:100%;padding:9px 11px;border:1px solid #cbd5d0;border-radius:8px;font:inherit}
  button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:10px 16px;background:#18925b;color:#fff;cursor:pointer}
  button.ghost{background:#eef2f0;color:#15201b}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
  .error{color:#cf3b45;margin-top:10px;min-height:1.5em}.price{font-weight:700;color:#0f6b41}.check{display:flex;gap:8px;align-items:center;font-weight:400}
  .check input{width:auto}
</style></head><body>
<header><b>☕ Demo Shop</b><span class="grow"></span><span id="who"></span><span id="cart" data-testid="cart-count"></span></header>
<main>${body}</main>
<script>
  const cart = JSON.parse(sessionStorage.getItem('cart') || '[]');
  const user = sessionStorage.getItem('user');
  document.getElementById('who').textContent = user ? 'Signed in as ' + user : '';
  document.getElementById('cart').textContent = user ? 'Cart: ' + cart.length : '';
</script>
</body></html>`;

const LOGIN = layout(
  'Sign in',
  `<div class="card" style="max-width:380px;margin:auto">
  <h1 style="margin-top:0">Sign in</h1>
  <form id="login-form">
    <label for="email">Email</label><input id="email" name="email" type="email" data-testid="email" autocomplete="username">
    <label for="password">Password</label><input id="password" name="password" type="password" data-testid="password" autocomplete="current-password">
    <p class="error" id="error" role="alert"></p>
    <button type="submit" data-testid="sign-in">Sign in</button>
  </form>
  <p style="color:#83918a;font-size:13px">Any email works. Password: <code>${DEMO_WEB_PASSWORD}</code></p>
</div>
<script>
  document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    if (document.getElementById('password').value !== '${DEMO_WEB_PASSWORD}' || !email) {
      document.getElementById('error').textContent = 'Email or password is incorrect';
      return;
    }
    sessionStorage.setItem('user', email);
    sessionStorage.setItem('cart', '[]');
    setTimeout(() => (location.href = 'shop'), 300);
  });
</script>`,
);

const PRODUCTS = [
  { id: 'coffee', name: 'House Coffee Beans', price: 85000 },
  { id: 'tea', name: 'Jasmine Tea', price: 45000 },
  { id: 'mug', name: 'Ceramic Mug', price: 60000 },
];

const SHOP = layout(
  'Shop',
  `<h1>Products</h1>
<div class="grid">${PRODUCTS.map(
    (
      p,
    ) => `<div class="card"><h3 style="margin-top:0">${p.name}</h3><p class="price">Rp ${p.price.toLocaleString('id-ID')}</p>
    <button data-testid="add-${p.id}" onclick="add('${p.id}')">Add to cart</button></div>`,
  ).join('')}</div>
<p style="margin-top:24px"><button class="ghost" data-testid="checkout" onclick="location.href='checkout'">Go to checkout →</button></p>
<script>
  if (!sessionStorage.getItem('user')) location.href = 'login';
  function add(id) {
    const cart = JSON.parse(sessionStorage.getItem('cart') || '[]');
    cart.push(id);
    sessionStorage.setItem('cart', JSON.stringify(cart));
    document.getElementById('cart').textContent = 'Cart: ' + cart.length;
  }
</script>`,
);

const CHECKOUT = layout(
  'Checkout',
  `<div class="card" style="max-width:520px">
  <h1 style="margin-top:0">Checkout</h1>
  <p id="summary"></p>
  <form id="order-form">
    <label for="name">Full name</label><input id="name" name="name">
    <label for="address">Address</label><input id="address" name="address">
    <label for="shipping">Shipping</label>
    <select id="shipping" name="shipping"><option value="regular">Regular (3–5 days)</option><option value="express">Express (next day)</option></select>
    <label class="check"><input type="checkbox" id="terms"> I agree to the terms</label>
    <p class="error" id="error" role="alert"></p>
    <button type="submit" data-testid="place-order">Place order</button>
  </form>
  <div id="done" hidden><h2 data-testid="confirmation">Order confirmed</h2><p>Your order number is <b id="order-no"></b>.</p></div>
</div>
<script>
  if (!sessionStorage.getItem('user')) location.href = 'login';
  const items = JSON.parse(sessionStorage.getItem('cart') || '[]');
  document.getElementById('summary').textContent = items.length + ' item(s) in your cart';
  document.getElementById('order-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const error = document.getElementById('error');
    if (!items.length) return (error.textContent = 'Your cart is empty');
    if (!document.getElementById('name').value.trim()) return (error.textContent = 'Please enter your name');
    if (!document.getElementById('terms').checked) return (error.textContent = 'Please accept the terms');
    document.getElementById('order-form').hidden = true;
    document.getElementById('done').hidden = false;
    document.getElementById('order-no').textContent = 'ORD-' + Math.floor(10000 + Math.random() * 89999);
    sessionStorage.setItem('cart', '[]');
  });
</script>`,
);

export function demoWeb(): Router {
  const router = Router();
  const page =
    (html: string) => (_req: unknown, res: { type: (t: string) => { send: (b: string) => void } }) =>
      res.type('html').send(html);
  router.get('/', (req, res) => res.redirect(`${req.baseUrl}/login`));
  router.get('/login', page(LOGIN));
  router.get('/shop', page(SHOP));
  router.get('/checkout', page(CHECKOUT));
  return router;
}

/** Contoh UI test siap jalan untuk demo shop (dipakai seed & tombol "Add demo test"). */
export function demoUiTestInput(publicUrl: string) {
  const base = `${publicUrl.replace(/\/+$/, '')}/demo-web`;
  const step = (type: string, description: string, selectors: string[] = [], value = '') => ({
    type,
    description,
    selectors,
    value,
  });
  return {
    name: 'Buy a product (demo shop)',
    description: 'Signs in to the demo shop, adds coffee to the cart and places an order.',
    startUrl: `${base}/login`,
    steps: [
      step('navigate', `Open ${base}/login`, [], `${base}/login`),
      step('fill', 'Type into "Email" field', ['[data-testid="email"]', '#email'], 'qa@example.com'),
      {
        ...step(
          'fill',
          'Type into "Password" field',
          ['[data-testid="password"]', '#password'],
          DEMO_WEB_PASSWORD,
        ),
        sensitive: true,
      },
      step('click', 'Click "Sign in" button', ['[data-testid="sign-in"]', 'role=button[name="Sign in"]']),
      step('assertUrl', 'Check page URL contains "/demo-web/shop"', [], '/demo-web/shop'),
      step('click', 'Click "Add to cart" button', ['[data-testid="add-coffee"]']),
      step('assertText', 'Check "Cart: 1" is shown', ['[data-testid="cart-count"]'], 'Cart: 1'),
      step('click', 'Click "Go to checkout →" button', ['[data-testid="checkout"]']),
      step('fill', 'Type into "Full name" field', ['#name'], '{{random_name}}'),
      step('fill', 'Type into "Address" field', ['#address'], 'Jl. Sudirman 1, Jakarta'),
      step('select', 'Choose "Express (next day)" in "Shipping"', ['#shipping'], 'express'),
      step('check', 'Tick "I agree to the terms"', ['#terms']),
      step('click', 'Click "Place order" button', ['[data-testid="place-order"]']),
      step(
        'assertText',
        'Check "Order confirmed" is shown',
        ['[data-testid="confirmation"]'],
        'Order confirmed',
      ),
    ],
  };
}
