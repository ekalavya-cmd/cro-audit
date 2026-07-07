import express from 'express';
import routes from './routes';
import leadRoutes from './routes/lead.routes';
import { errorHandler } from './middlewares/error.middleware';
import { apiLimiter, securityMiddlewares } from './middlewares/security.middleware';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';

const app = express();

app.use(express.json());

app.use(securityMiddlewares);

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api', apiLimiter);

app.use('/api', routes);

// Lead routes
app.use('/api/leads', leadRoutes);

// app.get('/', (req, res) => {
//   res.sendFile(__dirname + '/views/index.html');
// });

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/static/index.html');
});

// Serve static files (they need to be accessible for iframe)
app.use(express.static(__dirname + '/static', { index: false }));

// Protect domain-blogs.json - block direct access from outside
app.use('/domain-blogs.json', (req, res) => {
  const referer = req.headers.referer || '';
  const host = req.get('host') || '';

  // Allow if same origin (iframe on same domain) or direct request from our domain
  if (referer.includes(host) || referer === '') {
    res.sendFile(__dirname + '/static/domain-blogs.json');
  } else {
    res.status(403).send('Forbidden');
  }
});

app.use(errorHandler);

export default app;
