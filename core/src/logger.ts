import pino from 'pino';

import { config } from './config.js';

const options = {
  level: config.app.env === 'test' ? 'silent' : 'info',
  ...(config.app.env === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
};

export const logger = pino(options);
