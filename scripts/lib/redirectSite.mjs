/**
 * THE OLD ADDRESS FORWARDS (Phase 38J, J2) — the pieces, pure.
 *
 * The personal Pages host stays alive as a redirect so nobody's link or
 * Home Screen install breaks. Two files, identical, because GitHub Pages
 * serves `404.html` for any path it does not have and keeps the requested
 * path in the address bar — which is how `/checkin` and `/settings` survive.
 *
 * `redirectTarget` is the exact expression the inline script runs; the test
 * calls it in Node and the same string is stamped into the page.
 */

/** Where a request for `loc` on the old host goes: same path, query and hash. */
export function redirectTarget(newOrigin, loc) {
  const origin = String(newOrigin).replace(/\/$/, '');
  return `${origin}${loc.pathname || '/'}${loc.search || ''}${loc.hash || ''}`;
}

/** The inline script, as source. It is what `redirectTarget` says, in the page. */
export function redirectScript(newOrigin) {
  const origin = JSON.stringify(String(newOrigin).replace(/\/$/, ''));
  return (
    `(function(){try{var o=${origin};` +
    'var t=o+(location.pathname||"/")+(location.search||"")+(location.hash||"");' +
    'location.replace(t);}catch(e){}})();'
  );
}

/** One HTML document. `index.html` and `404.html` are this, byte for byte. */
export function redirectHtml(newOrigin) {
  const origin = String(newOrigin).replace(/\/$/, '');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Ranked has moved</title>
<link rel="canonical" href="${esc(origin)}/">
<meta http-equiv="refresh" content="0; url=${esc(origin)}/">
<script>${redirectScript(origin)}</script>
<style>html,body{margin:0;background:#0A0B0D;color:#E8E8EA;font:15px/1.5 -apple-system,system-ui,sans-serif}main{padding:32px 20px;max-width:32rem}a{color:#7FB2FF}</style>
</head>
<body>
<main>
<p>Ranked has moved to <a href="${esc(origin)}/">${esc(origin)}</a>. If this page does not forward you, tap the link.</p>
</main>
</body>
</html>
`;
}
