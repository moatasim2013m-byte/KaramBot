import React from 'react';

export default function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 px-4 py-10 sm:px-6 lg:px-8">
      <main className="mx-auto w-full max-w-4xl rounded-xl bg-white p-6 shadow-sm sm:p-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Data Deletion Request</h1>
          <p className="mt-2 text-sm text-slate-600">Effective date: May 2026</p>
        </header>

        <section className="space-y-6 leading-7">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Your right to data deletion</h2>
            <p className="mt-2">
              You have the right to request deletion of any personal data that KaramBot
              holds in connection with your use of the platform or your interactions with
              a business that uses KaramBot.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">What data can be deleted</h2>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Your WhatsApp contact information and conversation history stored by a business using KaramBot.</li>
              <li>Any orders or appointment records associated with your phone number.</li>
              <li>Staff or business owner account data upon account closure.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">How to request deletion</h2>
            <p className="mt-2">
              To request deletion of your data, send an email to{' '}
              <a className="font-medium text-blue-700 underline" href="mailto:osaid@karambots.com">
                osaid@karambots.com
              </a>{' '}
              with the subject line <strong>"Data Deletion Request"</strong> and include:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Your name (if known).</li>
              <li>Your WhatsApp phone number or email address used with the platform.</li>
              <li>The name of the business you interacted with, if applicable.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">What happens next</h2>
            <p className="mt-2">
              We will acknowledge your request within 5 business days and complete the
              deletion within 30 days, except where retention is required by law or
              legitimate operational need. We will notify you once the deletion is complete.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">Facebook / Meta data</h2>
            <p className="mt-2">
              If you connected via Facebook or WhatsApp, you may also manage your data
              directly through Facebook's{' '}
              <a
                className="font-medium text-blue-700 underline"
                href="https://www.facebook.com/help/contact/540977946302970"
                target="_blank"
                rel="noreferrer"
              >
                Off-Facebook Activity tool
              </a>
              {' '}or WhatsApp's in-app settings.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">Contact</h2>
            <p className="mt-2">
              For all data deletion requests, contact us at{' '}
              <a className="font-medium text-blue-700 underline" href="mailto:osaid@karambots.com">
                osaid@karambots.com
              </a>
              .
            </p>
          </div>
        </section>

        <section className="mt-10 border-t border-slate-200 pt-6" dir="rtl">
          <h2 className="text-lg font-semibold text-slate-900">ملخص بالعربية — طلب حذف البيانات</h2>
          <p className="mt-2 leading-7 text-slate-700">
            يحق لك طلب حذف بياناتك الشخصية المحفوظة على منصة KaramBot. لتقديم طلب الحذف،
            راسلنا عبر البريد الإلكتروني{' '}
            <a className="font-medium text-blue-700 underline" href="mailto:osaid@karambots.com">
              osaid@karambots.com
            </a>{' '}
            مع ذكر رقم هاتفك على واتساب أو بريدك الإلكتروني. سنرد خلال 5 أيام عمل وننجز
            الحذف خلال 30 يوماً.
          </p>
        </section>
      </main>
    </div>
  );
}
