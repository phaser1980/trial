const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:49152',
      changeOrigin: true,
      pathRewrite: {
        '^/api': '/api'  // keep /api prefix
      },
      onProxyReq: (proxyReq, req, res) => {
        // Add proper headers for API requests
        proxyReq.setHeader('Accept', 'application/json');
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          proxyReq.setHeader('Content-Type', 'application/json');
        }
        // Log outgoing request
        console.log(`Proxying ${req.method} ${req.path} to ${proxyReq.path}`);
      },
      onProxyRes: (proxyRes, req, res) => {
        const contentType = proxyRes.headers['content-type'];
        if (!contentType || !contentType.includes('application/json')) {
          console.error(`Invalid response content type: ${contentType}`);
          // Force JSON content type and convert response to error
          proxyRes.headers['content-type'] = 'application/json';
          const originalPipe = proxyRes.pipe;
          proxyRes.pipe = function(res) {
            const error = {
              error: 'Invalid Response',
              message: 'Server returned a non-JSON response',
              path: req.path,
              statusCode: proxyRes.statusCode
            };
            res.end(JSON.stringify(error));
          };
        }
      },
      onError: (err, req, res) => {
        console.error('Proxy error:', err);
        res.writeHead(500, {
          'Content-Type': 'application/json'
        });
        res.end(JSON.stringify({ 
          error: 'Proxy Error',
          message: 'Failed to reach backend server',
          details: err.message
        }));
      },
    })
  );
};
