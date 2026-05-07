import React from 'react';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 px-4 py-10 sm:px-6 lg:px-8">
      <main className="mx-auto w-full max-w-4xl rounded-xl bg-white p-6 shadow-sm sm:p-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Privacy Policy</h1>
          <p className="mt-2 text-sm text-slate-600">Effective date: May 2026</p>
        </header>

        <section className="space-y-6 leading-7">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Who we are</h2>
            <p className="mt-2">
              KaramBot is a WhatsApp AI operations platform built for local businesses.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">What KaramBot does</h2>
            <p className="mt-2">
              We help businesses operate their WhatsApp communications by automating workflows,
              supporting inbox and conversation management, and enabling teams to handle customer
              interactions more efficiently.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">Information we collect</h2>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Business profile information.</li>
              <li>Staff account information.</li>
              <li>WhatsApp message metadata and message content.</li>
              <li>Customer contact information.</li>
              <li>Service usage logs.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">How we use information</h2>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>To provide WhatsApp automation and connected platform features.</li>
              <li>To manage inboxes, messages, and conversations for your business.</li>
              <li>To improve service quality and platform reliability.</li>
              <li>To maintain security, detect abuse, and provide technical support.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">WhatsApp / Meta data</h2>
            <p className="mt-2">
              WhatsApp-related data is processed only as needed to deliver services for the
              business account connected to KaramBot.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">Data sharing</h2>
            <p className="mt-2">
              We do not sell personal data. We may share data with trusted service providers only
              when required to operate, secure, and support the platform.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">Data retention</h2>
            <p className="mt-2">
              We retain data for as long as needed to provide services and to meet legal,
              operational, and security requirements.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">Security</h2>
            <p className="mt-2">
              We apply reasonable administrative and technical safeguards to protect data,
              including secure handling of tokens and access controls.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">User and business rights</h2>
            <p className="mt-2">
              You may contact us to request access, correction, or deletion of relevant data,
              subject to applicable legal requirements.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">Contact</h2>
            <p className="mt-2">
              For privacy-related requests, contact us at{' '}
              <a className="font-medium text-blue-700 underline" href="mailto:osaid@karambots.com">
                osaid@karambots.com
              </a>
              .
            </p>
          </div>
        </section>

        <section className="mt-10 border-t border-slate-200 pt-6" dir="rtl">
          <h2 className="text-lg font-semibold text-slate-900">ملخص بالعربية</h2>
          <p className="mt-2 leading-7 text-slate-700">
            يستخدم KaramBot البيانات فقط لتشغيل خدمات واتساب للأعمال وإدارة المحادثات المرتبطة
            بالنشاط التجاري، ولا نقوم ببيع البيانات الشخصية.
          </p>
        </section>
      </main>
    </div>
  );
}
