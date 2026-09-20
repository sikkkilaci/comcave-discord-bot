import pino, { type LoggerOptions } from 'pino';
import { env, isDevelopment } from '../config/env.js';

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: null,
};

if (isDevelopment) {
  options.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  };
}

export const logger = pino(options);

export function createChildLogger(scope: string): pino.Logger {
  return logger.child({ scope });
}
