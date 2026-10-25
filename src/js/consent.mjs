export const COOKIE = 'natur_consent';
const MAX_AGE = 15552000; // 180 days

export const parseConsent = (cookie = '') => {
  const m = /(?:^|;\s*)natur_consent=(granted|denied)/.exec(cookie);
  return m ? m[1] : null;
};

export const serializeConsent = (value, secure) =>
  `${COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`;

const ready = (win) => win?.zaraz?.consent?.APIReady === true;

// Every Zaraz call is guarded: the bar must keep working when Zaraz is blocked or still loading.
function push(value, win) {
  try {
    const consent = win.zaraz.consent;
    consent.setAll(value === 'granted');
    if (value === 'granted') consent.sendQueuedEvents();
  } catch {
    /* Zaraz unavailable */
  }
}

// A click always applies the choice, now or when the API announces itself.
export function applyChoice(value, win) {
  if (ready(win)) push(value, win);
  else win?.document?.addEventListener('zarazConsentAPIReady', () => push(value, win), { once: true });
}

// On page load a stored choice is only re-applied when Zaraz disagrees with it.
export function reconcile(value, win) {
  if (!value) return;
  const check = () => {
    try {
      const want = value === 'granted';
      if (Object.values(win.zaraz.consent.getAll()).some((v) => v !== want)) push(value, win);
    } catch {
      /* Zaraz unavailable */
    }
  };
  if (ready(win)) check();
  else win?.document?.addEventListener('zarazConsentAPIReady', check, { once: true });
}

export function initConsent(doc, win) {
  const root = doc.documentElement;
  reconcile(parseConsent(doc.cookie), win);
  doc.querySelectorAll('[data-consent]').forEach((button) =>
    button.addEventListener('click', () => {
      const value = button.dataset.consent;
      doc.cookie = serializeConsent(value, win.location.protocol === 'https:');
      root.dataset.consent = value;
      root.classList.remove('consent-open');
      applyChoice(value, win);
    }));
  doc.querySelector('.cookie-settings')?.addEventListener('click', () => {
    root.classList.add('consent-open');
    doc.querySelector('[data-consent]')?.focus();
  });
}
