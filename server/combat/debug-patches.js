// debug-patches.js
// Pequeno "shim" para instrumentar o combat service com logs e compat alias.
// Coloque um `require('./combat/debug-patches');` no topo do server/index.js
// durante desenvolvimento. NÃO aplicar este código em produção.

try {
  const path = require('path');
  const servicePath = path.resolve(__dirname, 'service.js');
  const service = require(servicePath);

  // 1) alias compatibility: some modules import applyMobHit, others applyHit
  if (!service.applyMobHit && typeof service.applyHit === 'function') {
    service.applyMobHit = service.applyHit;
    console.log('[debug-patches] aliased service.applyMobHit -> applyHit');
  }

  // 2) instrument applyHit / applyMobHit to log calls/results/errors
  const wrapAsync = (fnName) => {
    const orig = service[fnName];
    if (typeof orig !== 'function') return;
    service[fnName] = async function (...args) {
      try {
        console.log(`[combat-debug] ${fnName} called`, { argsLength: args.length, sampleArgs: args.slice(0,3) });
        const res = await orig.apply(this, args);
        try {
          // avoid heavy printing of large objects
          const out = (res && typeof res === 'object') ? Object.keys(res) : String(res);
          console.log(`[combat-debug] ${fnName} result`, { ok: !!res, result: out });
        } catch {
          console.log(`[combat-debug] ${fnName} result (unserializable)`);
        }
        return res;
      } catch (err) {
        console.error(`[combat-debug] ${fnName} ERROR`, err && err.stack ? err.stack : err);
        throw err;
      }
    };
  };

  wrapAsync('applyHit');
  wrapAsync('applyMobHit');

  console.log('[debug-patches] instrumented service.applyHit / service.applyMobHit (if present)');
} catch (e) {
  console.error('[debug-patches] failed to instrument combat service:', e && e.stack ? e.stack : e);
}