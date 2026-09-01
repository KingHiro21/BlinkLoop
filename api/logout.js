// POST /api/logout -> clears the staff session cookies.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'method' });
  res.setHeader('Set-Cookie', [
    'bl_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    'bl_staff=; Path=/; Max-Age=0; Secure; SameSite=Lax'
  ]);
  return res.status(200).json({ ok:true });
};
