export const trackSnapchatPageView = async ({ pathname = '', user = null } = {}) => {
  if (typeof window === 'undefined' || typeof window.snaptr !== 'function') {
    return;
  }

  const normalizedCategory = pathname && pathname !== '/' ? pathname.replace(/^\//, '').split('/')[0] : 'home';

  const payload = {
    item_ids: [pathname || '/'],
    item_category: normalizedCategory,
  };

  if (user?.id || user?._id) {
    payload.uuid_c1 = user.id || user._id;
  }

  if (user?.email) {
    payload.user_email = user.email;
    payload.user_hashed_email = await sha256(user.email.toLowerCase().trim());
  }

  if (user?.phone) {
    payload.user_phone_number = user.phone;
    payload.user_hashed_phone_number = await sha256(String(user.phone).replace(/\s+/g, ''));
  }

  window.snaptr('track', 'PAGE_VIEW', payload);
};

const sha256 = async (value) => {
  if (!value || typeof window === 'undefined' || !window.crypto?.subtle) {
    return undefined;
  }

  const encoded = new TextEncoder().encode(value);
  const buffer = await window.crypto.subtle.digest('SHA-256', encoded);
  const bytes = Array.from(new Uint8Array(buffer));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
};
