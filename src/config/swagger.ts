import swaggerJsdoc from 'swagger-jsdoc';
import { ENV } from './env';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Backend API',
      version: '1.0.0',
    },
    servers: [
      {
        url: `http://localhost:${ENV.PORT}/api`,
      },
    ],
  },
  apis: ['./src/routes/**/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
