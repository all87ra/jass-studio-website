/* ==========================================================================
   JASS — interaction and motion. No dependencies; runs from file:// as well.
   Native scrolling is kept on purpose: no scroll-jacking, so keyboards,
   screen readers and switch devices behave normally.
   ========================================================================== */
(function () {
  'use strict';
  var html = document.documentElement;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.min(b === undefined ? 1 : b, Math.max(a === undefined ? 0 : a, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var easeIO = function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var store = function (k, v) { try { if (v === undefined) return localStorage.getItem('jass-' + k); localStorage.setItem('jass-' + k, v); } catch (e) { return null; } };
  var motion = function () { return html.dataset.motion !== 'off'; };
  var lang = function () { return html.lang === 'en' ? 'en' : 'ar'; };
  var ui = function () { return window.JASS_UI[lang()]; };
  var isRTL = function () { return html.dir === 'rtl'; };
  var vw = innerWidth, vh = innerHeight;

  /* ---------- Language ---------- */
  var originals = new Map();
  function snapshot() {
    $$('[data-t]').forEach(function (el) { originals.set(el, el.textContent); });
    $$('[data-ta]').forEach(function (el) {
      var m = {};
      el.dataset.ta.split(',').forEach(function (p) { var a = p.split(':')[0]; m[a] = el.getAttribute(a); });
      originals.set(el.dataset.ta + '|', m); el._taOrig = m;
    });
  }
  function applyLang(l, init) {
    html.lang = l; html.dir = l === 'ar' ? 'rtl' : 'ltr';
    var en = window.JASS_EN;
    $$('[data-t]').forEach(function (el) {
      var k = el.dataset.t, t = l === 'en' ? (en[k] !== undefined ? en[k] : originals.get(el)) : originals.get(el);
      if (el.classList.contains('words')) { el.dataset.src = t; splitWords(el); }
      else el.textContent = t;
    });
    $$('[data-ta]').forEach(function (el) {
      el.dataset.ta.split(',').forEach(function (p) {
        var s = p.split(':'), a = s[0], k = s[1];
        el.setAttribute(a, l === 'en' && en[k] !== undefined ? en[k] : el._taOrig[a]);
      });
    });
    noWidows();
    html.classList.remove('pending');
    var u = ui();
    $$('.lang').forEach(function (b) { b.textContent = u.other; b.setAttribute('lang', u.otherLang); b.setAttribute('aria-label', u.switchTo); });
    if (!init || new URLSearchParams(location.search).get('lang')) store('lang', l);
    document.dispatchEvent(new CustomEvent('jass:lang'));
    requestUpdate();
  }
  /* Typography: never leave a single word alone on the last line. */
  function noWidows() {
    $$('main p,main h1,main h2,main h3,main dt,main figcaption span,.closing-copy p').forEach(function (el) {
      if (el.classList.contains('words') || el.closest('.cells')) return;
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), n, last = null;
      while ((n = walker.nextNode())) if (/\S/.test(n.nodeValue)) last = n;
      if (!last) return;
      var s = last.nodeValue.replace(/\s+$/, ''), k = s.lastIndexOf(' ');
      if (k > 0 && s.length - k < 24) last.nodeValue = s.slice(0, k) + ' ' + s.slice(k + 1) + last.nodeValue.slice(s.length);
    });
  }
  function splitWords(el) {
    var txt = el.dataset.src || el.textContent;
    el.dataset.src = txt;
    var acc = (el.getAttribute('data-accent-' + lang()) || '').split(',').filter(Boolean);
    var i = 0;
    /* A line break written in the text is kept as a deliberate break. */
    el.innerHTML = txt.split(/\n/).map(function (line) { return line.split(/\s+/).filter(Boolean).map(function (w) {
      var clean = w.replace(/[.,،؛:]/g, '');
      return '<span class="w' + (acc.indexOf(clean) > -1 ? ' accent' : '') + '"><span class="wi" style="--i:' + i++ + '">' + w.replace(/</g, '&lt;') + '</span></span>';
    }).join(' '); }).filter(Boolean).join('<br>').replace(/ (<span class="w[^"]*"><span class="wi"[^>]*>[^<]*<\/span><\/span>)$/, '&nbsp;$1');
  }

  /* ---------- Scroll engine ---------- */
  var scenes = [], frames = [], dirty = true, lastY = -1;
  function requestUpdate() { dirty = true; }
  function scene(el, fn, mode) { if (el) scenes.push({ el: el, fn: fn, mode: mode || 'pin' }); }
  function frame(fn, el) {
    var o = { fn: fn, el: el, on: !el };
    frames.push(o);
    if (el && 'IntersectionObserver' in window) new IntersectionObserver(function (e) { o.on = e[0].isIntersecting; if (o.on) dirty = true; }, { rootMargin: '10%' }).observe(el);
    else o.on = true;
    return o;
  }
  function updateScenes() {
    scenes.forEach(function (s) {
      var r = s.el.getBoundingClientRect();
      if (r.bottom < -vh * .5 || r.top > vh * 1.5) return;
      var p;
      if (s.mode === 'pin') p = clamp(-r.top / Math.max(1, r.height - vh));
      else if (s.mode === 'enter') p = clamp((vh - r.top) / (vh * .9));
      else if (s.mode === 'line') p = clamp((vh * .68 - r.top) / r.height);
      else if (s.mode === 'through') p = clamp((vh - r.top) / (vh + r.height));
      else p = clamp((vh * .9 - r.top) / (vh * .62));
      s.fn(p, r);
    });
    updateParallax();
    updateMasks();
  }
  var pars = [];
  function updateParallax() {
    if (!motion()) { pars.forEach(function (e) { e.style.removeProperty('--py'); }); return; }
    pars.forEach(function (e) {
      var r = e.parentElement.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) return;
      var f = parseFloat(e.dataset.par) || .1;
      e.style.setProperty('--py', ((r.top + r.height / 2 - vh / 2) * -f).toFixed(1) + 'px');
    });
  }
  function loop(t) {
    if (scrollY !== lastY || dirty) { lastY = scrollY; updateScenes(); updateRail(); dirty = false; }
    /* One failing visual must never freeze the rest of the exhibition. */
    frames.forEach(function (f) { if (!f.on) return; try { f.fn(t); } catch (e) { f.on = false; if (window.console) console.error(e); } });
    requestAnimationFrame(loop);
  }
  addEventListener('resize', function () { vw = innerWidth; vh = innerHeight; dirty = true; document.dispatchEvent(new Event('jass:resize')); }, { passive: true });

  /* ---------- Reveal ---------- */
  /* Masked images start fully clipped, which IntersectionObserver can read as invisible, so they are measured directly. */
  var masks = [];
  function updateMasks() {
    if (!masks.length) return;
    masks = masks.filter(function (m) { if (m.getBoundingClientRect().top < vh * .92) { m.classList.add('in'); return false; } return true; });
  }
  function initReveal() {
    masks = $$('[data-reveal="mask"]');
    var targets = $$('[data-reveal]:not([data-reveal="mask"]),.words:not(.scrub),.cells');
    if (!('IntersectionObserver' in window)) { targets.forEach(function (e) { e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -10% 0px', threshold: .08 });
    targets.forEach(function (e) { io.observe(e); });
  }

  /* ---------- Liquid seams: each room rises into the next as a soft wave ---------- */
  function initSeams() {
    $$('svg.seam').forEach(function (svg, n) {
      svg.innerHTML = '<path fill="currentColor" opacity=".28"/><path fill="currentColor" opacity=".56"/><path fill="currentColor"/><path fill="currentColor"/>';
      var P = $$('path', svg), w = 1, h = 1, spread = [.5, .25, 0];
      function draw(p) {
        var k = easeIO(clamp(p * 1.35)), dome = lerp(1, .26, k), f = '';
        for (var i = 0; i < 3; i++) {
          var edge = h * (.97 - spread[i] * (.35 + .65 * dome)), lift = dome * h * .56;
          var sway = Math.sin(p * 6.9 + n * 1.7 + i * .8) * h * .13;
          var c1 = edge - lift + sway, c2 = edge - lift - sway;
          P[i].setAttribute('d', 'M0 ' + h + 'L0 ' + edge.toFixed(1) + 'C' + (w * .3).toFixed(1) + ' ' + c1.toFixed(1) + ' ' + (w * .7).toFixed(1) + ' ' + c2.toFixed(1) + ' ' + w + ' ' + edge.toFixed(1) + 'L' + w + ' ' + h + 'Z');
          if (i === 2) {
            for (var q = 1; q < 46; q++) {
              var t = q / 46, m = 1 - t;
              var x = 3 * m * m * t * w * .3 + 3 * m * t * t * w * .7 + t * t * t * w;
              var y = m * m * m * edge + 3 * m * m * t * c1 + 3 * m * t * t * c2 + t * t * t * edge;
              var r = (1.2 + 3.6 * (.5 + .5 * Math.sin(t * 34 + p * 15))) * (.45 + dome * .55);
              y -= 12 + 11 * (.5 + .5 * Math.sin(t * 21 - p * 11));
              f += 'M' + (x - r).toFixed(1) + ' ' + y.toFixed(1) + 'a' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 1 0 ' + (2 * r).toFixed(1) + ' 0a' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 1 0 ' + (-2 * r).toFixed(1) + ' 0';
            }
            P[3].setAttribute('d', f);
          }
        }
      }
      function size() { w = svg.clientWidth || 1; h = svg.clientHeight || 1; svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); }
      size(); document.addEventListener('jass:resize', size); draw(.5);
      scene(svg, function (p) { draw(motion() ? p : .62); }, 'through');
    });
  }

  /* ---------- Page transitions: the doors close, then open on the next page ---------- */
  function leaveTo(url) {
    if (!motion()) { location.href = url; return; }
    try { sessionStorage.setItem('jass-nav', '1'); } catch (e) {}
    html.classList.add('leave');
    setTimeout(function () { location.href = url; }, 620);
  }
  function initPageLinks() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
      var h = a.getAttribute('href');
      if (!/\.html(#|\?|$)/.test(h)) return;
      e.preventDefault(); leaveTo(h);
    });
    addEventListener('pageshow', function () { html.classList.remove('leave'); });
    if (html.classList.contains('arrive')) setTimeout(function () { html.classList.remove('arrive'); }, 1300);
  }

  /* ---------- Chrome: comfort panel, menu, rail ---------- */
  function initComfort() {
    var wrap = document.createElement('div');
    wrap.className = 'comfort';
    wrap.innerHTML =
      '<button class="comfort-btn" type="button" aria-expanded="false" aria-controls="comfort-panel">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/><path d="M11 7h10M3 7h2M13 17H3M19 17h2"/></svg><span class="c-t"></span></button>' +
      '<div class="comfort-panel" id="comfort-panel" hidden><h2 class="c-t"></h2>' +
      '<div class="c-row"><span id="c-m"></span><button class="switch" type="button" data-c="motion" aria-labelledby="c-m"></button></div>' +
      '<div class="c-row"><span id="c-c"></span><button class="switch" type="button" data-c="contrast" aria-labelledby="c-c"></button></div>' +
      '<div class="c-row"><span id="c-t"></span><div class="steps" role="group" aria-labelledby="c-t"><button type="button" data-size="0" aria-label="100%">A</button><button type="button" data-size="1" aria-label="112%" style="font-size:1.15em">A</button><button type="button" data-size="2" aria-label="125%" style="font-size:1.3em">A</button></div></div></div>';
    document.body.appendChild(wrap);
    var btn = $('.comfort-btn', wrap), panel = $('.comfort-panel', wrap);
    function paint() {
      var u = ui();
      $$('.c-t', wrap).forEach(function (e) { e.textContent = u.comfort; });
      $('#c-m').textContent = u.cMotion; $('#c-c').textContent = u.cContrast; $('#c-t').textContent = u.cText;
      var m = $('[data-c=motion]', wrap), c = $('[data-c=contrast]', wrap);
      m.setAttribute('aria-pressed', motion()); m.textContent = motion() ? u.on : u.off;
      var hc = html.dataset.contrast === 'high';
      c.setAttribute('aria-pressed', hc); c.textContent = hc ? u.cOn : u.cOff;
      $$('[data-size]', wrap).forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.size === html.dataset.text); });
    }
    btn.addEventListener('click', function () {
      var open = panel.hidden; panel.hidden = !open; btn.setAttribute('aria-expanded', open);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { panel.hidden = true; btn.setAttribute('aria-expanded', false); btn.focus(); } });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target) && !panel.hidden) { panel.hidden = true; btn.setAttribute('aria-expanded', false); } });
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.c === 'motion') { html.dataset.motion = motion() ? 'off' : 'on'; store('motion', html.dataset.motion); document.dispatchEvent(new Event('jass:motion')); }
      if (b.dataset.c === 'contrast') { html.dataset.contrast = html.dataset.contrast === 'high' ? 'normal' : 'high'; store('contrast', html.dataset.contrast); document.dispatchEvent(new Event('jass:motion')); }
      if (b.dataset.size) { html.dataset.text = b.dataset.size; store('text', b.dataset.size); }
      paint(); requestUpdate();
    });
    document.addEventListener('jass:lang', paint);
    paint();
    if (!store('motion') && window.matchMedia) {
      var mq = matchMedia('(prefers-reduced-motion: reduce)');
      if (mq.addEventListener) mq.addEventListener('change', function (e) { html.dataset.motion = e.matches ? 'off' : 'on'; paint(); document.dispatchEvent(new Event('jass:motion')); });
    }
  }
  function initMenu() {
    var b = $('.menu-btn'), n = $('.nav'); if (!b) return;
    b.addEventListener('click', function () { var o = n.classList.toggle('open'); b.setAttribute('aria-expanded', o); });
    n.addEventListener('click', function (e) { if (e.target.closest('a')) { n.classList.remove('open'); b.setAttribute('aria-expanded', false); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && n.classList.contains('open')) { n.classList.remove('open'); b.setAttribute('aria-expanded', false); b.focus(); } });
    $$('.lang').forEach(function (l) { l.addEventListener('click', function () { applyLang(lang() === 'ar' ? 'en' : 'ar'); }); });
  }
  var railLinks = [], stations = [];
  function initRail() {
    stations = $$('[data-station]'); if (!stations.length) return;
    var nav = document.createElement('nav'); nav.className = 'rail';
    nav.setAttribute('data-ta', 'aria-label:s.rail'); nav.setAttribute('aria-label', 'محطات الرحلة');
    nav.innerHTML = stations.map(function (s) {
      return '<a href="#' + s.id + '"><span class="lb" data-t="s.' + s.dataset.station + '">' + s.dataset.stationAr + '</span><span class="pt"></span></a>';
    }).join('');
    document.body.appendChild(nav);
    railLinks = $$('a', nav);
  }
  var railIndex = -1, railFlash;
  function updateRail() {
    if (!stations.length) return;
    var idx = 0;
    stations.forEach(function (s, i) { if (s.getBoundingClientRect().top <= vh * .5) idx = i; });
    if (idx === railIndex) return; railIndex = idx;
    railLinks.forEach(function (a, i) { if (i === idx) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current'); });
    var rail = railLinks[0].parentNode; rail.classList.add('flash'); clearTimeout(railFlash); railFlash = setTimeout(function () { rail.classList.remove('flash'); }, 1800);
  }

  /* ---------- Shared canvas sizing ---------- */
  function fit(c, maxDpr) {
    var r = c.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, maxDpr || 2);
    c.width = Math.max(1, Math.round(r.width * d)); c.height = Math.max(1, Math.round(r.height * d));
    var ctx = c.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
    return { w: r.width, h: r.height, ctx: ctx };
  }
  var pointer = { x: -999, y: -999 };
  addEventListener('pointermove', function (e) { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });

  /* ---------- 3D tactile field: thousands of lit pearls, the logo raised among them ---------- */
  function initField(c, st) {
    var gl = c.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) { c.parentNode.classList.add('no-gl'); return st; }
    var VS = [
      'attribute vec4 a;uniform float u_t,u_rise,u_tilt,u_D,u_F,u_asp,u_res,u_act;uniform vec2 u_ptr;',
      'varying float v_h,v_g,v_f,v_b;',
      'void main(){vec2 p=a.xy;',
      'float w=sin(p.x*2.4+u_t*.5)*cos(p.y*1.9-u_t*.36)*.07+sin(p.x*5.1-p.y*3.7+u_t*.8)*.018;',
      'float d=distance(p,u_ptr),g=exp(-d*d*9.)*u_act,rip=sin(d*16.-u_t*4.)*exp(-d*2.6)*.03*u_act;',
      'float h=a.z*.2*u_rise+w+g*.2+rip,c=cos(u_tilt),s=sin(u_tilt);',
      'float y=p.y*c+h*s,depth=u_D+p.y*s-h*c;',
      'gl_Position=vec4(p.x*u_F/depth/u_asp,y*u_F/depth,0.,1.);',
      'gl_PointSize=a.w*.94*(1.+a.z*u_rise*.16+g*.55)*u_F/depth*u_res*.5;',
      'v_h=a.z*u_rise;v_g=g;v_b=smoothstep(.04,.1,w)*.55;v_f=clamp(1.5-(depth-u_D)*.34,0.,1.);}'
    ].join('');
    var FS = [
      'precision mediump float;uniform float u_dim;varying float v_h,v_g,v_f,v_b;',
      'void main(){vec2 q=gl_PointCoord*2.-1.;q.y=-q.y;float r=dot(q,q);if(r>1.)discard;',
      'vec3 n=vec3(q,sqrt(1.-r)),L=normalize(vec3(-.45,.62,.64));',
      'float dif=max(dot(n,L),0.),sp=pow(max(dot(reflect(-L,n),vec3(0.,0.,1.)),0.),26.);',
      'vec3 b=mix(vec3(.14,.125,.115),vec3(.953,.933,.894),smoothstep(.15,.7,v_h));',
      'b=mix(b,vec3(.03,.34,1.),v_b*(1.-v_h));b=mix(b,vec3(.937,1.,.314),v_g*.9);',
      'vec3 col=b*(.16+.98*dif)+vec3(1.)*sp*(.2+v_h*.42);',
      'gl_FragColor=vec4(col*v_f*(1.-u_dim),smoothstep(1.,.82,r));}'
    ].join('');
    function sh(type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; }
    var pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { c.parentNode.classList.add('no-gl'); return st; }
    gl.useProgram(pr);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.clearColor(.02, .016, .012, 1);
    var U = {}; ['u_t', 'u_rise', 'u_tilt', 'u_D', 'u_F', 'u_asp', 'u_res', 'u_act', 'u_ptr', 'u_dim'].forEach(function (n) { U[n] = gl.getUniformLocation(pr, n); });
    var buf = gl.createBuffer(), count = 0, F = 1.6, asp = 1, logoD = null, LW = 1, LH = 1, drawn = false;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); var A = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(A); gl.vertexAttribPointer(A, 4, gl.FLOAT, false, 0, 0);
    function build() {
      var r = c.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 1.5);
      c.width = Math.max(1, Math.round(r.width * d)); c.height = Math.max(1, Math.round(r.height * d));
      gl.viewport(0, 0, c.width, c.height); asp = r.width / Math.max(1, r.height);
      var S = asp < 1 ? .03 : .024, L = Math.min(1.45, asp * 2.6 / F * .84), H = L * LH / LW, pts = [], row = 0;
      for (var y = 5; y > -2.15;) {
        var f = 1 + Math.max(0, y) * .4, s = S * f, half = asp * (2.7 + Math.max(0, y) * .7) / F + .3;
        for (var x = -half + (row % 2 ? s / 2 : 0); x <= half; x += s) {
          var hv = 0;
          if (logoD && Math.abs(x) < L && Math.abs(y) < H) {
            var px = Math.floor((x / L + 1) / 2 * (LW - 1)), py = Math.floor((1 - (y / H + 1) / 2) * (LH - 1));
            hv = logoD[(py * LW + px) * 4 + 3] / 255;
          }
          pts.push(x, y, hv, s);
        }
        y -= s * .88; row++;
      }
      count = pts.length / 4;
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
      drawn = false;
    }
    if (st.logo !== false) {
      var im = new Image();
      im.onload = function () {
        var o = document.createElement('canvas'); LW = 450; LH = Math.round(450 * im.naturalHeight / im.naturalWidth); o.width = LW; o.height = LH;
        var x = o.getContext('2d'); x.drawImage(im, 0, 0, LW, LH); logoD = x.getImageData(0, 0, LW, LH).data; build();
      };
      im.src = window.JASS_ART.logo;
    }
    build(); document.addEventListener('jass:resize', build);
    document.addEventListener('jass:motion', function () { drawn = false; });
    var px = 0, py = 0, act = 0;
    frame(function (t) {
      var on = motion(); if (!on && drawn) return; drawn = true;
      var T = on ? t * .001 : 4, D = st.D, cs = Math.cos(st.tilt), sn = Math.sin(st.tilt);
      var rect = c.getBoundingClientRect(), nx = (pointer.x - rect.left) / rect.width * 2 - 1, ny = 1 - (pointer.y - rect.top) / rect.height * 2;
      var inside = pointer.x > -900 && Math.abs(nx) <= 1 && Math.abs(ny) <= 1 && on, tx, ty;
      if (inside) { ty = ny * D / (cs * F - ny * sn); tx = nx * asp * (D + ty * sn) / F; }
      else { tx = Math.sin(T * .35) * 1.2; ty = Math.cos(T * .27) * .6; }
      px = lerp(px, tx, .14); py = lerp(py, ty, .14); act = lerp(act, on ? (inside ? 1 : .55) : 0, .06);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(U.u_t, T); gl.uniform1f(U.u_rise, st.rise); gl.uniform1f(U.u_tilt, st.tilt); gl.uniform1f(U.u_D, D); gl.uniform1f(U.u_F, F);
      gl.uniform1f(U.u_asp, asp); gl.uniform1f(U.u_res, c.height); gl.uniform1f(U.u_act, act); gl.uniform2f(U.u_ptr, px, py); gl.uniform1f(U.u_dim, st.dim || 0);
      gl.drawArrays(gl.POINTS, 0, count);
    }, c);
    return st;
  }

  /* ---------- 01 SEE: doors open onto the field, then the studio rises over it ---------- */
  /* English tagline: both lines span exactly the Arabic headline's width.
     The font size grows to fill most of the width with a calm, even tracking (~.2em),
     then a small per-line adjustment closes the remaining gap. */
  function fitHeroTag() {
    var tag = $('.hero-tag'), h = $('.hero h1');
    if (!tag || !h || !tag.offsetParent) return;
    var W = 0, lines = Array.prototype.slice.call(tag.children);
    Array.prototype.forEach.call(h.children, function (s) { W = Math.max(W, s.offsetWidth); });
    var TR = .2;
    tag.style.fontSize = '';
    var f0 = parseFloat(getComputedStyle(tag).fontSize), need = 0;
    lines.forEach(function (s) {
      s.style.letterSpacing = TR + 'em'; s.style.marginRight = '0';
      var n = s.textContent.length;
      need = Math.max(need, (s.offsetWidth - TR * f0) / W);   /* visible width without trailing gap */
      s._n = n;
    });
    var f = Math.min(f0 / need * .82, f0 * 1.6, 24);
    tag.style.fontSize = f + 'px';
    lines.forEach(function (s) {
      s.style.letterSpacing = '0'; s.style.marginRight = '0';
      var n = s.textContent.length, w0 = s.offsetWidth;
      var ls = n > 1 ? Math.max(0, (W - w0) / (n - 1)) : 0;
      s.style.letterSpacing = ls + 'px'; s.style.marginRight = -ls + 'px';
    });
  }
  function initHeroTag() {
    fitHeroTag();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitHeroTag);
    addEventListener('resize', fitHeroTag);
    addEventListener('load', fitHeroTag);
    document.addEventListener('jass:lang', fitHeroTag);
  }

  function initHero() {
    initHeroTag();
    var hero = $('.hero'); if (!hero) return;
    var spacer = $('.hero-spacer', hero), open = 0;
    var st = initField($('.field', hero), { rise: motion() ? 0 : 1, tilt: .3, D: 2.6 });
    scene(hero, function (p, r) {
      var s = hero.style;
      if (!motion()) { st.rise = 1; st.tilt = .4; st.D = 2.6; s.setProperty('--dim', .35); return; }
      var sp = Math.max(1, spacer.offsetHeight), q = clamp(-r.top / sp), ex = clamp((-r.top - sp) / vh);
      open = easeIO(clamp(q / .6));
      st.rise = easeIO(clamp((q - .12) / .55));
      st.tilt = lerp(.3, .7, easeIO(clamp((q - .45) / .55)));
      st.D = lerp(2.6, 2.15, easeIO(ex));
      s.setProperty('--open', open.toFixed(4));
      s.setProperty('--copy', clamp(q / .3).toFixed(3));
      s.setProperty('--dim', ex.toFixed(3));
    });
    var c = $('.hero-dots'), g, dots = [];
    function size() {
      g = fit(c, 1.5); dots = [];
      var gap = vw < 700 ? 20 : 26;
      for (var y = gap / 2; y < g.h; y += gap) for (var x = gap / 2; x < g.w; x += gap) dots.push(x, y);
    }
    size(); document.addEventListener('jass:resize', size);
    frame(function (t) {
      if (!motion() || open >= .995) { if (g) g.ctx.clearRect(0, 0, g.w, g.h); return; }
      var ctx = g.ctx, w = g.w, h = g.h, cx = w / 2;
      ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#f3eee4';
      var breath = .75 + Math.sin(t / 1400) * .25, rect = c.getBoundingClientRect();
      for (var i = 0; i < dots.length; i += 2) {
        var x = dots[i], y = dots[i + 1], sgn = x < cx ? -1 : 1;
        var dx = Math.abs(x - cx) / cx, slit = Math.exp(-dx * dx * 34) * breath;
        var px = x - pointer.x + rect.left, py = y - pointer.y + rect.top, pg = Math.exp(-(px * px + py * py) / 26000);
        ctx.globalAlpha = Math.min(1, .1 + slit * .6 + pg * .75);
        var r = .9 + slit * 1.5 + pg * 3.6;
        ctx.beginPath(); ctx.arc(x + sgn * open * w * .52, y, r, 0, 6.3); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }, c);
  }

  /* ---------- Painted flow: brush strokes that travel along a vector field ---------- */
  function makeFlow(c, o) {
    var g, moving = [], bases = [], seed = o.seed || 5, sw = 1, lastW = -1, lastH = -1;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    function trace(p, x, y, n, step, W, H) {
      p.moveTo(x, y);
      for (var i = 0; i < n; i++) { var f = o.field(x / W, y / H); x += f[0] * step; y += f[1] * step; p.lineTo(x, y); }
    }
    function paint(map, dots) {
      var b = document.createElement('canvas'); b.width = c.width; b.height = c.height;
      var x = b.getContext('2d'), W = g.w, H = g.h, k = c.width / W, i, groups = [];
      x.scale(k, k); x.fillStyle = dots ? '#050403' : map[0]; x.fillRect(0, 0, W, H);
      if (dots) {
        var cell = W / 72; x.fillStyle = '#f3eee4'; x.beginPath();
        for (var yy = cell / 2, row = 0; yy < H; yy += cell * .9, row++) for (var xx = cell / 2 + (row % 2 ? cell / 2 : 0); xx < W; xx += cell) {
          var rad = cell * .5 * o.lum[o.color(xx / W, yy / H, .5)];
          x.moveTo(xx + rad, yy); x.arc(xx, yy, rad, 0, 6.3);
        }
        x.fill(); return b;
      }
      for (i = 0; i < map.length; i++) groups.push(new Path2D());
      var n = Math.min(13000, W * H / 20), step = W / 90;
      for (i = 0; i < n; i++) { var u = rnd(), v = rnd(); trace(groups[o.color(u, v, rnd())], u * W, v * H, 5, step, W, H); }
      x.lineCap = 'round'; x.lineWidth = sw;
      groups.forEach(function (p, q) { x.strokeStyle = map[q]; x.stroke(p); });
      return b;
    }
    function spawn(s) { s.u = rnd(); s.v = rnd(); s.a = 0; s.sp = .5 + rnd() * .9; s.k = rnd(); }
    function size() {
      var r = c.getBoundingClientRect();
      if (Math.abs(r.width - lastW) < 2 && Math.abs(r.height - lastH) < 2 && bases.length) return;
      lastW = r.width; lastH = r.height;
      g = fit(c, 1.5); sw = Math.max(1.7, g.w / 175); bases = o.palettes.map(function (m) { return paint(m); });
      if (o.lum) bases.push(paint(o.palettes[0], true));
      moving = []; var n = Math.min(1700, g.w * g.h / 170);
      for (var i = 0; i < n; i++) { var s = {}; spawn(s); s.a = rnd(); moving.push(s); }
    }
    size(); document.addEventListener('jass:resize', size);
    return function draw(dt, st) {
      var ctx = g.ctx, W = g.w, H = g.h, z = st.z || 1, C = st.c || 0, Dt = st.d || 0, map = o.palettes[C > .5 && o.palettes[1] ? 1 : 0], ps = [], i;
      ctx.save();
      if (z > 1.001) { ctx.translate(W * o.ax, H * o.ay); ctx.scale(z, z); ctx.translate(-W * o.ax, -H * o.ay); }
      ctx.drawImage(bases[0], 0, 0, W, H);
      if (C > .01 && bases[1]) { ctx.globalAlpha = C; ctx.drawImage(bases[1], 0, 0, W, H); ctx.globalAlpha = 1; }
      if (Dt > .01 && o.lum) { ctx.globalAlpha = Dt; ctx.drawImage(bases[2], 0, 0, W, H); ctx.globalAlpha = 1; }
      if (Dt < .98) {
        for (i = 0; i < map.length; i++) ps.push(new Path2D());
        moving.forEach(function (s) {
          s.a += dt * .00045 * s.sp;
          if (s.a >= 1) spawn(s);
          var f = o.field(s.u, s.v); s.u += f[0] * dt * .000045 * s.sp; s.v += f[1] * dt * .000045 * s.sp;
          if (s.u < 0 || s.u > 1 || s.v < 0 || s.v > 1) { spawn(s); return; }
          trace(ps[o.color(s.u, s.v, s.k)], s.u * W, s.v * H, 6, W / 62 * Math.sin(s.a * 3.14) * (1 - Dt), W, H);
        });
        ctx.lineCap = 'round'; ctx.lineWidth = sw * 1.05;
        ps.forEach(function (p, q) { ctx.strokeStyle = map[q]; ctx.stroke(p); });
      }
      ctx.restore();
    };
  }

  /* ---------- 03 TOUCH: a relief uncovered by the hand ---------- */
  function initRelief() {
    var box = $('.relief'); if (!box) return;
    var c = $('canvas', box), finger = $('.finger', box), live = $('#relief-live');
    var COLS = 88, ROWS = 76, H = new Float32Array(COLS * ROWS), T = new Float32Array(COLS * ROWS);
    var g, form = 0, needs = true, active = false, tx = .5, ty = .5, fx = .5, fy = .5, ready = false;
    var HOT = [
      { id: 'moon', x: .775, y: .3, r: .12 },
      { id: 'wind', x: .26, y: .24, r: .14 },
      { id: 'dunes', x: .5, y: .82, r: .16 }
    ];
    var img = new Image();
    img.onload = function () {
      var o = document.createElement('canvas'); o.width = COLS; o.height = ROWS;
      var x = o.getContext('2d'); x.drawImage(img, 0, 0, COLS, ROWS);
      var d = x.getImageData(0, 0, COLS, ROWS).data, min = 1, max = 0, i;
      for (i = 0; i < H.length; i++) { var v = (d[i * 4] * .3 + d[i * 4 + 1] * .59 + d[i * 4 + 2] * .11) / 255; H[i] = v; min = Math.min(min, v); max = Math.max(max, v); }
      /* clamp first: H is single precision, min/max are doubles, so a pixel can land a hair below 0 */
      for (i = 0; i < H.length; i++) H[i] = Math.pow(clamp((H[i] - min) / (max - min)), 1.35);
      ready = true; needs = true;
    };
    img.src = window.JASS_ART.relief;
    function size() { g = fit(c, 1.5); needs = true; }
    size(); document.addEventListener('jass:resize', size);
    scene(box, function (p) { var f = motion() ? easeIO(clamp(p * 1.15)) : 1; if (Math.abs(f - form) > .002) { form = f; needs = true; } }, 'enter');
    function touchAt(nx, ny) {
      var R = 7, cx = nx * COLS, cy = ny * ROWS;
      for (var y = Math.max(0, Math.floor(cy - R)); y < Math.min(ROWS, cy + R); y++) for (var x = Math.max(0, Math.floor(cx - R)); x < Math.min(COLS, cx + R); x++) {
        var d = Math.hypot(x - cx, y - cy); if (d < R) { var i = y * COLS + x; T[i] = Math.min(1, T[i] + (1 - d / R) * .3); }
      }
      HOT.forEach(function (h) {
        if (h.done || Math.hypot(nx - h.x, (ny - h.y) * ROWS / COLS) > h.r) return;
        h.done = true;
        var u = ui(), all = HOT.every(function (k) { return k.done; });
        live.textContent = u.foundText[h.id] + (all ? ' ' + u.foundAll : '');
        if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) navigator.vibrate(25);
      });
    }
    function move(nx, ny) { tx = clamp(nx); ty = clamp(ny); active = true; box.classList.add('active'); if (!motion()) { fx = tx; fy = ty; } touchAt(tx, ty); needs = true; }
    c.addEventListener('pointermove', function (e) { var r = box.getBoundingClientRect(); move((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); });
    c.addEventListener('pointerdown', function (e) { var r = box.getBoundingClientRect(); move((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); });
    c.addEventListener('pointerleave', function () { active = false; box.classList.remove('active'); needs = true; });
    box.addEventListener('focus', function () { if (box.matches(':focus-visible')) move(tx, ty); });
    box.addEventListener('blur', function () { active = false; box.classList.remove('active'); needs = true; });
    box.addEventListener('keydown', function (e) {
      var s = .045, map = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }, m = map[e.key];
      if (!m) return; e.preventDefault(); move(tx + m[0], ty + m[1]);
    });
    $('.reveal-all').addEventListener('click', function () {
      for (var i = 0; i < T.length; i++) T[i] = 1;
      HOT.forEach(function (h) { h.done = true; });
      live.textContent = ui().foundAll; needs = true;
    });
    var BUCKETS = 14;
    frame(function () {
      var moved = Math.abs(tx - fx) + Math.abs(ty - fy) > .0008;
      if (motion() && moved) { fx = lerp(fx, tx, .24); fy = lerp(fy, ty, .24); needs = true; }
      if (!needs || !ready) return; needs = false;
      var ctx = g.ctx, w = g.w, h = g.h, cw = w / COLS, ch = h / ROWS, fpx = fx * COLS, fpy = fy * ROWS;
      finger.style.transform = 'translate(' + fx * w + 'px,' + fy * h + 'px)';
      ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#f3eee4';
      var paths = []; for (var b = 0; b <= BUCKETS; b++) paths.push(new Path2D());
      for (var y = 0; y < ROWS; y++) for (var x = 0; x < COLS; x++) {
        var i = y * COLS + x, hv = H[i], d = Math.hypot(x - fpx, y - fpy), lift = active ? Math.pow(clamp(1 - d / 9), 2) : 0;
        var alpha = (.09 + .91 * Math.max(T[i], lift)) * (.3 + .7 * hv) * lerp(.2, 1, form);
        var rad = Math.max(.35, Math.min(cw, ch) * .5 * (.2 + .8 * hv * form) * (1 + lift * .5));
        var nx = (x + .5) * cw + (active && d > .01 ? (x - fpx) / d * lift * cw * 1.1 : 0), ny = (y + .5) * ch + (active && d > .01 ? (y - fpy) / d * lift * ch * 1.1 : 0);
        var k = Math.round(clamp(alpha) * BUCKETS), pa = paths[k];
        pa.moveTo(nx + rad, ny); pa.arc(nx, ny, rad, 0, 6.3);
      }
      for (var q = 1; q <= BUCKETS; q++) { ctx.globalAlpha = q / BUCKETS; ctx.fill(paths[q]); }
      ctx.globalAlpha = 1;
    }, box);
    document.addEventListener('jass:lang', function () { live.textContent = ''; });
  }

  /* ---------- 04 LISTEN: a generated soundscape in four layers ---------- */
  function initListen() {
    var room = $('.listen'); if (!room) return;
    var c = $('.wave', room), btns = $$('.layer', room), now = $('.listen-now', room), g, amp = 0;
    var ac, master, an, data, layers = {}, noise;
    function ensure() {
      if (ac) return; var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ac = new AC(); master = ac.createGain(); master.gain.value = .85;
      an = ac.createAnalyser(); an.fftSize = 2048; data = new Uint8Array(an.fftSize);
      master.connect(an); an.connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate);
      var d = noise.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    function noiseSrc() { var s = ac.createBufferSource(); s.buffer = noise; s.loop = true; return s; }
    var make = {
      wind: function (out) {
        var s = noiseSrc(), f = ac.createBiquadFilter(), l = ac.createOscillator(), lg = ac.createGain();
        f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = .8; l.frequency.value = .13; lg.gain.value = 300;
        l.connect(lg); lg.connect(f.frequency); s.connect(f); f.connect(out); s.start(); l.start(); out.gain.value = 0;
        return { level: .34, nodes: [s, l] };
      },
      water: function (out) {
        var s = noiseSrc(), f = ac.createBiquadFilter(), tg = ac.createGain(), l = ac.createOscillator(), lg = ac.createGain();
        f.type = 'lowpass'; f.frequency.value = 760; l.frequency.value = .27; lg.gain.value = .42; tg.gain.value = .55;
        l.connect(lg); lg.connect(tg.gain); s.connect(f); f.connect(tg); tg.connect(out); s.start(); l.start();
        return { level: .3, nodes: [s, l] };
      },
      light: function (out) {
        var ns = [];
        [440, 659.25, 987.77, 1318.5].forEach(function (fq, i) {
          var o = ac.createOscillator(), g2 = ac.createGain(), l = ac.createOscillator(), lg = ac.createGain();
          o.frequency.value = fq; g2.gain.value = .1; l.frequency.value = .09 + i * .05; lg.gain.value = .09;
          l.connect(lg); lg.connect(g2.gain); o.connect(g2); g2.connect(out); o.start(); l.start(); ns.push(o, l);
        });
        return { level: .34, nodes: ns };
      },
      pulse: function (out) {
        function beat(at, v) {
          var o = ac.createOscillator(), g2 = ac.createGain();
          o.frequency.setValueAtTime(74, at); o.frequency.exponentialRampToValueAtTime(42, at + .16);
          g2.gain.setValueAtTime(.0001, at); g2.gain.exponentialRampToValueAtTime(v, at + .02); g2.gain.exponentialRampToValueAtTime(.0001, at + .26);
          o.connect(g2); g2.connect(out); o.start(at); o.stop(at + .3);
        }
        function tick() { var t = ac.currentTime + .05; beat(t, .95); beat(t + .27, .55); }
        tick(); var id = setInterval(tick, 1250);
        return { level: .9, nodes: [], stop: function () { clearInterval(id); } };
      }
    };
    /* A layer plays its chosen recording when the file exists, otherwise the generated sound. */
    function fade(m, to, stop) {
      clearInterval(m._f);
      m._f = setInterval(function () {
        var up = to > m.volume, v = m.volume + (up ? .05 : -.06);
        if ((up && v >= to) || (!up && v <= to)) { v = to; clearInterval(m._f); if (stop) m.pause(); }
        m.volume = clamp(v);
      }, 40);
    }
    function setLayer(id, on) {
      var b = $('[data-layer="' + id + '"]', room), src = b && b.dataset.src;
      if (src && !b._bad) {
        /* Served over http(s): decode the file into Web Audio so the wave can hear it. */
        if (/^https?:$/.test(location.protocol)) { bufLayer(id, on, b, src); return; }
        /* Opened as a local file: browsers block Web Audio analysis there, so play it plainly. */
        var m = b._audio;
        if (on) {
          if (!m) {
            m = b._audio = new Audio(src); m.loop = true; m.preload = 'auto';
            m.addEventListener('error', function () { b._bad = true; clearInterval(m._f); delete layers[id]; if (b.getAttribute('aria-pressed') === 'true') genLayer(id, true); });
          }
          layers[id] = { media: m }; m.volume = 0;
          var pl = m.play(); if (pl && pl.catch) pl.catch(function () {});
          fade(m, .9);
        } else if (layers[id]) { delete layers[id]; fade(m, 0, true); }
        return;
      }
      genLayer(id, on);
    }
    function bufLayer(id, on, b, src) {
      ensure(); if (!ac) return; if (ac.state === 'suspended') ac.resume();
      if (!on) { genLayer(id, false); return; }
      if (layers[id]) return;
      function start(buf) {
        if (b.getAttribute('aria-pressed') !== 'true' || layers[id]) return;
        var out = ac.createGain(), s = ac.createBufferSource(); s.buffer = buf; s.loop = true;
        s.connect(out); out.connect(master); s.start();
        out.gain.setValueAtTime(0, ac.currentTime); out.gain.linearRampToValueAtTime(.9, ac.currentTime + 1.2);
        layers[id] = { out: out, nodes: [s], level: .9 };
      }
      if (b._buf) { start(b._buf); return; }
      fetch(src).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(function (a) { return new Promise(function (res, rej) { ac.decodeAudioData(a, res, rej); }); })
        .then(function (buf) { b._buf = buf; start(buf); })
        .catch(function () { b._bad = true; if (b.getAttribute('aria-pressed') === 'true') genLayer(id, true); });
    }
    function genLayer(id, on) {
      ensure(); if (!ac) return; if (ac.state === 'suspended') ac.resume();
      if (on && !layers[id]) {
        var out = ac.createGain(); out.gain.value = 0; out.connect(master);
        var l = make[id](out); l.out = out; layers[id] = l;
        out.gain.setValueAtTime(0, ac.currentTime); out.gain.linearRampToValueAtTime(l.level, ac.currentTime + 1.2);
      } else if (!on && layers[id]) {
        var old = layers[id]; delete layers[id];
        old.out.gain.cancelScheduledValues(ac.currentTime); old.out.gain.setValueAtTime(old.out.gain.value, ac.currentTime); old.out.gain.linearRampToValueAtTime(0, ac.currentTime + .7);
        setTimeout(function () { if (old.stop) old.stop(); old.nodes.forEach(function (n) { try { n.stop(); } catch (e) {} }); old.out.disconnect(); }, 800);
      }
    }
    function paintLayers(lastText) {
      var u = ui(), names = [];
      btns.forEach(function (b) {
        var on = b.getAttribute('aria-pressed') === 'true';
        $('.st', b).textContent = on ? u.stop : u.play;
        if (on) names.push($('b', b).textContent);
      });
      now.textContent = names.length ? u.hearing + names.join(lang() === 'ar' ? '، ' : ', ') + (lastText ? ' — ' + lastText : '') : u.silence;
    }
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        var on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', on); setLayer(b.dataset.layer, on);
        paintLayers();
      });
    });
    function stopAll() { btns.forEach(function (b) { if (b.getAttribute('aria-pressed') === 'true') { b.setAttribute('aria-pressed', false); setLayer(b.dataset.layer, false); } }); paintLayers(); }
    new IntersectionObserver(function (e) { if (!e[0].isIntersecting) stopAll(); }).observe(room);
    document.addEventListener('visibilitychange', function () { if (document.hidden) stopAll(); });
    document.addEventListener('jass:lang', function () { paintLayers(); });
    paintLayers();
    function size() { g = fit(c, 1.5); }
    size(); document.addEventListener('jass:resize', size);
    scene(c, function (p) { amp = motion() ? p : 1; }, 'enter');
    /* The wave follows how loud the room is, not the raw waveform, so it moves smoothly. */
    var phase = 0, lastDraw = 0, lastT = 0, level = 0;
    function loudness(t) {
      if (!Object.keys(layers).length) return 0;
      if (an) {
        an.getByteTimeDomainData(data);
        for (var i = 0, s = 0; i < data.length; i += 4) { var v = (data[i] - 128) / 128; s += v * v; }
        var rms = Math.sqrt(s / (data.length / 4));
        if (rms > .004) return clamp(rms * 5.5);
      }
      return .45 + .25 * Math.sin(t * .0023) * Math.sin(t * .0011 + 1);
    }
    function draw(t) {
      if (!motion() && t - lastDraw < 400) return; lastDraw = t;
      var dt = Math.min(50, t - lastT || 16); lastT = t;
      var ctx = g.ctx, w = g.w, h = g.h, mid = h / 2, on = Object.keys(layers).length > 0, target = loudness(t);
      level = lerp(level, target, target > level ? .3 : .05);
      ctx.clearRect(0, 0, w, h);
      phase += motion() ? dt * (.0008 + level * .0026) : 0;
      var a = (on ? .3 + .7 * level : .35) * amp;
      [{ k: 1, o: 1 }, { k: .64, o: .55 }, { k: .36, o: .3 }].forEach(function (L, li) {
        var pts = [], N = Math.max(24, Math.floor(w / 14));
        for (var i = 0; i <= N; i++) {
          var u = i / N, env = Math.sin(u * Math.PI);
          var y = (Math.sin(u * 9 + phase * (1 + li * .35)) * .62 + Math.sin(u * 17 - phase * 1.3 + li) * .38) * h * .44 * L.k * env * a;
          pts.push(u * w, mid + y);
        }
        ctx.globalAlpha = L.o; ctx.strokeStyle = '#f3eee4'; ctx.lineWidth = li === 0 ? 2 + level * 1.5 : 1.25;
        ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
        for (var q = 2; q < pts.length - 2; q += 2) ctx.quadraticCurveTo(pts[q], pts[q + 1], (pts[q] + pts[q + 2]) / 2, (pts[q + 1] + pts[q + 3]) / 2);
        ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]); ctx.stroke();
        if (li === 0) {
          ctx.fillStyle = '#efff50';
          for (var d = 8; d < pts.length - 2; d += 8) { ctx.beginPath(); ctx.arc(pts[d], pts[d + 1], 3 + level * 4, 0, 6.3); ctx.fill(); }
        }
      });
      ctx.globalAlpha = 1;
    }
    frame(draw, c);
  }

  /* ---------- 05 MOTION GRAPHICS: a painting in motion (after "The Starry Night", 1889) ---------- */
  var STARS = [[.44, .4, .22, 1.6], [.63, .33, .11, -1], [.84, .22, .085, 1.2], [.12, .12, .05, 1], [.3, .11, .05, 1], [.55, .1, .05, 1], [.76, .12, .045, 1], [.92, .42, .06, 1], [.22, .36, .05, 1]];
  function horizon(u) { return .68 + .04 * Math.sin(u * 6 + .5); }
  function cypress(u, v) { return v > .16 && Math.abs(u - .15) < .085 * Math.pow((v - .16) / .84, .8) + .006 * Math.sin(v * 60); }
  function skyField(u, v) {
    var fx, fy;
    if (cypress(u, v)) { fx = .22 * Math.sin(v * 42); fy = -1; }
    else if (v > horizon(u)) { fx = 1; fy = .35 * Math.sin(u * 14 + v * 9); }
    else {
      fx = 1; fy = .22 * Math.sin(u * 7 + v * 3);
      for (var i = 0; i < STARS.length; i++) {
        var a = STARS[i], dx = (u - a[0]) * 1.33, dy = v - a[1], d2 = dx * dx + dy * dy + 1e-5, w = a[3] * Math.exp(-d2 / (a[2] * a[2])) * 4, l = Math.sqrt(d2);
        fx += -dy / l * w; fy += dx / l * w;
      }
    }
    var m = Math.sqrt(fx * fx + fy * fy) || 1; return [fx / m, fy / m];
  }
  function skyColor(u, v, r) {
    if (cypress(u, v)) return r < .7 ? 5 : 6;
    var hz = horizon(u);
    if (v > hz) { if (v < hz + .15 && u > .32 && u < .86 && r > .94) return 4; return r < .55 ? 5 : (r < .85 ? 0 : 1); }
    for (var i = 2; i < STARS.length; i++) {
      var a = STARS[i], d = Math.hypot((u - a[0]) * 1.33, v - a[1]);
      if (d < a[2] * .55) return r < .85 ? 4 : 3;
      if (d < a[2]) return r < .5 ? 4 : (r < .8 ? 3 : 2);
    }
    var b = STARS[0], dd = Math.hypot((u - b[0]) * 1.33, v - b[1]);
    if (dd < b[2] * 1.15 && Math.sin(dd * 62) > .25) return r < .55 ? 3 : 2;
    return r < .42 ? 1 : (r < .74 ? 0 : (r < .93 ? 2 : 3));
  }
  function initFeel() {
    var f = $('.feel'); if (!f) return;
    var lens = $('.lens', f), c = $('canvas', lens), btn = $('.lens-toggle', f), items = $$('.stages li', f);
    var stage = -1, z = 1, C = 0, Dt = 0, playing = true, drawn = false, last = 0;
    var draw = makeFlow(c, {
      field: skyField, color: skyColor, ax: .44, ay: .4, seed: 11,
      lum: [.26, .42, .66, .92, 1, .08, .3],
      palettes: [['#0a2a8f', '#0044e5', '#5b8bff', '#f3eee4', '#efff50', '#050403', '#934635'], ['#050403', '#050403', '#efff50', '#efff50', '#efff50', '#050403', '#050403']]
    });
    function setStage(s) {
      if (stage === s) return; stage = s; drawn = false;
      items.forEach(function (li, i) { if (i === s) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
    }
    function paintBtn() { var u = ui(); btn.textContent = playing ? u.pause : u.resume; btn.hidden = !motion(); }
    btn.addEventListener('click', function () { playing = !playing; paintBtn(); });
    document.addEventListener('jass:lang', paintBtn);
    document.addEventListener('jass:motion', function () { drawn = false; paintBtn(); });
    document.addEventListener('jass:resize', function () { drawn = false; });
    paintBtn(); setStage(0);
    scene(f, function (p) { setStage(motion() ? Math.min(3, Math.floor(p * 4)) : 0); });
    frame(function (t) {
      var dt = Math.min(40, t - last); last = t;
      var live = motion() && playing;
      if (!live && drawn) return; drawn = true;
      var k = live ? 1 - Math.pow(.93, dt / 16) : 1;
      z = lerp(z, stage === 1 ? 2.3 : (stage === 2 ? 1.4 : 1), k);
      C = lerp(C, stage === 2 ? 1 : 0, k);
      Dt = lerp(Dt, stage === 3 ? 1 : 0, k);
      draw(live ? dt : 0, { z: z, c: C, d: Dt });
    }, c);
  }

  /* ---------- Stories: slow black and white ink ---------- */
  function initInk() {
    var c = $('.ink-flow'); if (!c) return;
    var last = 0, drawn = false;
    var draw = makeFlow(c, {
      seed: 23, ax: .5, ay: .5, palettes: [['#050403', '#24211e', '#77736b', '#f3eee4']],
      field: function (u, v) { var a = Math.sin(u * 3.2 + v * 2.1) * 2.4 + Math.cos(v * 4.4 - u * 1.7) * 2.2; return [Math.cos(a), Math.sin(a)]; },
      color: function (u, v, r) { var n = (Math.sin(u * 4.1 + 1.2) + Math.sin(v * 5.3 + u * 2.4) + Math.cos((u - v) * 6.1)) / 3 + (r - .5) * .28; return n > .4 ? 3 : (n > .2 ? 2 : (n > -.05 ? 1 : 0)); }
    });
    document.addEventListener('jass:motion', function () { drawn = false; });
    document.addEventListener('jass:resize', function () { drawn = false; });
    frame(function (t) {
      var dt = Math.min(40, t - last); last = t;
      if (!motion() && drawn) return; drawn = true;
      draw(motion() ? dt * .55 : 0, {});
    }, c);
  }

  /* ---------- Vision: rings of touch and sound spreading outward ---------- */
  function initOrbits() {
    var c = $('.orbits'); if (!c) return;
    var g, grow = 0, last = 0;
    function size() { g = fit(c, 1.5); }
    size(); document.addEventListener('jass:resize', size);
    scene(c, function (p) { grow = motion() ? easeIO(clamp(p * 1.1)) : 1; }, 'enter');
    frame(function (t) {
      if (!motion() && t - last < 1000) return; last = t;
      var ctx = g.ctx, w = g.w, h = g.h, cx = w / 2, cy = h / 2, R = Math.min(w, h) * .47;
      var T = motion() ? t : 0, cream = new Path2D(), yellow = new Path2D();
      ctx.clearRect(0, 0, w, h);
      for (var ring = 1; ring <= 10; ring++) {
        var rr = R * ring / 10 * (.3 + .7 * grow), n = 12 + ring * 9, dir = ring % 2 ? 1 : -1, p = ring % 3 === 0 ? yellow : cream;
        for (var i = 0; i < n; i++) {
          var a = i / n * 6.283 + T * .00011 * dir * (11 - ring) * .6, wob = 1 + .055 * Math.sin(a * 5 + T * .0011 + ring);
          var x = cx + Math.cos(a) * rr * wob, y = cy + Math.sin(a) * rr * wob, r = 1.3 + 2.8 * (.5 + .5 * Math.sin(a * 3 - T * .002 + ring * .8));
          p.moveTo(x + r, y); p.arc(x, y, r, 0, 6.3);
        }
      }
      yellow.moveTo(cx + 15, cy); yellow.arc(cx, cy, 15 + Math.sin(T * .002) * 3, 0, 6.3);
      ctx.fillStyle = '#f3eee4'; ctx.fill(cream); ctx.fillStyle = '#efff50'; ctx.fill(yellow);
    }, c);
  }

  /* ---------- Small scroll-driven pieces ---------- */
  function initScrollBits() {
    var a = $('.strata');
    if (a) scene(a, function (p) { a.style.setProperty('--p', motion() ? p.toFixed(3) : 1); }, 'line');
    var b = $('.senses');
    if (b) scene(b, function (p) { b.style.setProperty('--p', motion() ? easeIO(clamp(p * 1.2)).toFixed(3) : 1); }, 'line');
    $$('.marq-group').forEach(function (g) {
      var copy = g.cloneNode(true); copy.setAttribute('aria-hidden', 'true'); copy.removeAttribute('aria-label'); copy.removeAttribute('data-ta');
      $$('img', copy).forEach(function (i) { i.alt = ''; i.removeAttribute('data-ta'); });
      g.parentNode.appendChild(copy);
    });
  }

  /* ---------- Decorative but real Braille words ---------- */
  function initBrailleWords() {
    var els = $$('[data-br-ar]'); if (!els.length) return;
    function paint() { els.forEach(function (e) { renderBraille(e, lang() === 'ar' ? e.dataset.brAr : e.dataset.brEn); }); }
    document.addEventListener('jass:lang', paint); paint();
  }

  /* ---------- Success page ---------- */
  function initOk() {
    var c = $('.ok-page .field'); if (c) initField(c, { rise: 1, tilt: .55, D: 2.6, logo: false, dim: .45 });
  }

  /* ---------- 06 UNDERSTAND: Braille ---------- */
  var BRAILLE = {
    'ا':'⠁','أ':'⠌','إ':'⠨','آ':'⠜','ء':'⠄','ؤ':'⠳','ئ':'⠽','ب':'⠃','ت':'⠞','ث':'⠹','ج':'⠚','ح':'⠱','خ':'⠭','د':'⠙','ذ':'⠮','ر':'⠗','ز':'⠵','س':'⠎','ش':'⠩','ص':'⠯','ض':'⠫','ط':'⠾','ظ':'⠿','ع':'⠷','غ':'⠣','ف':'⠋','ق':'⠟','ك':'⠅','ل':'⠇','م':'⠍','ن':'⠝','ه':'⠓','ة':'⠡','و':'⠺','ى':'⠕','ي':'⠊',
    a:'⠁',b:'⠃',c:'⠉',d:'⠙',e:'⠑',f:'⠋',g:'⠛',h:'⠓',i:'⠊',j:'⠚',k:'⠅',l:'⠇',m:'⠍',n:'⠝',o:'⠕',p:'⠏',q:'⠟',r:'⠗',s:'⠎',t:'⠞',u:'⠥',v:'⠧',w:'⠺',x:'⠭',y:'⠽',z:'⠵'
  };
  function brailleCells(text) {
    var out = [], clean = text.toLowerCase().replace(/[ً-ْـ]/g, '');
    Array.from(clean).forEach(function (ch) {
      if (ch === ' ') out.push({ space: true });
      else if (BRAILLE[ch]) out.push({ ch: ch, code: BRAILLE[ch].charCodeAt(0) - 0x2800 });
    });
    return out;
  }
  function renderBraille(box, text) {
    var cells = brailleCells(text), order = [0, 3, 1, 4, 2, 5];
    box.classList.remove('in');
    box.innerHTML = cells.map(function (c, n) {
      if (c.space) return '<span class="cell space"></span>';
      var dots = order.map(function (b, k) { return '<i class="' + (c.code >> b & 1 ? 'on' : '') + '" style="--c:' + n + ';--k:' + k + '"></i>'; }).join('');
      return '<span class="cell" aria-hidden="true">' + dots + '<em>' + c.ch + '</em></span>';
    }).join('');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', ui().braille + (text || '').trim());
    if (motion()) { void box.offsetWidth; requestAnimationFrame(function () { box.classList.add('in'); }); } else box.classList.add('in');
  }
  function initBraille() {
    var box = $('#br-cells'); if (!box) return;
    var chips = $('#br-chips'), idx = 0;
    function paint() {
      var words = ui().chips;
      chips.innerHTML = words.map(function (w, i) { return '<button class="btn ghost" type="button" aria-pressed="' + (i === idx) + '">' + w + '</button>'; }).join('');
      renderBraille(box, words[idx]);
    }
    chips.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      idx = $$('button', chips).indexOf(b); paint(); chips.children[idx].focus();
    });
    document.addEventListener('jass:lang', paint); paint();
  }

  /* ---------- Process, counters ---------- */
  function initProcess() {
    var p = $('.proc');
    if (p) scene(p, function (v) { p.style.setProperty('--p', motion() ? v.toFixed(3) : 1); }, 'line');
    var how = $('.how');
    if (how) {
      var steps = $$('li', how);
      scene(how, function (v) {
        if (!motion()) v = 1;
        how.style.setProperty('--p', v.toFixed(3));
        steps.forEach(function (s, i) { s.classList.toggle('lit', v >= i / steps.length + .04); });
      }, 'step');
    }
  }
  function fmt(n) { return new Intl.NumberFormat(lang() === 'ar' ? 'ar-SA-u-nu-arab' : 'en-US').format(n); }
  function initCounts() {
    var els = $$('.count'); if (!els.length) return;
    var run = function (el) {
      var to = +el.dataset.to; el._done = true;
      if (!motion()) { el.textContent = fmt(to); return; }
      var t0 = performance.now();
      (function step(t) { var k = clamp((t - t0) / 1500); el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); })(t0);
    };
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }); }, { threshold: .5 });
    els.forEach(function (e) { e.textContent = fmt(+e.dataset.to); io.observe(e); });
    document.addEventListener('jass:lang', function () { els.forEach(function (e) { e.textContent = fmt(+e.dataset.to); }); });
  }

  /* ---------- Forms ----------
     Front-end only: replace the marked block in submitForm() with a real
     request once a backend or form service is chosen. */
  function fieldError(input) {
    var e = ui().err, v = (input.value || '').trim();
    if (input.type === 'radio') {
      var g = $$('input[name="' + input.name + '"]', input.form);
      return input.required && !g.some(function (r) { return r.checked; }) ? e.radio : '';
    }
    if (input.type === 'file') {
      if (input.files[0] && input.files[0].size > 10 * 1048576) return e.size;
      return input.required && !input.files[0] ? e.required : '';
    }
    if (input.required && !v) return e.required;
    if (v && input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return e.email;
    if (v && input.type === 'tel' && !/^[+\d٠-٩][\d٠-٩\s()\-]{6,}$/.test(v)) return e.phone;
    if (v && input.type === 'url' && !/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(v)) return e.url;
    return '';
  }
  function showError(input, msg) {
    var f = input.closest('.f'), err = $('.err', f); if (!f || !err) return;
    f.classList.toggle('bad', !!msg); err.textContent = msg;
    if (input.type !== 'radio') { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  }
  function submitForm(form) {
    var first = null, seen = {};
    $$('input,select,textarea', form).forEach(function (i) {
      if (i.type === 'radio') { if (seen[i.name]) return; seen[i.name] = 1; }
      var m = fieldError(i); showError(i, m); if (m && !first) first = i;
    });
    if (first) { first.focus(); return; }
    /* >>> Connect to a backend here (fetch with new FormData(form)). <<< */
    leaveTo('success.html?lang=' + lang());
  }
  function initForms() {
    $$('form.form').forEach(function (form) {
      form.addEventListener('submit', function (e) { e.preventDefault(); submitForm(form); });
      form.addEventListener('focusout', function (e) { var i = e.target; if (i.matches('input:not([type=radio]),select,textarea') && $('.err', i.closest('.f') || form)) if (i.closest('.f').classList.contains('bad') || i.value) showError(i, fieldError(i)); });
      form.addEventListener('change', function (e) { if (e.target.type === 'radio') showError(e.target, ''); });
    });
    $$('.drop').forEach(function (d) {
      var input = $('input[type=file]', d), label = $('.fname', d);
      ['dragenter', 'dragover'].forEach(function (t) { d.addEventListener(t, function () { d.classList.add('over'); }); });
      ['dragleave', 'drop'].forEach(function (t) { d.addEventListener(t, function () { d.classList.remove('over'); }); });
      input.addEventListener('change', function () { if (label) label.textContent = input.files[0] ? ui().selected + input.files[0].name : ''; if (input.closest('.f')) showError(input, fieldError(input)); });
    });
    var seg = $('.seg');
    if (seg) $$('button', seg).forEach(function (b) {
      b.addEventListener('click', function () {
        $$('button', seg).forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        $$('.reg').forEach(function (f) { f.hidden = f.id !== b.dataset.form; });
      });
    });
    $$('.role button').forEach(function (b) {
      b.addEventListener('click', function () {
        var sel = $('#role'); sel.value = b.dataset.role; showError(sel, '');
        var top = $('#apply').getBoundingClientRect().top + scrollY - 90;
        scrollTo({ top: top, behavior: motion() ? 'smooth' : 'auto' });
        setTimeout(function () { sel.focus({ preventScroll: true }); }, motion() ? 700 : 0);
      });
    });
  }

  /* ---------- Volunteer: role glyphs ---------- */
  var GLYPHS = {
    1: ['.......', '.###...', '.###.#.', '.###.#.', '....##.', '...###.', '.......'],
    2: ['......#', '.....#.', '...##..', '.##....', '#......', '..#....', '....#.#'],
    3: ['...#...', '.#.#...', '.#.#.#.', '##.#.##', '.#.#.#.', '.#.#...', '...#...'],
    4: ['...#...', '..#.#..', '.#...#.', '#######', '#.....#', '#.....#', '#######'],
    5: ['#####.#', '.......', '###.###', '.......', '#.#####', '.......', '####...'],
    6: ['..###..', '.#...#.', '#..#..#', '#.###.#', '#..#..#', '.#...#.', '..###..']
  };
  function initRoles() {
    $$('.gl').forEach(function (g) {
      var map = GLYPHS[g.dataset.g], k = 0;
      g.innerHTML = map.join('').split('').map(function (c) { return '<i class="' + (c === '#' ? 'on' : '') + '" style="--k:' + k++ + '"></i>'; }).join('');
    });
  }

  /* ---------- Volunteer hero: people and skills, connected ---------- */
  function initConstellation() {
    var c = $('.v-hero canvas'); if (!c) return;
    var g, nodes = [];
    function size() {
      g = fit(c, 1.5); nodes = [];
      var n = Math.min(90, Math.floor(g.w / 18));
      for (var i = 0; i < n; i++) nodes.push({ x: Math.random() * g.w, y: Math.random() * g.h, a: Math.random() * 6.3, s: .15 + Math.random() * .3, r: 1.2 + Math.random() * 2.6, hi: i % 11 === 0 });
    }
    size(); document.addEventListener('jass:resize', size);
    var last = 0;
    frame(function (t) {
      if (!motion() && t - last < 1000) return; last = t;
      var ctx = g.ctx, w = g.w, h = g.h, r = c.getBoundingClientRect(), px = pointer.x - r.left, py = pointer.y - r.top;
      ctx.clearRect(0, 0, w, h);
      var P = nodes.map(function (n) {
        var x = n.x + Math.cos(n.a + t * .0002 * n.s * 3) * 26, y = n.y + Math.sin(n.a * 1.3 + t * .00025 * n.s * 3) * 26;
        var d = Math.hypot(x - px, y - py), pull = d < 220 ? (1 - d / 220) * .24 : 0;
        return { x: x + (px - x) * pull, y: y + (py - y) * pull, n: n };
      });
      ctx.lineWidth = 1;
      for (var i = 0; i < P.length; i++) for (var j = i + 1; j < P.length; j++) {
        var d = Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y);
        if (d < 130) { ctx.strokeStyle = 'rgba(243,238,228,' + ((1 - d / 130) * .3).toFixed(3) + ')'; ctx.beginPath(); ctx.moveTo(P[i].x, P[i].y); ctx.lineTo(P[j].x, P[j].y); ctx.stroke(); }
      }
      P.forEach(function (p) { ctx.fillStyle = p.n.hi ? '#efff50' : 'rgba(243,238,228,.75)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.n.r * (p.n.hi ? 1.7 : 1), 0, 6.3); ctx.fill(); });
      ctx.strokeStyle = 'rgba(239,255,80,.75)'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (var x = 0; x <= w; x += 6) { var u = x / w, y = h * .9 + Math.sin(u * 22 + t * .0014) * Math.sin(u * 3.14) * 22; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }, c);
  }

  /* ---------- Volunteer closing: every discipline becomes one ---------- */
  function initClosing() {
    var sec = $('.closing'); if (!sec) return;
    var c = $('canvas', sec), g, pts = [], gather = motion() ? 0 : 1, last = -1;
    var CENTERS = [[.14, .2], [.5, .14], [.86, .2], [.12, .68], [.5, .78], [.88, .68]];
    var COLORS = ['#efff50', '#f3eee4', '#2a68ff', '#c9694f'];
    $$('.closing-labels span', sec).forEach(function (s, i) { s.style.left = CENTERS[i][0] * 100 + '%'; s.style.top = CENTERS[i][1] * 100 + '%'; });
    var logo = new Image();
    function build() {
      if (!logo.complete || !logo.naturalWidth) return;
      g = fit(c, 1.5);
      var o = document.createElement('canvas'), W = logo.naturalWidth, H = logo.naturalHeight; o.width = W; o.height = H;
      var x = o.getContext('2d'); x.drawImage(logo, 0, 0);
      var d = x.getImageData(0, 0, W, H).data, targets = [], step = 3;
      for (var yy = 0; yy < H; yy += step) for (var xx = 0; xx < W; xx += step) if (d[(yy * W + xx) * 4 + 3] > 128) targets.push([xx, yy]);
      var scale = Math.min(g.w * .62, 640) / W, ox = g.w / 2 - W * scale / 2, oy = g.h * .42 - H * scale / 2;
      var seed = 11, rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      pts = targets.map(function (t, i) {
        var k = i % 6, ang = rnd() * 6.3, rad = Math.pow(rnd(), .6) * Math.min(g.w, g.h) * .13;
        return { sx: CENTERS[k][0] * g.w + Math.cos(ang) * rad, sy: CENTERS[k][1] * g.h + Math.sin(ang) * rad, tx: ox + t[0] * scale, ty: oy + t[1] * scale, d: rnd() * .35, c: COLORS[k % 4], ph: rnd() * 6.3, r: Math.max(1.1, step * scale * .46) };
      });
      last = -1;
    }
    logo.onload = build; logo.src = window.JASS_ART.logo;
    document.addEventListener('jass:resize', build);
    document.addEventListener('jass:motion', function () { last = -1; });
    scene(sec, function (p) {
      gather = motion() ? clamp((p - .1) / .62) : 1;
      sec.style.setProperty('--gather', gather.toFixed(3));
      sec.style.setProperty('--end', (motion() ? clamp((p - .68) / .16) : 1).toFixed(3));
    });
    frame(function (t) {
      if (!g || !pts.length) return;
      if (gather >= 1 && last === 1) return;
      last = gather >= 1 ? 1 : 0;
      var ctx = g.ctx; ctx.clearRect(0, 0, g.w, g.h);
      var groups = {};
      pts.forEach(function (p) {
        var k = easeIO(clamp((gather - p.d) / (1 - p.d))), float = (1 - k) * 8;
        var x = lerp(p.sx, p.tx, k) + Math.cos(t * .0009 + p.ph) * float, y = lerp(p.sy, p.ty, k) + Math.sin(t * .0011 + p.ph) * float;
        var col = k > .86 ? '#f3eee4' : p.c, path = groups[col] || (groups[col] = new Path2D());
        var r = lerp(1.5, p.r, k); path.moveTo(x + r, y); path.arc(x, y, r, 0, 6.3);
      });
      Object.keys(groups).forEach(function (col) { ctx.fillStyle = col; ctx.fill(groups[col]); });
    }, c);
  }

  /* ---------- Boot ---------- */
  function boot() {
    snapshot();
    initRail();
    snapshot();
    $$('.words').forEach(function (e) { if (!e.dataset.t) splitWords(e); });
    pars = $$('[data-par]');
    initSeams(); initComfort(); initMenu();
    initPageLinks();
    initHero(); initRelief(); initListen(); initFeel(); initInk(); initOrbits(); initBraille(); initBrailleWords(); initScrollBits(); initProcess(); initCounts(); initForms(); initRoles(); initConstellation(); initClosing(); initOk();
    applyLang(lang(), true);
    initReveal();
    document.addEventListener('jass:motion', requestUpdate);
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
