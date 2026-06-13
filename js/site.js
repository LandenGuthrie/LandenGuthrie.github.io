/* ============================================================
   Landens Portfolio — all page logic.
   Content is loaded from "Website Data/site.json" and
   "Website Data/Blogs/*.json" so nothing here needs editing.
   ============================================================ */

const DATA = 'Website Data/site.json';
const BLOG_DIR = 'Website Data/Blogs/';

/* ---------- small helpers ---------- */

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/* Turn [word](https://url) into a real link. Everything else is escaped. */
function richText(str) {
  const escaped = escapeHtml(str);
  return escaped.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, word, url) => `<a href="${url}" target="_blank" rel="noopener">${word}</a>`);
}

/* Local paths work with either slash direction: images\foo.png -> images/foo.png */
function fixPath(src) {
  return String(src || '').replaceAll('\\', '/');
}

/* Accept a full YouTube URL or a bare video id. */
function youtubeId(input) {
  const m = String(input).match(/(?:youtube\.com\/.*[?&]v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  return m ? m[1] : String(input).trim();
}

async function getJSON(path) {
  // cache-bust so edits to the JSON files always show up on refresh
  const res = await fetch(path + '?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}

const getSite = () => getJSON(DATA);
const getBlog = (name) => getJSON(BLOG_DIR + name + '.json');

/* ---------- top bar: appears when the mouse moves ---------- */

function initTopbar() {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  const TRIGGER_ZONE = 60; // px from the top of the screen

  document.addEventListener('mousemove', (e) => {
    // hovering the "About Me ->" link also summons the bar
    if (e.clientY <= TRIGGER_ZONE || e.target.closest?.('.skip-btn')) {
      bar.classList.add('visible');
    } else if (!bar.matches(':hover') && e.clientY > bar.offsetHeight + 20) {
      bar.classList.remove('visible');
    }
  });

  // on touch screens, tapping near the top shows the bar
  document.addEventListener('touchstart', (e) => {
    if (e.touches[0].clientY <= TRIGGER_ZONE * 2) bar.classList.add('visible');
    else if (!e.target.closest('#topbar')) bar.classList.remove('visible');
  }, { passive: true });
}

/* ---------- dark / light mode toggle ---------- */

function initTheme() {
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  });
}

/* ---------- scroll reveal animations ---------- */

function initReveals(root = document) {
  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('shown'); obs.unobserve(e.target); }
    }
  }, { threshold: 0.15 });
  root.querySelectorAll('.reveal').forEach(el => obs.observe(el));
}

/* ---------- shared renderers ---------- */

function blogCard(name, blog) {
  return `
    <a class="card reveal" href="blog.html?post=${encodeURIComponent(name)}">
      <div class="thumb-wrap"><img class="thumb" src="${escapeHtml(fixPath(blog.thumbnail))}" alt="${escapeHtml(blog.title)}" loading="lazy"></div>
      <div class="card-body">
        <h3>${escapeHtml(blog.title)}</h3>
        <div class="date">${escapeHtml(blog.date || '')}</div>
        <p>${escapeHtml(blog.description || '')}</p>
      </div>
    </a>`;
}

function linksRow(site) {
  const links = (site.links || [])
    .map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`)
    .join('');
  return `<div class="links-row reveal">${links}</div>
          <p class="contact-note reveal">Contact me: <a href="mailto:${escapeHtml(site.email)}">${escapeHtml(site.email)}</a></p>`;
}

/* ---------- find every blog json in the Blogs folder ----------
   Most local servers (python -m http.server, npx serve, VS Code
   Live Server) return a directory listing we can read. If that
   fails, we fall back to "blogsFallbackList" in site.json.       */

async function listAllBlogs(site) {
  try {
    const res = await fetch(BLOG_DIR);
    if (res.ok) {
      const html = await res.text();
      const names = [...html.matchAll(/href="([^"]+\.json)"/gi)]
        .map(m => decodeURIComponent(m[1].split('/').pop().replace(/\.json$/i, '')));
      if (names.length) return [...new Set(names)];
    }
  } catch { /* fall through to the manual list */ }
  return site.blogsFallbackList || site.featuredBlogs || [];
}

/* ---------- full-page slider: one scroll = one slide ---------- */

function initSlider() {
  const slides = document.getElementById('slides');
  if (!slides) return;
  const sections = [...slides.children];
  let index = 0;
  let locked = false;

  function goTo(i) {
    // undo any native anchor-jump scrolling — position is transform-only
    document.getElementById('slider').scrollTop = 0;
    const target = Math.max(0, Math.min(sections.length - 1, i));
    const changed = target !== index;
    index = target;
    slides.style.transform = `translateY(-${index * 100}vh)`;
    locked = true;
    setTimeout(() => { locked = false; }, 1000);

    // play this section's reveal animations, staggered
    sections[index].querySelectorAll('.reveal:not(.shown)').forEach((el, n) => {
      el.style.transitionDelay = `${0.3 + n * 0.1}s`;
      el.classList.add('shown');
    });
    // coming back to the hero replays its intro animation
    if (changed && sections[index].id === 'hero' && window.__replayHero) window.__replayHero();
    history.replaceState(null, '', '#' + sections[index].id);
  }

  const step = (dir) => { if (!locked) goTo(index + dir); };

  // mouse wheel / trackpad
  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (locked || Math.abs(e.deltaY) < 10) return;

    // if this section's content is taller than the screen, let it
    // finish scrolling internally before sliding to the next page
    const sec = sections[index];
    const scroller = sec.querySelector('.section-scroll') || sec;
    if (scroller.scrollHeight > scroller.clientHeight + 1) {
      const atTop = scroller.scrollTop <= 0;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      if ((e.deltaY > 0 && !atBottom) || (e.deltaY < 0 && !atTop)) {
        scroller.scrollTop += e.deltaY;
        return;
      }
    }
    step(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); step(1); }
    if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); step(-1); }
  });

  // touch swipe
  let touchY = null;
  window.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  window.addEventListener('touchend', (e) => {
    if (touchY === null) return;
    const dy = touchY - e.changedTouches[0].clientY;
    if (Math.abs(dy) > 50) step(dy > 0 ? 1 : -1);
    touchY = null;
  }, { passive: true });

  // links like #projects (top bar, About Me button) slide instead of jumping
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = sections.findIndex(s => '#' + s.id === a.getAttribute('href'));
      if (target >= 0) goTo(target);
    });
  });

  // arriving from another page with a hash like index.html#about
  const initial = sections.findIndex(s => '#' + s.id === location.hash);
  goTo(initial > 0 ? initial : 0);
  locked = false;
}

/* ============================================================
   Page initialisers — picked via <body data-page="...">
   ============================================================ */

/* ----- landing page ----- */
async function initHome() {
  const site = await getSite();
  document.title = site.siteTitle;

  // hero title: animate each letter rising in
  const h1 = document.getElementById('hero-title');
  function buildHero() {
    h1.innerHTML = site.siteTitle.split(' ').map(word =>
      `<span class="word">${[...word].map(ch =>
        `<span class="letter">${escapeHtml(ch)}</span>`).join('')}</span>`
    ).join('');
    let i = 0;
    h1.querySelectorAll('.letter').forEach(l => l.style.animationDelay = `${0.05 * i++}s`);
  }
  buildHero();

  // called by the slider whenever you come back to the hero page
  window.__replayHero = () => {
    buildHero();
    document.querySelectorAll('#hero .tagline, #hero .scroll-hint').forEach(el => {
      el.style.animation = 'none';
      void el.offsetWidth; // force a reflow so the animation restarts
      el.style.animation = '';
    });
  };

  document.getElementById('hero-tagline').textContent = site.tagline || '';

  // looping background video on the hero (set "heroVideo" in site.json):
  // a YouTube link becomes an embedded player, anything else plays directly
  const heroVideo = document.querySelector('#hero .hero-video');
  const heroSrc = fixPath(site.heroVideo);
  if (/youtube\.com|youtu\.be/.test(heroSrc)) {
    const id = youtubeId(heroSrc);
    heroVideo.insertAdjacentHTML('afterend',
      `<iframe class="hero-yt" tabindex="-1" title="" allow="autoplay; encrypted-media"
               src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&controls=0&rel=0&iv_load_policy=3&modestbranding=1&playsinline=1&disablekb=1&fs=0"></iframe>`);
  } else if (heroSrc) {
    heroVideo.src = heroSrc;
    heroVideo.muted = true;          // required for autoplay
    heroVideo.hidden = false;
    heroVideo.play().catch(() => {});
    heroVideo.addEventListener('error', () => { heroVideo.hidden = true; });
  }

  // color overlay on the video + hero text colors, all from site.json
  if (site.heroOverlay) {
    const overlay = document.querySelector('#hero .hero-overlay');
    overlay.style.background = site.heroOverlay;
    overlay.hidden = false;
  }
  if (site.heroTitleColor) h1.style.color = site.heroTitleColor;
  if (site.heroTaglineColor) document.getElementById('hero-tagline').style.color = site.heroTaglineColor;
  if (site.heroScrollColor) document.querySelector('#hero .scroll-hint').style.color = site.heroScrollColor;

  // top three featured projects
  const featured = (site.featuredBlogs || []).slice(0, 3);
  const cards = await Promise.all(featured.map(async name => {
    try { return blogCard(name, await getBlog(name)); }
    catch { return `<div class="error-msg">Couldn't load "${escapeHtml(name)}.json"</div>`; }
  }));
  document.getElementById('featured-grid').innerHTML = cards.join('');

  // about me
  document.getElementById('about-img').src = fixPath(site.about.image);
  document.getElementById('about-img').alt = site.name;
  document.getElementById('about-text').innerHTML =
    site.about.text.split(/\n\s*\n/).map(p => `<p class="reveal">${richText(p)}</p>`).join('');

  document.getElementById('home-links').innerHTML = linksRow(site);
  initSlider();
}

/* ----- all blogs page ----- */
async function initBlogs() {
  const site = await getSite();
  document.title = `Blogs — ${site.siteTitle}`;

  const names = await listAllBlogs(site);
  const cards = await Promise.all(names.map(async name => {
    try { return { name, blog: await getBlog(name) }; }
    catch { return null; }
  }));

  const grid = document.getElementById('blogs-grid');
  const loaded = cards.filter(Boolean);
  grid.innerHTML = loaded.length
    ? loaded.map(c => blogCard(c.name, c.blog)).join('')
    : `<div class="error-msg">No blogs found. Add a .json file to Website Data/Blogs/.</div>`;

  document.getElementById('blogs-contacts').innerHTML = linksRow(site);
  initReveals();
}

/* ----- single blog post page ----- */
async function initPost() {
  const site = await getSite();
  const name = new URLSearchParams(location.search).get('post');
  const el = document.getElementById('post');

  if (!name) { el.innerHTML = `<div class="error-msg">No blog selected.</div>`; return; }

  let blog;
  try { blog = await getBlog(name); }
  catch {
    el.innerHTML = `<div class="error-msg">Couldn't find "${escapeHtml(name)}.json" in Website Data/Blogs/.</div>`;
    return;
  }

  document.title = `${blog.title} — ${site.siteTitle}`;

  // previous / next blog, in the same order as the blogs page
  const names = await listAllBlogs(site);
  const idx = names.indexOf(name);
  const prevName = idx > 0 ? names[idx - 1] : null;
  const nextName = idx >= 0 && idx < names.length - 1 ? names[idx + 1] : null;

  let headingCount = 0;
  const blocks = (blog.content || []).map(block => {
    switch (block.type) {
      case 'heading':
        return `<h2 class="reveal" id="h-${headingCount++}">${escapeHtml(block.text)}</h2>`;
      case 'subheading':
        return `<h3 class="reveal" id="h-${headingCount++}">${escapeHtml(block.text)}</h3>`;
      case 'text':
        return `<p class="reveal">${richText(block.text)}</p>`;
      case 'image':
        return `<figure class="reveal">
                  <img src="${escapeHtml(fixPath(block.src))}" alt="${escapeHtml(block.caption || blog.title)}" loading="lazy"
                       onerror="this.outerHTML='<div class=&quot;error-msg&quot;>Image not found: ${escapeHtml(fixPath(block.src))}</div>'">
                  ${block.caption ? `<figcaption>${richText(block.caption)}</figcaption>` : ''}
                </figure>`;
      case 'video':
        // a local file (images/clip.mp4) or a direct video URL, with controls
        return `<div class="video-wrap reveal">
                  <video src="${escapeHtml(fixPath(block.src))}" controls playsinline preload="metadata"></video>
                </div>`;
      case 'youtube':
        return `<div class="video-wrap reveal">
                  <iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(youtubeId(block.url || block.id))}"
                          title="YouTube video" allowfullscreen
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>
                </div>`;
      default:
        return '';
    }
  }).join('');

  const navLinks =
    (prevName ? `<a href="blog.html?post=${encodeURIComponent(prevName)}">&larr; Previous Blog</a>` : '') +
    (nextName ? `<a href="blog.html?post=${encodeURIComponent(nextName)}">Next Blog &rarr;</a>` : '');

  el.innerHTML = `
    <a class="back-link" href="blogs.html">&larr; All Blogs</a>
    <header class="post-head">
      <h1 class="post-title">${escapeHtml(blog.title)}</h1>
      ${navLinks ? `<nav class="post-nav">${navLinks}</nav>` : ''}
    </header>
    <div class="post-date">${escapeHtml(blog.date || '')}</div>
    <div class="post-content">${blocks}</div>`;
  initReveals();

  // table of contents on the left: every header (and indented sub header)
  const heads = el.querySelectorAll('.post-content h2[id], .post-content h3[id]');
  if (heads.length) {
    const tocLinks = [...heads].map(h =>
      `<a class="${h.tagName === 'H3' ? 'sub' : ''}" href="#${h.id}">${escapeHtml(h.textContent)}</a>`
    ).join('');
    document.body.insertAdjacentHTML('beforeend',
      `<nav id="toc"><div class="toc-title">On this page</div>${tocLinks}</nav>`);

    // underline the header you're currently reading
    const spy = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          document.querySelectorAll('#toc a').forEach(a =>
            a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id));
        }
      }
    }, { rootMargin: '0px 0px -65% 0px' });
    heads.forEach(h => spy.observe(h));
  }

}

/* ---------- boot ---------- */

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initTopbar();
  const page = document.body.dataset.page;
  const boot = { home: initHome, blogs: initBlogs, post: initPost }[page];
  if (boot) boot().catch(err => {
    document.body.insertAdjacentHTML('beforeend',
      `<div class="error-msg" style="margin:6rem">Something went wrong loading the site data: ${escapeHtml(err.message)}.<br><br>
       Make sure you opened the site through a local server (see README.md) — opening index.html directly from the file explorer blocks the JSON files from loading.</div>`);
  });
});
