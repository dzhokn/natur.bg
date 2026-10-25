import { initConsent } from './consent.mjs';

const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const observe = (nodes, onSee, margin) => {
  if (!('IntersectionObserver' in window)) return nodes.forEach((n) => onSee(n));
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) {
      io.unobserve(e.target);
      onSee(e.target);
    }
  }), { rootMargin: margin });
  nodes.forEach((n) => io.observe(n));
};

function menu() {
  const header = document.querySelector('.site-header');
  const button = header?.querySelector('.menu-btn');
  button?.addEventListener('click', () => {
    const open = header.toggleAttribute('data-open');
    button.setAttribute('aria-expanded', open);
  });
}

function tabs(root) {
  const list = $$('[role=tab]', root);
  const panels = list.map((t) => document.getElementById(t.getAttribute('aria-controls')));
  const select = (i, focus) => {
    list.forEach((t, j) => {
      t.setAttribute('aria-selected', i === j);
      t.tabIndex = i === j ? 0 : -1;
      panels[j].hidden = i !== j;
    });
    if (focus) list[i].focus();
  };
  list.forEach((t, i) => {
    t.addEventListener('click', () => select(i));
    t.addEventListener('keydown', (e) => {
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      select((to + list.length) % list.length, true);
    });
  });
  select(0);
}

// Gated images (see picture() in html.mjs): sources first, then the img, so it picks once.
const unlock = (img) => {
  const pic = img.closest('picture');
  $$('[data-srcset],[data-src]', pic).forEach((n) => {
    if (n.dataset.srcset) n.srcset = n.dataset.srcset;
    if (n.dataset.src) n.src = n.dataset.src;
  });
  pic.classList.remove('lz');
};

menu();
$$('[data-tabs]').forEach(tabs);
observe($$('picture.lz img'), unlock, '300px 0px');
observe($$('.bg, .ov'), (n) => n.classList.add('bg-in'), '200px');
observe($$('.reveal'), (n) => n.classList.add('in'), '0px');
initConsent(document, window);
