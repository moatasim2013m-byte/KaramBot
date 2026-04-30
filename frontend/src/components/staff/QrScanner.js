import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Camera, CameraOff, Keyboard, Loader2, ScanLine, AlertTriangle } from 'lucide-react';

/**
 * QrScanner — Phase 6 QR-first layout.
 *
 * Camera scanner is ALWAYS the primary section at the top (visible whenever
 * the device actually exposes a camera via getUserMedia, regardless of
 * whether the browser ships the native BarcodeDetector API). Manual
 * booking-code input is ALWAYS rendered below as a clearly-labelled fallback.
 *
 * Decoding:
 *  - If the browser ships `window.BarcodeDetector` (Chrome/Edge on Android &
 *    desktop), we use the fast native path.
 *  - Otherwise we fall back to `jsQR` running on a 2D canvas snapshot of the
 *    <video>. This is what makes iPhone Safari and iPhone Chrome (both
 *    WebKit, neither implements BarcodeDetector) work.
 *
 * "Camera unsupported" is now only shown when `getUserMedia` is truly
 * unavailable or we are not in a secure context — not when BarcodeDetector
 * is missing.
 *
 * Props:
 *   onScan(value)  — called with the scanned/typed string when submitted.
 *   busy           — when true, disables submit while the parent is calling
 *                    the API.
 */
export default function QrScanner({ onScan, busy = false }) {
  const [manualValue, setManualValue] = useState('');
  // 'supported' | 'no-getusermedia' | 'insecure-context'
  const [cameraSupport, setCameraSupport] = useState('supported');
  // Detailed reason for the latest camera error, rendered in Arabic.
  const [cameraError, setCameraError] = useState('');
  const [cameraActive, setCameraActive] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const scanLoopRef = useRef(null);
  const lastScanRef = useRef({ value: '', at: 0 });

  // Determine camera availability once.
  // IMPORTANT: do NOT gate on BarcodeDetector — iOS Safari/Chrome do not
  // ship it but `getUserMedia` works fine there.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasMedia = !!navigator.mediaDevices?.getUserMedia;
    const secure =
      window.isSecureContext ||
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    if (!hasMedia) {
      setCameraSupport('no-getusermedia');
    } else if (!secure) {
      setCameraSupport('insecure-context');
    } else {
      setCameraSupport('supported');
    }
  }, []);

  const stopCamera = () => {
    if (scanLoopRef.current) {
      cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    detectorRef.current = null;
    setCameraActive(false);
  };

  const emitScan = (rawValue) => {
    const value = (rawValue || '').trim();
    if (!value) return;
    const now = Date.now();
    // Debounce duplicate scans within 1.5s.
    if (value !== lastScanRef.current.value || now - lastScanRef.current.at > 1500) {
      lastScanRef.current = { value, at: now };
      onScan?.(value);
    }
  };

  const startCamera = async () => {
    if (cameraSupport !== 'supported') return;
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // iOS Safari requires playsInline + muted (already on the element)
        // and an explicit play() call inside the user gesture handler.
        try {
          await videoRef.current.play();
        } catch (_playErr) {
          // Autoplay can occasionally reject — user can tap the video to retry.
        }
      }
      setCameraActive(true);

      // Prefer native BarcodeDetector when available (fast path).
      const hasNativeDetector = typeof window.BarcodeDetector !== 'undefined';
      if (hasNativeDetector) {
        try {
          const Detector = window.BarcodeDetector;
          detectorRef.current = new Detector({ formats: ['qr_code'] });
        } catch (_ctorErr) {
          // Some browsers advertise the class but throw on construction.
          detectorRef.current = null;
        }
      }

      // Ensure a reusable hidden canvas exists for the jsQR fallback path.
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }

      const tick = async () => {
        const video = videoRef.current;
        if (!video || !streamRef.current) return;

        // Only try to decode once the video has enough data.
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          try {
            if (detectorRef.current) {
              // Native decoder path.
              const codes = await detectorRef.current.detect(video);
              if (codes && codes.length > 0) {
                emitScan(codes[0].rawValue);
              }
            } else {
              // jsQR fallback path — used on iOS Safari / iPhone Chrome and
              // any other browser without BarcodeDetector.
              const canvas = canvasRef.current;
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const result = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert',
              });
              if (result?.data) {
                emitScan(result.data);
              }
            }
          } catch (_err) {
            // Transient decode errors (e.g. tab switch, frame not ready) are
            // expected — just skip this frame.
          }
        }

        scanLoopRef.current = requestAnimationFrame(tick);
      };
      scanLoopRef.current = requestAnimationFrame(tick);
    } catch (err) {
      // Map the browser's MediaStreamError.name to an accurate Arabic reason.
      const name = err?.name || '';
      let reason;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        reason =
          'تم رفض إذن الكاميرا. يرجى السماح بالوصول للكاميرا من إعدادات المتصفح (الإعدادات → Safari/Chrome → الكاميرا) ثم إعادة المحاولة، أو استخدم الإدخال اليدوي بالأسفل.';
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
        reason = 'لم يتم العثور على كاميرا متاحة على هذا الجهاز. استخدم الإدخال اليدوي بالأسفل.';
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        reason = 'الكاميرا مستخدمة من تطبيق آخر. أغلق التطبيقات الأخرى وأعد المحاولة، أو استخدم الإدخال اليدوي بالأسفل.';
      } else if (name === 'TypeError') {
        // getUserMedia can throw TypeError when not in a secure context.
        reason = 'يتطلب تشغيل الكاميرا اتصالاً آمناً (HTTPS). استخدم الإدخال اليدوي بالأسفل.';
      } else {
        reason = 'تعذّر تشغيل الكاميرا. استخدم الإدخال اليدوي بالأسفل.';
      }
      setCameraError(reason);
      setCameraActive(false);
      // Make sure no orphan tracks stay alive.
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    }
  };

  // Cleanup on unmount.
  useEffect(() => {
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    const value = manualValue.trim();
    if (!value) return;
    onScan?.(value);
  };

  const unsupportedCopy =
    cameraSupport === 'insecure-context'
      ? {
          title: 'يتطلب تشغيل الكاميرا اتصالاً آمناً',
          body: 'افتح لوحة الموظفين عبر رابط HTTPS، أو استخدم الإدخال اليدوي الاحتياطي بالأسفل.',
        }
      : {
          title: 'الكاميرا غير مدعومة في هذا المتصفح',
          body: 'يرجى تحديث المتصفح أو استخدم الإدخال اليدوي الاحتياطي بالأسفل.',
        };

  return (
    <div className="space-y-6" data-testid="qr-scanner-root">
      {/* ─────────── PRIMARY: Camera QR scanner ─────────── */}
      <section className="space-y-3" data-testid="qr-scanner-camera-section">
        <div className="flex items-center gap-2">
          <ScanLine className="h-5 w-5 text-primary" />
          <h3 className="font-heading text-base font-bold">ماسح رمز QR بالكاميرا</h3>
        </div>

        {cameraSupport === 'supported' ? (
          <>
            <div className="relative aspect-square w-full max-w-sm mx-auto rounded-2xl overflow-hidden bg-black">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
                autoPlay
                data-testid="scanner-video"
              />
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 gap-2">
                  <CameraOff className="h-10 w-10" />
                  <p className="text-xs">الكاميرا متوقفة</p>
                </div>
              )}
              {cameraActive && (
                // Subtle framing overlay to guide staff where to hold the QR.
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="w-2/3 aspect-square rounded-xl border-2 border-white/70 shadow-[0_0_0_2000px_rgba(0,0,0,0.25)]" />
                </div>
              )}
            </div>

            {cameraError && (
              <div
                className="flex items-start gap-2 text-sm text-destructive bg-red-50 border border-red-200 rounded-lg p-3"
                data-testid="scanner-camera-error"
              >
                <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <span>{cameraError}</span>
              </div>
            )}

            {!cameraActive ? (
              <Button
                type="button"
                onClick={startCamera}
                disabled={busy}
                className="w-full rounded-full h-12"
                data-testid="scanner-start-camera"
              >
                <Camera className="h-4 w-4 ml-2" />
                تشغيل الكاميرا
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={stopCamera}
                className="w-full rounded-full h-12"
                data-testid="scanner-stop-camera"
              >
                <CameraOff className="h-4 w-4 ml-2" />
                إيقاف الكاميرا
              </Button>
            )}

            <p className="text-xs text-muted-foreground text-center">
              وجّه الكاميرا نحو رمز QR الموجود على تذكرة الحجز
            </p>
          </>
        ) : (
          <div
            className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3"
            data-testid="scanner-camera-unsupported"
          >
            <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">{unsupportedCopy.title}</p>
              <p className="text-xs mt-1">{unsupportedCopy.body}</p>
            </div>
          </div>
        )}
      </section>

      {/* ─────────── Divider ─────────── */}
      <div className="relative" aria-hidden="true">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-muted-foreground/20" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">أو</span>
        </div>
      </div>

      {/* ─────────── FALLBACK: Manual booking-code input ─────────── */}
      <section
        className="space-y-3 rounded-2xl border border-dashed border-muted-foreground/25 bg-muted/30 p-4"
        data-testid="qr-scanner-manual-section"
      >
        <div className="flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-heading text-sm font-bold text-muted-foreground">إدخال يدوي احتياطي</h3>
        </div>

        <form onSubmit={handleManualSubmit} className="space-y-3">
          <div>
            <Label htmlFor="scanner-manual-input" className="text-sm">
              أدخل رمز QR أو رمز الحجز
            </Label>
            <Input
              id="scanner-manual-input"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="PK-H-XXXXXXXX أو رمز QR الممسوح"
              className="rounded-xl h-12 mt-2 bg-background"
              autoComplete="off"
              dir="ltr"
              data-testid="scanner-manual-input"
            />
          </div>
          <Button
            type="submit"
            disabled={busy || !manualValue.trim()}
            className="w-full rounded-full h-12"
            variant="outline"
            data-testid="scanner-manual-submit"
          >
            {busy ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : null}
            تحقق من الرمز
          </Button>
        </form>
      </section>
    </div>
  );
}
