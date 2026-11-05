// Small touches of life: cards that lean toward the pointer, sections that rise into view,
// a ripple on every button press and numbers that count up. All of it stays off when the
// device asks for reduced motion.
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const faDigits = new Intl.NumberFormat('fa-IR');

/* Rise into view */
const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('in');
    io.unobserve(e.target);
    if (e.target.dataset.count) countUp(e.target);
  }
}, { rootMargin: '0px 0px -8% 0px' }) : null;

function watch(root) {
  for (const el of root.querySelectorAll('.reveal:not(.in), [data-count]:not(.counted)')) {
    if (!io || reduced.matches) {
      el.classList.add('in');
      continue;
    }
    // Siblings arrive one after another rather than all at once.
    const siblings = [...el.parentElement.children].filter((c) => c.classList.contains('reveal'));
    el.style.setProperty('--delay', `${Math.min(siblings.indexOf(el), 6) * 70}ms`);
    io.observe(el);
  }
}

/* Count-up for elements with data-count="123" */
function countUp(el) {
  el.classList.add('counted');
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target) || reduced.matches) return;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 900);
    el.textContent = faDigits.format(Math.round(target * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* Lean toward the pointer */
let tilted = null;
document.addEventListener('pointermove', (e) => {
  if (reduced.matches || !finePointer.matches) return;
  const card = e.target.closest?.('.tilt');
  if (tilted && tilted !== card) {
    tilted.style.removeProperty('--rx');
    tilted.style.removeProperty('--ry');
  }
  tilted = card;
  if (!card) return;
  const r = card.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  card.style.setProperty('--rx', `${(-y * 6).toFixed(2)}deg`);
  card.style.setProperty('--ry', `${(x * 8).toFixed(2)}deg`);
  card.style.setProperty('--mx', `${((x + 0.5) * 100).toFixed(1)}%`);
  card.style.setProperty('--my', `${((y + 0.5) * 100).toFixed(1)}%`);
}, { passive: true });

/* Ripple where a button is pressed */
document.addEventListener('pointerdown', (e) => {
  if (reduced.matches) return;
  const btn = e.target.closest?.('.btn, .chip, .tabbar a, .theme-btn');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const dot = document.createElement('span');
  dot.className = 'ripple';
  const size = Math.max(r.width, r.height) * 1.6;
  dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  btn.append(dot);
  dot.addEventListener('animationend', () => dot.remove());
});

/* Watch each page as it renders */
/* Sideways tab bars: the mouse wheel and a drag move them, and the active tab is kept in view */
const scrollable = (el) => el && el.scrollWidth > el.clientWidth + 2;
document.addEventListener('wheel', (e) => {
  const bar = e.target.closest?.('.segmented.scroll, .chips');
  if (!scrollable(bar) || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  e.preventDefault();
  bar.scrollLeft -= e.deltaY; // right-to-left: wheel down moves toward the later tabs
}, { passive: false });

let drag = null;
document.addEventListener('pointerdown', (e) => {
  const bar = e.target.closest?.('.segmented.scroll, .chips');
  if (e.pointerType !== 'mouse' || !scrollable(bar)) return;
  drag = { bar, x: e.clientX, left: bar.scrollLeft, moved: false };
});
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (Math.abs(dx) > 4) drag.moved = true;
  drag.bar.style.scrollBehavior = 'auto';
  drag.bar.scrollLeft = drag.left - dx;
});
document.addEventListener('pointerup', () => {
  if (drag) drag.bar.style.removeProperty('scroll-behavior');
  // A drag should not also count as a click on the tab under the pointer.
  if (drag?.moved) document.addEventListener('click', (ev) => ev.preventDefault(), { capture: true, once: true });
  drag = null;
});

function revealActiveTabs(root) {
  for (const bar of root.querySelectorAll('.segmented.scroll, .chips')) {
    const active = bar.querySelector('.active');
    if (active && scrollable(bar) && !bar.dataset.revealed) {
      bar.dataset.revealed = '1';
      active.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }
}

let queued = false;
const scan = () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const root = document.getElementById('app') ?? document.body;
    watch(root);
    revealActiveTabs(root);
  });
};
new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
scan();
