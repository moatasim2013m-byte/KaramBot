import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Camera, CameraOff, Keyboard, Loader2, ScanLine, AlertTriangle } from 'lucide-react';

/**
 * QrScanner — Phase 6 QR-first layout.
 *
 * Camera scanner is ALWAYS the primary section at the top (visible whenever
 * the browser supports BarcodeDetector + getUserMedia). Manual booking-code
 * input is ALWAYS rendered below as a clearly-labelled fallback — staff no
 * longer have to toggle between modes.
 *
 * Native BarcodeDetector API (Chrome, Edge, Safari iOS 15+) drives camera
 * scanning; manual input always works as a safety net.
 *
 * Props:
 *   onScan(value)  — called with the scanned/typed string when submitted.
 *   busy           — when true, disables submit while the parent is calling
 *                    the API.
 */
export default function QrScanner({ onScan, busy = false }) {
  const [manualValue, setManualValue] = useState('');
  const [cameraSupported, setCameraSupported] = useState(true);
  const [cameraError, setCameraError] = useState('');
  const [cameraActive, setCameraActive] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const scanLoopRef = useRef(null);
  const lastScanRef = useRef({ value: '', at: 0 });

  // Determine BarcodeDetector availability once.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasDetector = typeof window.BarcodeDetector !== 'undefined';
    const hasMedia = !!navigator.mediaDevices?.getUserMedia;
    if (!hasDetector || !hasMedia) {
      setCameraSupported(false);
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
    setCameraActive(false);
  };

  const startCamera = async () => {
    if (!cameraSupported) return;
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraActive(true);

      const Detector = window.BarcodeDetector;
      detectorRef.current = new Detector({ formats: ['qr_code'] });

      const tick = async () => {
        if (!videoRef.current || !detectorRef.current || !streamRef.current) return;
        try {
          const codes = await detectorRef.current.detect(videoRef.current);
          if (codes && codes.length > 0) {
            const value = (codes[0].rawValue || '').trim();
            const now = Date.now();
            // Debounce duplicate scans within 1.5s.
            if (value && (value !== lastScanRef.current.value || now - lastScanRef.current.at > 1500)) {
              lastScanRef.current = { value, at: now };
              onScan?.(value);
            }
          }
        } catch (_err) {
          // detect() can throw transient errors (e.g. on tab switch); ignore.
        }
        scanLoopRef.current = requestAnimationFrame(tick);
      };
      scanLoopRef.current = requestAnimationFrame(tick);
    } catch (err) {
      const reason = err?.name === 'NotAllowedError'
        ? 'تم رفض إذن الكاميرا. يرجى السماح بالوصول للكاميرا من إعدادات المتصفح، أو استخدم الإدخال اليدوي الاحتياطي بالأسفل.'
        : 'تعذّر تشغيل الكاميرا. استخدم الإدخال اليدوي الاحتياطي بالأسفل.';
      setCameraError(reason);
      setCameraActive(false);
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

  return (
    <div className="space-y-6" data-testid="qr-scanner-root">
      {/* ─────────── PRIMARY: Camera QR scanner ─────────── */}
      <section className="space-y-3" data-testid="qr-scanner-camera-section">
        <div className="flex items-center gap-2">
          <ScanLine className="h-5 w-5 text-primary" />
          <h3 className="font-heading text-base font-bold">ماسح رمز QR بالكاميرا</h3>
        </div>

        {cameraSupported ? (
          <>
            <div className="relative aspect-square w-full max-w-sm mx-auto rounded-2xl overflow-hidden bg-black">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
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
              <p className="font-semibold">الكاميرا غير مدعومة في هذا المتصفح</p>
              <p className="text-xs mt-1">يرجى تحديث المتصفح أو استخدم الإدخال اليدوي الاحتياطي بالأسفل.</p>
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
