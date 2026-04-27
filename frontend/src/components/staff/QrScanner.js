import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Camera, CameraOff, Keyboard, Loader2 } from 'lucide-react';

/**
 * QrScanner — Phase 2 minimal scanner.
 *
 * Provides camera-based scanning via the native BarcodeDetector API (Chrome,
 * Edge, Safari iOS 15+) and a manual text-input fallback. Manual input ALWAYS
 * works; camera is best-effort.
 *
 * onScan(value)  — called with the scanned/typed string when the user submits.
 * busy           — when true, disables submit while parent is calling the API.
 */
export default function QrScanner({ onScan, busy = false }) {
  const [mode, setMode] = useState('camera');
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
      setMode('manual');
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
        ? 'تم رفض إذن الكاميرا. يرجى السماح بالوصول للكاميرا أو استخدام الإدخال اليدوي.'
        : 'تعذّر تشغيل الكاميرا. استخدم الإدخال اليدوي.';
      setCameraError(reason);
      setCameraActive(false);
    }
  };

  // Cleanup on unmount and on mode change away from camera.
  useEffect(() => {
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== 'camera') {
      stopCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    const value = manualValue.trim();
    if (!value) return;
    onScan?.(value);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === 'camera' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('camera')}
          disabled={!cameraSupported}
          className="rounded-full gap-2"
          data-testid="scanner-mode-camera"
        >
          <Camera className="h-4 w-4" />
          مسح بالكاميرا
        </Button>
        <Button
          type="button"
          variant={mode === 'manual' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('manual')}
          className="rounded-full gap-2"
          data-testid="scanner-mode-manual"
        >
          <Keyboard className="h-4 w-4" />
          إدخال يدوي
        </Button>
      </div>

      {!cameraSupported && (
        <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-2">
          المتصفح لا يدعم مسح الكاميرا. يمكنك استخدام الإدخال اليدوي.
        </div>
      )}

      {mode === 'camera' && cameraSupported && (
        <div className="space-y-3">
          <div className="relative aspect-square w-full max-w-sm mx-auto rounded-2xl overflow-hidden bg-black">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
              data-testid="scanner-video"
            />
            {!cameraActive && (
              <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
                <CameraOff className="h-8 w-8" />
              </div>
            )}
          </div>
          {cameraError && (
            <div className="text-sm text-destructive bg-red-50 border border-red-200 rounded-lg p-2">
              {cameraError}
            </div>
          )}
          {!cameraActive ? (
            <Button
              type="button"
              onClick={startCamera}
              disabled={busy}
              className="w-full rounded-full"
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
              className="w-full rounded-full"
              data-testid="scanner-stop-camera"
            >
              <CameraOff className="h-4 w-4 ml-2" />
              إيقاف الكاميرا
            </Button>
          )}
          <p className="text-xs text-muted-foreground text-center">
            وجّه الكاميرا نحو رمز QR للحجز
          </p>
        </div>
      )}

      {mode === 'manual' && (
        <form onSubmit={handleManualSubmit} className="space-y-3">
          <div>
            <Label className="text-sm">أدخل رمز QR أو رمز الحجز</Label>
            <Input
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="PK-H-XXXXXXXX أو رمز QR الممسوح"
              className="rounded-xl h-12 mt-2"
              autoComplete="off"
              dir="ltr"
              data-testid="scanner-manual-input"
            />
          </div>
          <Button
            type="submit"
            disabled={busy || !manualValue.trim()}
            className="w-full rounded-full h-12"
            data-testid="scanner-manual-submit"
          >
            {busy ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : null}
            تحقق من الرمز
          </Button>
        </form>
      )}
    </div>
  );
}
