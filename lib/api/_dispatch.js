// One serverless function serving several handlers. Vercel's Hobby plan allows 12 functions per deployment, so the small
// handlers live in lib/api/ and vercel.json rewrites their public URLs here with ?fn=<name> (the original query is merged in).
module.exports = function dispatch(handlers, fallback){
  return (req, res) => {
    let fn = req.query && req.query.fn;
    if (!fn){ try { fn = new URL(req.url, 'http://x').searchParams.get('fn'); } catch {} }
    const h = (fn && handlers[fn]) || (fallback ? handlers[fallback] : null);
    if (!h){ res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: false, reason: 'not-found' })); }
    return h(req, res);
  };
};
