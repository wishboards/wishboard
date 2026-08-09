import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const META_KEYS = new Set(['timestamp', 'level', 'message']);

export const stringifyIfNotEmpty = (meta) => {
  return Object.keys(meta).length ? JSON.stringify(meta) : '';
};

// Custom Transport for WebSockets — no constructor needed, inherits parent
class SocketTransport extends winston.Transport {
  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    // Dynamically import to avoid circular dependency at module load time
    import('./socket.js')
      .then((socketModule) => {
        const metaEntries = Object.entries(info).filter(([k]) => !META_KEYS.has(k));
        const formattedLog = `[${info.timestamp}] ${info.level}: ${info.message} ${stringifyIfNotEmpty(Object.fromEntries(metaEntries))}`;
        socketModule.emitSystemLog(formattedLog);
      })
      .catch((err) => {
        console.error('SOCKET TRANSPORT IMPORT ERROR:', err);
      });

    callback();
  }
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const productionTransports = [];
if (process.env.NODE_ENV !== 'test') {
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.DISABLE_FILE_LOGGING) {
    productionTransports.push(
      new winston.transports.DailyRotateFile({
        filename: path.join(__dirname, '../../data/logs/wishboard-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: false,
        maxSize: '20m',
        maxFiles: '14d',
      })
    );
  }
  productionTransports.push(new SocketTransport());
}

const transports = [
  ...productionTransports,
  new winston.transports.Console({
    silent: process.env.NODE_ENV === 'test',
    format: winston.format.combine(
      ...(process.env.NODE_ENV !== 'production' &&
      !process.env.AWS_LAMBDA_FUNCTION_NAME &&
      process.stdout?.isTTY
        ? [winston.format.colorize()]
        : []),
      winston.format.printf(
        /**
         * @param {Object} info
         * @param {string} info.timestamp
         * @param {string} info.level
         * @param {string} info.message
         */
        (info) => {
          const { timestamp, level, message, ...meta } = info;
          return `[${timestamp}] ${level}: ${message} ${stringifyIfNotEmpty(meta)}`;
        }
      )
    ),
  }),
];

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  transports,
});
globalThis.__wishboardLoggerLoaded = true;

export default logger;
