const helmet = require('helmet');

// HOTFIX: desabilita CSP para não quebrar scripts inline/módulos do client.
// Mantém outros headers de segurança. Em dev, isso restaura o comportamento original.
// Depois podemos criar uma CSP “permissiva em dev” e mais estrita em produção.
module.exports = helmet({
  contentSecurityPolicy: false,         // <- desabilita CSP
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  xPoweredBy: false,
});