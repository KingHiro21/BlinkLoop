// /api/login, /api/me, /api/logout, /api/verify, /api/generate  (rewritten here by vercel.json as ?fn=<name>)
const dispatch = require('../lib/api/_dispatch.js');
module.exports = dispatch({ login: require('../lib/api/login.js'), me: require('../lib/api/me.js'), logout: require('../lib/api/logout.js'), verify: require('../lib/api/verify.js'), generate: require('../lib/api/generate.js') });
