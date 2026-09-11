// /api/publish, /api/preview (+ /p/:slug/:key), /api/ai, /api/upload  (rewritten here by vercel.json as ?fn=<name>)
const dispatch = require('../lib/api/_dispatch.js');
module.exports = dispatch({ publish: require('../lib/api/publish.js'), preview: require('../lib/api/preview.js'), ai: require('../lib/api/ai.js'), upload: require('../lib/api/upload.js') });
