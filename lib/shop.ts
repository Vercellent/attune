/**
 * Brewline: a deliberately imperfect single-file storefront used as the
 * default experiment target. Planted friction: shipping cost is hidden until
 * the final step, the cart CTA is weak, "Shipping details" looks like a link
 * but isn't, validation errors are vague, and there is no progress indicator.
 */
export const SHOP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brewline — Coffee gear</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Georgia,'Times New Roman',serif;background:#f6f1ea;color:#2b2420;line-height:1.5}
header{display:flex;justify-content:space-between;align-items:center;padding:18px 32px;border-bottom:1px solid #e3d9cc;background:#fbf8f4}
.logo{font-size:22px;letter-spacing:.04em;cursor:pointer}
nav a{margin-left:22px;color:#2b2420;font-size:14px;text-decoration:none}
.cart-link{cursor:pointer}
main{max-width:1040px;margin:0 auto;padding:40px 32px 80px}
[data-screen]{display:none}
[data-screen].active{display:block}
.hero{display:flex;gap:40px;align-items:center;margin-bottom:56px}
.hero h1{font-size:44px;font-weight:normal;line-height:1.1;margin-bottom:14px}
.hero p{color:#6b5d52;max-width:420px}
.hero img{width:380px;max-width:45%;border-radius:4px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.card{background:#fbf8f4;border:1px solid #e3d9cc;padding:16px;cursor:pointer}
.card img{width:100%;aspect-ratio:1;object-fit:cover;margin-bottom:12px}
.card h3{font-weight:normal;font-size:17px}
.muted{color:#8a7b6f;font-size:14px}
.product{display:flex;gap:48px}
.product img{width:48%;border:1px solid #e3d9cc}
.product h1{font-weight:normal;font-size:34px;margin-bottom:6px}
.price{font-size:22px;margin:12px 0 18px}
ul.spec{margin:18px 0 24px 18px;color:#6b5d52;font-size:15px}
button{font-family:inherit;cursor:pointer}
.btn{background:#2b2420;color:#fbf8f4;border:0;padding:14px 26px;font-size:15px}
.btn-quiet{background:transparent;color:#6b5d52;border:1px solid #cdbfb0;padding:10px 18px;font-size:13px}
table{width:100%;border-collapse:collapse;margin:20px 0}
td{padding:14px 0;border-bottom:1px solid #e3d9cc}
td.r{text-align:right}
.fineprint{font-size:12px;color:#a89888;margin:8px 0 22px}
.fake-link{color:#8a5a3b;text-decoration:underline;font-size:14px}
form{max-width:520px;display:grid;gap:14px;margin-top:18px}
label{font-size:13px;color:#6b5d52;display:grid;gap:4px}
input{font:inherit;padding:10px 12px;border:1px solid #cdbfb0;background:#fff}
.error{color:#a33;font-size:13px;min-height:18px}
.summary{background:#fbf8f4;border:1px solid #e3d9cc;padding:20px;max-width:520px;margin-top:18px}
.row{display:flex;justify-content:space-between;padding:6px 0}
.total{border-top:1px solid #e3d9cc;margin-top:8px;padding-top:12px;font-size:18px}
.done{text-align:center;padding:60px 0}
.done h1{font-weight:normal;font-size:36px;margin-bottom:10px}
@media (max-width:720px){.hero,.product{flex-direction:column}.hero img,.product img{width:100%;max-width:100%}.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <div class="logo" onclick="show('home')">Brewline</div>
  <nav><a href="#" onclick="show('home');return false">Shop</a><a href="#">Journal</a><a href="#" class="cart-link" onclick="show('cart');return false">Cart (<span id="count">0</span>)</a></nav>
</header>
<main>
  <section data-screen="home" class="active">
    <div class="hero">
      <div>
        <h1>Slow mornings,<br>better coffee.</h1>
        <p>Considered brewing equipment for people who care about the ritual as much as the cup.</p>
      </div>
      <img src="/images/brewline-aura.png" alt="Brewline Aura espresso machine">
    </div>
    <div class="grid">
      <div class="card" onclick="show('product')"><img src="/images/brewline-aura.png" alt="Aura espresso machine"><h3>Aura Espresso Machine</h3><p class="muted">From $349</p></div>
      <div class="card"><img src="/images/brewline-grinder.png" alt="Cone burr grinder"><h3>Cone Burr Grinder</h3><p class="muted">Sold out</p></div>
      <div class="card"><img src="/images/brewline-kettle.png" alt="Pour-over kettle"><h3>Pour-over Kettle</h3><p class="muted">Sold out</p></div>
    </div>
  </section>

  <section data-screen="product">
    <div class="product">
      <img src="/images/brewline-aura.png" alt="Aura espresso machine">
      <div>
        <p class="muted">Espresso</p>
        <h1>Aura Espresso Machine</h1>
        <p class="price">$349.00</p>
        <p>A compact single-boiler machine with a 58mm group head and a steam wand that actually textures milk.</p>
        <ul class="spec"><li>15 bar pump, PID temperature control</li><li>Ready in 90 seconds</li><li>Two-year warranty</li></ul>
        <button class="btn-quiet" onclick="addToCart()">Add to bag</button>
      </div>
    </div>
  </section>

  <section data-screen="cart">
    <h2 style="font-weight:normal">Your bag</h2>
    <table><tr><td>Aura Espresso Machine × <span id="qty">0</span></td><td class="r" id="line">$0.00</td></tr></table>
    <p class="fineprint">Taxes and shipping calculated at checkout.</p>
    <span class="fake-link">Shipping details</span>
    <div style="margin-top:28px"><button class="btn-quiet" onclick="goShipping()">Continue</button></div>
  </section>

  <section data-screen="shipping">
    <h2 style="font-weight:normal">Delivery</h2>
    <form id="ship" novalidate onsubmit="submitShipping(event)">
      <label>Full name<input name="name" required></label>
      <label>Email<input name="email" type="email" required></label>
      <label>Street address<input name="address" required></label>
      <label>ZIP code<input name="zip" required pattern="[0-9]{5}"></label>
      <div class="error" id="err"></div>
      <div><button class="btn-quiet" type="submit">Next</button></div>
    </form>
  </section>

  <section data-screen="review">
    <h2 style="font-weight:normal">Review</h2>
    <div class="summary">
      <div class="row"><span>Aura Espresso Machine</span><span>$349.00</span></div>
      <div class="row"><span>Shipping (standard)</span><span>$19.00</span></div>
      <div class="row"><span>Handling</span><span>$6.00</span></div>
      <div class="row total"><span>Total</span><span>$374.00</span></div>
    </div>
    <p class="fineprint">By placing your order you agree to our terms.</p>
    <button class="btn" onclick="placeOrder()">Place order</button>
  </section>

  <section data-screen="confirmation">
    <div class="done"><h1>Thank you.</h1><p class="muted">Your Aura is on its way. A receipt has been sent to your email.</p></div>
  </section>
</main>
<script>
var cart=0;
function show(name){
  document.querySelectorAll('[data-screen]').forEach(function(s){s.classList.toggle('active',s.getAttribute('data-screen')===name)});
  window.scrollTo(0,0);
  window.__lab&&window.__lab.view(name);
}
function addToCart(){cart=1;document.getElementById('count').textContent=cart;document.getElementById('qty').textContent=cart;document.getElementById('line').textContent='$349.00';}
function goShipping(){if(cart<1){show('home');return}show('shipping')}
function submitShipping(e){
  e.preventDefault();
  var f=document.getElementById('ship');
  if(!f.checkValidity()){document.getElementById('err').textContent='Please check your details.';f.querySelectorAll('input').forEach(function(i){i.checkValidity()});return}
  document.getElementById('err').textContent='';
  show('review');
}
function placeOrder(){show('confirmation');window.__lab&&window.__lab.complete();}
show('home');
</script>
</body>
</html>`
