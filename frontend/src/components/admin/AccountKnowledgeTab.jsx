import { useLayoutEffect, useState } from 'react';
import api from '../../utils/api';
import { Panel } from '../shared/Primitives';
import BusinessKnowledge from '../whatsapp/BusinessKnowledge';
import KnowledgeGaps from '../whatsapp/KnowledgeGaps';
import TryTheBot from '../whatsapp/TryTheBot';
import MenuPage from '../../pages/MenuPage';
import ClinicPage from '../../pages/ClinicPage';

/**
 * «المعرفة» — what this shop's bot knows, edited by SHIFT for the shop (spec, account page).
 *
 * The owner's own editors are reused as they are: the menu (restaurant), services and doctors
 * (clinic), the free-text knowledge every other shop has, and «ما عرف يجاوب». Their routes already
 * accept ?businessId= from a platform_admin (middleware/auth.js attachBusinessId) and refuse a
 * platform_admin without one, so nothing can land on the wrong shop by omission.
 *
 * Those editors call /menu, /clinic and /knowledge without a shop, because for an owner the shop
 * is their session. ShopScope adds this shop's businessId to exactly those calls for as long as
 * the tab is open, and takes it away when it closes. It is installed in a layout effect and the
 * editors render only after it, because their loads run in their own effects, which would
 * otherwise fire first and go out unscoped.
 */

const SCOPED = /^\/?(menu|clinic|knowledge)(\/|\?|$)/;

function ShopScope({ businessId, children }) {
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const id = api.interceptors.request.use((config) => {
      const url = config.url || '';
      const named = /[?&]businessId=/.test(url) || (config.params && 'businessId' in config.params);
      if (SCOPED.test(url) && !named) config.params = { ...(config.params || {}), businessId };
      return config;
    });
    setReady(true);
    return () => { api.interceptors.request.eject(id); };
  }, [businessId]);

  return ready ? children : null;
}

export default function AccountKnowledgeTab({ accountId, businessType }) {
  const isRestaurant = businessType === 'restaurant';
  const isClinic = businessType === 'clinic';

  return (
    <ShopScope businessId={accountId}>
      <div className="space-y-4">
        {/* Restaurants and clinics answer from their menu or service list; the rest from knowledge. */}
        {isRestaurant && (
          <Panel title="القائمة"><div className="p-4"><MenuPage /></div></Panel>
        )}
        {isClinic && (
          <Panel title="الخدمات والأطباء"><div className="p-4"><ClinicPage /></div></Panel>
        )}
        {!isRestaurant && !isClinic && businessType !== 'shift' && <BusinessKnowledge businessId={accountId} />}

        <Panel title="ما عرف يجاوب">
          <div className="p-4"><KnowledgeGaps embedded /></div>
        </Panel>

        {/* The shop's real workflow, nothing sent: the check after an answer is taught. */}
        <TryTheBot endpoint={`/admin/accounts/${accountId}/test-message`} />
      </div>
    </ShopScope>
  );
}
