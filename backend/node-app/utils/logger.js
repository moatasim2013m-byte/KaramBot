let pino = null;
let pinoHttp = null;
let Logging = null;
try {
  // Optional runtime deps; if unavailable, fallback logger keeps service running.
  pino = require('pino');
  pinoHttp = require('pino-http');
  ({ Logging } = require('@google-cloud/logging'));
} catch (_) {}

const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const fallbackLog = (severity, payload, message) => {
  const row = JSON.stringify({
    severity: severity.toUpperCase(),
    timestamp: new Date().toISOString(),
    message,
    ...payload
  });
  if (severity === 'error') console.error(row);
  else if (severity === 'warn') console.warn(row);
  else console.log(row);
};

const logger = pino ? pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  base: undefined,
  messageKey: 'message',
  formatters: { level: (label) => ({ severity: label.toUpperCase() }) },
  timestamp: pino.stdTimeFunctions.isoTime
}) : {
  error: (payload, message) => fallbackLog('error', payload, message),
  warn: (payload, message) => fallbackLog('warn', payload, message),
  info: (payload, message) => fallbackLog('info', payload, message)
};

const requestLogger = pinoHttp
  ? pinoHttp({ logger, customProps: (req) => ({ requestId: req.req_id }) })
  : (req, res, next) => next();

let cloudLog = null;
try {
  const logging = Logging ? new Logging() : null;
  if (!logging) throw new Error('google-logging-unavailable');
  cloudLog = logging.log('peekaboo-errors');
} catch (err) {
  logger.warn({ event: 'google_logging_init_failed', details: err.message }, 'Google logging client not available');
}

const reportError = async ({ message, error, context = {} }) => {
  const payload = {
    event: context.event || 'unhandled_error',
    ...context,
    errorMessage: error?.message || String(error || message || 'Unknown error'),
    stack: error?.stack || null
  };

  logger.error(payload, message || 'Unhandled error');

  if (!cloudLog) return;

  try {
    const metadata = {
      resource: {
        type: 'cloud_run_revision',
        labels: {
          service_name: process.env.K_SERVICE || 'unknown',
          revision_name: process.env.K_REVISION || 'unknown',
          location: process.env.K_REGION || process.env.GOOGLE_CLOUD_REGION || 'unknown'
        }
      },
      severity: 'ERROR'
    };
    const entry = cloudLog.entry(metadata, {
      message: message || payload.errorMessage,
      serviceContext: { service: process.env.K_SERVICE || 'peekaboo-api' },
      context: payload
    });
    await cloudLog.write(entry);
  } catch (writeError) {
    logger.warn({ event: 'google_logging_write_failed', details: writeError.message }, 'Failed writing to Google Logging');
  }
};

module.exports = {
  logger,
  requestLogger,
  reportError
};
