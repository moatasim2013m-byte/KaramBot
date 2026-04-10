const User = require('../models/User');

const phoneLookupFormats = (waId) => {
  const digits = String(waId || '').replace(/\D/g, '');
  if (!digits) return [];

  const formats = [digits, `+${digits}`];

  if (digits.startsWith('962')) {
    formats.push(`0${digits.slice(3)}`);
    formats.push(`00${digits}`);
  }

  return [...new Set(formats)];
};

const isWhatsAppOptedOut = async (waId) => {
  if (!waId) return { optedOut: false };

  try {
    const formats = phoneLookupFormats(waId);
    const user = await User.findOne({
      phone: { $in: formats },
      whatsapp_opted_out_at: { $ne: null }
    })
      .select('whatsapp_opted_out_at')
      .lean();

    return { optedOut: Boolean(user) };
  } catch (error) {
    console.error('OPT_OUT_CHECK_ERROR', { waId, error: error.message });
    return { optedOut: true, error: true };
  }
};

const setWhatsAppOptOut = async (waId, optOut = true) => {
  if (!waId) return false;

  try {
    const formats = phoneLookupFormats(waId);
    const result = await User.updateOne(
      { phone: { $in: formats } },
      { $set: { whatsapp_opted_out_at: optOut ? new Date() : null } }
    );

    return result.matchedCount > 0;
  } catch (error) {
    console.error('OPT_OUT_SET_ERROR', { waId, optOut, error: error.message });
    return false;
  }
};

module.exports = {
  isWhatsAppOptedOut,
  setWhatsAppOptOut,
};
