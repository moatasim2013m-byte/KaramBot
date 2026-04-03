let pino;
let pinoHttp;
let Logging;
try { pino = require('pino'); } catch {}
try { pinoHttp = require('pino-http'); } catch {}
try { ({ Logging } = require('@google-cloud/logging')); } catch {}

const isProduction = process.env.NODE_ENV === 'production';

const consoleLogger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  fatal: (...args) => console.error(...args)
};

const logger = pino
  ? pino({
      level: process.env.LOG_LEVEL || 'info',
      base: {
        service: 'peekaboo-node-api',
        environment: process.env.NODE_ENV || 'development'
      },
      messageKey: 'message'
    })
  : consoleLogger;

let cloudLogging = null;
let cloudLog = null;
try {
  if (Logging) {
    cloudLogging = new Logging();
    cloudLog = cloudLogging.log('peekaboo-app');
  }
} catch (err) {
  logger.warn({ event: 'cloud_logging_init_failed', error: err?.message }, 'Cloud logging disabled');
}

const pinoHttpMiddleware = pinoHttp
  ? pinoHttp({
      logger,
      customProps: (req) => ({ req_id: req.req_id }),
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url,
            req_id: req.req_id
          };
        }
      }
    })
  : (req, res, next) => next();

const writeCloudError = async (payload) => {
  if (!cloudLog) return;
  try {
    const metadata = {
      resource: { type: 'cloud_run_revision' },
      severity: 'ERROR'
    };
    const entry = cloudLog.entry(metadata, payload);
    await cloudLog.write(entry);
  } catch (err) {
    logger.warn({ event: 'cloud_logging_write_failed', error: err?.message }, 'Failed writing cloud log');
  }
};

const logWhatsAppSendFailure = (context = {}) => {
  const payload = {
    event: context.event || 'whatsapp_send_failure',
    wa_id: context.wa_id,
    mimeType: context.mimeType,
    metaError: context.metaError,
    statusCode: context.statusCode,
    stack: context.stack,
    details: context.details
  };

  logger.error(payload, 'WhatsApp send failed');
  writeCloudError(payload);
};

module.exports = {
  logger,
  pinoHttpMiddleware,
  writeCloudError,
  logWhatsAppSendFailure
};
