import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Download } from 'lucide-react';

/**
 * PWA install button for staff.
 *
 * Behaviour:
 *  - Android / Desktop Chrome: captures `beforeinstallprompt`, shows a
 *    "تثبيت التطبيق" button, triggers the real browser prompt on click,
 *    then hides itself once the app is installed.
 *  - iPhone / iPad Safari: shows a small modal with manual "Add to Home
 *    Screen" instructions (Safari does not fire `beforeinstallprompt`).
 *  - Standalone (already installed): renders nothing.
 */
export default function InstallPWAButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [showIosModal, setShowIosModal] = useState(false);

  // Detect standalone / already-installed
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  // Detect iPhone / iPad Safari (no beforeinstallprompt support)
  const isIosSafari = (() => {
    const ua = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|opios|chrome/i.test(ua);
    return isIos && isSafari;
  })();

  useEffect(() => {
    if (isStandalone || isIosSafari) return undefined;

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [isStandalone, isIosSafari]);

  // Already installed or running in standalone — render nothing
  if (isStandalone || installed) return null;

  // iPhone / iPad Safari — show info button that opens the manual modal
  if (isIosSafari) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowIosModal(true)}
          title="تثبيت تطبيق الموظفين"
        >
          <span className="inline-flex items-center gap-1">
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">تثبيت</span>
          </span>
        </Button>

        {showIosModal && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
            onClick={() => setShowIosModal(false)}
          >
            <div
              className="bg-white rounded-t-2xl w-full max-w-sm p-6 pb-8 space-y-4 text-right"
              dir="rtl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-900">تثبيت تطبيق الموظفين</h3>
              <p className="text-sm text-gray-500">لتثبيت التطبيق على جهاز iPhone / iPad:</p>
              <ol className="space-y-2 text-sm text-gray-700">
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#66A9E9] mt-0.5">١</span>
                  افتح هذه الصفحة في <strong>Safari</strong>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#66A9E9] mt-0.5">٢</span>
                  اضغط على زر <strong>المشاركة</strong> <span className="text-lg">⎋</span> في شريط أدوات Safari
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#66A9E9] mt-0.5">٣</span>
                  اختر <strong>إضافة إلى الشاشة الرئيسية</strong>
                </li>
              </ol>
              <Button
                variant="outline"
                className="w-full mt-2"
                onClick={() => setShowIosModal(false)}
              >
                حسناً
              </Button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Android / Desktop Chrome — show install button when prompt is ready
  if (!deferredPrompt) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstalled(true);
    }
    setDeferredPrompt(null);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleInstall}
      title="تثبيت تطبيق الموظفين"
    >
      <span className="inline-flex items-center gap-1">
        <Download className="h-4 w-4" />
        <span className="hidden sm:inline">تثبيت</span>
      </span>
    </Button>
  );
}
