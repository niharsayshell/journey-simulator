/**
 * Demo Shop — a small, dependency-free e-commerce style site bundled with the
 * platform so journeys can be demonstrated and tested without touching any
 * external website. Checkout is a sandbox: no payment is ever processed.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { VERIFICATION_FILE_PATH } from "@js/shared";

export interface DemoSiteOptions {
  port?: number;
  host?: string;
  /** Values served from the verification file, e.g. "journey-simulator-verification=abc". */
  verificationValues?: string[];
  testHeaderName?: string;
}

const PRODUCTS = [
  { id: "aurora-lamp", name: "Aurora Desk Lamp", price: 49, category: "home", blurb: "Warm dimmable light for late-night work." },
  { id: "trail-bottle", name: "Trail Water Bottle", price: 19, category: "outdoor", blurb: "Insulated steel, keeps drinks cold for 24h." },
  { id: "nimbus-headphones", name: "Nimbus Headphones", price: 129, category: "audio", blurb: "Over-ear, noise cancelling, 30h battery." },
  { id: "terra-planter", name: "Terra Planter", price: 24, category: "home", blurb: "Hand-glazed ceramic with drainage tray." },
  { id: "summit-backpack", name: "Summit Backpack", price: 89, category: "outdoor", blurb: "28L, weatherproof, laptop sleeve." },
  { id: "echo-speaker", name: "Echo Mini Speaker", price: 59, category: "audio", blurb: "Pocket-sized with surprisingly deep bass." },
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Demo Shop</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;color:#1f2937;background:#f9fafb}
header{background:#111827;color:#fff;padding:12px 24px;display:flex;gap:24px;align-items:center}
header a{color:#e5e7eb;text-decoration:none}header a:hover{color:#fff}.brand{font-weight:700;font-size:18px;margin-right:auto}
main{max-width:960px;margin:0 auto;padding:24px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px}.btn{display:inline-block;background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:15px;cursor:pointer;text-decoration:none}
.btn.secondary{background:#e5e7eb;color:#111827}label{display:block;margin:12px 0 4px;font-weight:600}input,select{width:100%;padding:9px;border:1px solid #d1d5db;border-radius:6px;font-size:15px}
.notice{background:#fef3c7;border:1px solid #fcd34d;padding:8px 12px;border-radius:8px;margin-bottom:16px}.toast{background:#dcfce7;border:1px solid #86efac;padding:8px 12px;border-radius:8px;margin-top:12px}
.tall{height:1600px;background:linear-gradient(#f9fafb,#e0e7ff);border-radius:10px;margin-top:16px;padding:16px}footer{text-align:center;color:#6b7280;padding:32px}
</style>
<script>
function cart(){try{return JSON.parse(localStorage.getItem('cart')||'[]')}catch(e){return[]}}
function saveCart(c){localStorage.setItem('cart',JSON.stringify(c));var el=document.querySelector('[data-testid=cart-count]');if(el)el.textContent=c.reduce(function(n,i){return n+i.qty},0)}
</script></head><body>
<header><span class="brand">Demo Shop</span><nav aria-label="Main"><a href="/">Home</a> · <a href="/products">Products</a> · <a href="/cart">Cart (<span data-testid="cart-count">0</span>)</a></nav></header>
<main>${body}</main>
<footer id="footer">Demo Shop is a bundled test site for Journey Simulator.</footer>
<script>saveCart(cart());</script></body></html>`;
}

const pages = {
  home: () =>
    layout(
      "Home",
      `<h1>Welcome to Demo Shop</h1><p>Everyday goods for testing everyday journeys.</p>
<a class="btn" href="/products">Shop now</a>
<section class="card" style="margin-top:24px"><h2>Join the newsletter</h2>
<form id="newsletter" onsubmit="event.preventDefault();document.getElementById('nl-ok').hidden=false">
<label for="nl-email">Email address</label><input id="nl-email" type="email" placeholder="you@example.com" required>
<p><button class="btn" type="submit">Subscribe</button></p><p id="nl-ok" role="status" class="toast" hidden>Thanks for subscribing!</p></form></section>
<div class="tall"><h2 id="featured">Featured collections</h2><p>Scroll to explore.</p></div>`,
    ),
  products: (category?: string) => {
    const list = category ? PRODUCTS.filter((p) => p.category === category) : PRODUCTS;
    return layout(
      "Products",
      `<h1>Products</h1>
<label for="category">Category</label>
<select id="category" onchange="location.href=this.value?'/products?category='+this.value:'/products'">
<option value="">All</option>${["home", "outdoor", "audio"].map((c) => `<option value="${c}" ${c === category ? "selected" : ""}>${c[0]!.toUpperCase() + c.slice(1)}</option>`).join("")}
</select>
<div class="grid" style="margin-top:16px">${list
        .map(
          (p) => `<article class="card" data-testid="product-card"><h2>${esc(p.name)}</h2><p>${esc(p.blurb)}</p><p><strong>$${p.price}</strong></p>
<a class="btn secondary" href="/products/${p.id}" aria-label="View ${esc(p.name)}">View details</a></article>`,
        )
        .join("")}</div>`,
    );
  },
  product: (p: (typeof PRODUCTS)[number]) =>
    layout(
      p.name,
      `<p><a href="/products">← Back to products</a></p><article class="card"><h1>${esc(p.name)}</h1><p>${esc(p.blurb)}</p>
<p data-testid="price">$${p.price}</p>
<label for="qty">Quantity</label><select id="qty"><option>1</option><option>2</option><option>3</option></select>
<p><button class="btn" id="add" data-id="${p.id}" data-name="${esc(p.name)}" data-price="${p.price}">Add to cart</button></p>
<script>document.getElementById('add').addEventListener('click',function(){var b=this.dataset;var c=cart();var q=+document.getElementById('qty').value;var i=c.find(function(x){return x.id===b.id});if(i)i.qty+=q;else c.push({id:b.id,name:b.name,price:+b.price,qty:q});saveCart(c);document.getElementById('added').hidden=false})</script>
<p id="added" role="status" class="toast" hidden>Added to cart</p></article>`,
    ),
  cart: () =>
    layout(
      "Cart",
      `<h1>Your cart</h1><div id="items" class="card">Loading…</div><p><a class="btn" href="/checkout" id="checkout">Checkout</a></p>
<script>var c=cart();document.getElementById('items').innerHTML=c.length?c.map(i=>'<div data-testid="cart-item">'+i.name+' × '+i.qty+' — $'+(i.qty*i.price)+'</div>').join('')+'<p><strong data-testid="cart-total">Total: $'+c.reduce((s,i)=>s+i.qty*i.price,0)+'</strong></p>':'<p>Your cart is empty.</p>'</script>`,
    ),
  checkout: () =>
    layout(
      "Checkout",
      `<h1>Checkout</h1><p class="notice" role="note">Sandbox checkout — no payment is processed.</p>
<form class="card" method="post" action="/checkout">
<label for="name">Full name</label><input id="name" name="name" required autocomplete="off">
<label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="off">
<label for="address">Address</label><input id="address" name="address" required autocomplete="off">
<label for="shipping">Shipping method</label><select id="shipping" name="shipping"><option value="standard">Standard (5 days)</option><option value="express">Express (1 day)</option></select>
<p><button class="btn" type="submit">Place order</button></p></form>`,
    ),
  confirmed: (name: string, ref: string, shipping: string) =>
    layout(
      "Order confirmed",
      `<h1>Thank you for your order</h1><p data-testid="confirmation">Order <strong>${esc(ref)}</strong> for ${esc(name)} is confirmed (${esc(shipping)} shipping).</p>
<script>saveCart([])</script><p><a href="/">Continue shopping</a></p>`,
    ),
  owner: (values: string[]) =>
    layout(
      "Site owner",
      `<h1>Site owner tools</h1><p>This page simulates uploading a verification file to your web server.</p>
<form class="card" method="post" action="/owner/verification"><label for="value">Verification value</label>
<input id="value" name="value" placeholder="journey-simulator-verification=…"><p><button class="btn" type="submit">Publish verification file</button></p></form>
<h2>Currently served at <code>${VERIFICATION_FILE_PATH}</code></h2><pre class="card">${values.map(esc).join("\n") || "(empty)"}</pre>`,
    ),
};

async function readBody(req: IncomingMessage, limit = 10_000): Promise<string> {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > limit) throw new Error("Body too large");
  }
  return data;
}

export function createDemoSite(opts: DemoSiteOptions = {}) {
  const verification = new Set(opts.verificationValues ?? []);
  const testHeader = (opts.testHeaderName ?? "x-journey-simulator").toLowerCase();
  const analytics = { pageViews: 0, syntheticPageViews: 0 };
  let orderSeq = 1000;
  let flakyCount = 0;

  const send = (res: ServerResponse, status: number, body: string, type = "text/html; charset=utf-8") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://demo.local");
      const p = url.pathname;
      const isPage = req.method === "GET" && !p.startsWith("/api") && !p.startsWith("/.well-known") && p !== "/whoami";
      if (isPage) {
        // Analytics hook: synthetic traffic is identified by the test header and kept separate.
        if (req.headers[testHeader]) analytics.syntheticPageViews++;
        else analytics.pageViews++;
      }

      if (req.method === "GET" && p === "/") return send(res, 200, pages.home());
      if (req.method === "GET" && p === "/products") {
        const cat = url.searchParams.get("category") ?? undefined;
        return send(res, 200, pages.products(cat && ["home", "outdoor", "audio"].includes(cat) ? cat : undefined));
      }
      const m = p.match(/^\/products\/([a-z-]+)$/);
      if (req.method === "GET" && m) {
        const product = PRODUCTS.find((x) => x.id === m[1]);
        return product ? send(res, 200, pages.product(product)) : send(res, 404, layout("Not found", "<h1>Product not found</h1>"));
      }
      if (req.method === "GET" && p === "/cart") return send(res, 200, pages.cart());
      if (req.method === "GET" && p === "/checkout") return send(res, 200, pages.checkout());
      if (req.method === "POST" && p === "/checkout") {
        const form = new URLSearchParams(await readBody(req));
        const ref = `DS-${++orderSeq}`;
        res.writeHead(303, {
          location: `/order/confirmed?ref=${ref}&name=${encodeURIComponent(form.get("name") ?? "")}&shipping=${encodeURIComponent(form.get("shipping") ?? "standard")}`,
        });
        return res.end();
      }
      if (req.method === "GET" && p === "/order/confirmed") {
        return send(res, 200, pages.confirmed(url.searchParams.get("name") ?? "", url.searchParams.get("ref") ?? "", url.searchParams.get("shipping") ?? ""));
      }
      if (req.method === "GET" && p === "/slow") {
        const ms = Math.min(Number(url.searchParams.get("ms") ?? 2000) || 2000, 15_000);
        await new Promise((r) => setTimeout(r, ms));
        return send(res, 200, layout("Slow page", `<h1>Slow page</h1><p>Loaded after ${ms}ms.</p>`));
      }
      // Fails every second request: lets tests produce mixed pass/fail batches deterministically.
      if (req.method === "GET" && p === "/flaky") {
        flakyCount++;
        return flakyCount % 2 === 0
          ? send(res, 503, layout("Unavailable", "<h1>Temporarily unavailable</h1>"))
          : send(res, 200, layout("Flaky", "<h1>Flaky page loaded</h1>"));
      }
      if (req.method === "GET" && p === "/error") return send(res, 500, layout("Error", "<h1>Internal error</h1>"));
      // Used by security tests: a same-site page that redirects off-site.
      if (req.method === "GET" && p === "/redirect-external") {
        res.writeHead(302, { location: "https://example.com/" });
        return res.end();
      }
      if (req.method === "GET" && p === "/link-external") {
        return send(res, 200, layout("External link", `<h1>External link</h1><a href="https://example.com/">Leave the shop</a>`));
      }
      if (req.method === "GET" && p === "/whoami") {
        return send(
          res,
          200,
          JSON.stringify({ ip: req.socket.remoteAddress?.replace(/^::ffff:/, ""), testHeader: req.headers[testHeader] ?? null }),
          "application/json",
        );
      }
      if (req.method === "GET" && p === "/api/analytics") return send(res, 200, JSON.stringify(analytics), "application/json");
      if (req.method === "GET" && p === VERIFICATION_FILE_PATH) {
        return send(res, verification.size ? 200 : 404, [...verification].join("\n") + "\n", "text/plain; charset=utf-8");
      }
      if (req.method === "GET" && p === "/owner") return send(res, 200, pages.owner([...verification]));
      if (req.method === "POST" && p === "/owner/verification") {
        const raw = await readBody(req);
        const value = (req.headers["content-type"]?.includes("json") ? (JSON.parse(raw) as { value?: string }).value : new URLSearchParams(raw).get("value")) ?? "";
        if (value.trim()) verification.add(value.trim().slice(0, 200));
        if (req.headers["content-type"]?.includes("json")) return send(res, 200, JSON.stringify({ ok: true }), "application/json");
        res.writeHead(303, { location: "/owner" });
        return res.end();
      }
      return send(res, 404, layout("Not found", "<h1>Page not found</h1>"));
    } catch (err) {
      return send(res, 500, `Error: ${(err as Error).message}`, "text/plain");
    }
  });

  return {
    server,
    analytics,
    addVerificationValue: (v: string) => verification.add(v),
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(opts.port ?? 4100, opts.host ?? "127.0.0.1", () => {
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : (opts.port ?? 4100));
        });
      }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

