export function trackSnapViewContent({ price, currency = 'JOD', itemIds = [], itemCategory, uuidC1, userEmail, userPhoneNumber, userHashedEmail, userHashedPhoneNumber }) {
  const snaptrFn = typeof window !== 'undefined' ? window.snaptr : null;
  if (typeof snaptrFn !== 'function') {
    return;
  }

  const payload = {
    price,
    currency,
    item_ids: itemIds,
    item_category: itemCategory,
    uuid_c1: uuidC1,
    user_email: userEmail,
    user_phone_number: userPhoneNumber,
    user_hashed_email: userHashedEmail,
    user_hashed_phone_number: userHashedPhoneNumber,
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || payload[key] === null || payload[key] === '') {
      delete payload[key];
    }
  });

  snaptrFn('track', 'VIEW_CONTENT', payload);
}
