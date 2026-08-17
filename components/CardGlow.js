'use client';
// Makes the ember hairline on top of every .card follow the pointer.
//
// One delegated pointermove listener for the whole document rather than a
// listener per card, rAF-throttled so we set at most one style per frame.
// The card list is cached and refreshed by a MutationObserver, so cards that
// appear later (route changes, conditional sections) are picked up.
import { useEffect } from 'react';

const PAD = 14;          // px of slack outside the border that still counts as "on it"
const FAST = '90ms';     // following the pointer
const SLOW = '620ms';    // gliding back to centre

export default function CardGlow() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let cards = [];
    const refresh = () => { cards = Array.from(document.querySelectorAll('.card')); };
    refresh();

    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });

    let pending = null;
    const active = new Set();

    function apply(x, y) {
      for (const card of cards) {
        const r = card.getBoundingClientRect();
        if (!r.width) continue;
        const inside =
          x >= r.left - PAD && x <= r.right + PAD &&
          y >= r.top - PAD && y <= r.bottom + PAD;

        if (inside) {
          const pct = ((x - r.left) / r.width) * 100;
          card.style.setProperty('--glow-speed', FAST);
          card.style.setProperty('--glow-x', Math.max(0, Math.min(100, pct)) + '%');
          card.dataset.glow = 'on';
          active.add(card);
        } else if (active.has(card)) {
          // Longer transition first, then drop --glow-x so it eases to 50%.
          card.style.setProperty('--glow-speed', SLOW);
          card.style.removeProperty('--glow-x');
          delete card.dataset.glow;
          active.delete(card);
        }
      }
    }

    function onMove(e) {
      if (pending !== null) return;
      const { clientX, clientY } = e;
      pending = requestAnimationFrame(() => { pending = null; apply(clientX, clientY); });
    }

    function reset() {
      for (const card of active) {
        card.style.setProperty('--glow-speed', SLOW);
        card.style.removeProperty('--glow-x');
        delete card.dataset.glow;
      }
      active.clear();
    }

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', reset);
    window.addEventListener('blur', reset);

    return () => {
      observer.disconnect();
      if (pending !== null) cancelAnimationFrame(pending);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', reset);
      window.removeEventListener('blur', reset);
      reset();
    };
  }, []);

  return null;
}
