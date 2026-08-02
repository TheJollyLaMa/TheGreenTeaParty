/**
 * spiral.js — Mandelbrot-Inspired Spiral Constellation View
 * The Green Tea Party Fund · v0.3
 *
 * Layout: Phyllotaxis (golden-angle) spiral with tracks sorted consecutively
 * so related projects naturally cluster into arc segments.
 */

(function () {
  'use strict';

  // ---- Constants ----------------------------------------------------------------

  /** Golden angle in radians ≈ 137.508° — produces the sunflower phyllotaxis. */
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

  /** Radial scale factor: distance per sqrt(index). Tune for viewport density. */
  const LAYOUT_SCALE = 22;

  const TRACK_COLORS = {
    'Green Tea':    '#22c55e',
    'Blue Tea':     '#3b82f6',
    'Red Rice':     '#ef4444',
    'Purple Sage':  '#a855f7',
    'Golden Root':  '#f59e0b',
    'Silver Stream':'#94a3b8'
  };

  const TRACK_ORDER = Object.keys(TRACK_COLORS);

  const STATUS_COLORS = {
    active:    '#22c55e',
    planning:  '#f59e0b',
    completed: '#94a3b8',
    paused:    '#ef4444'
  };

  // ---- Application state --------------------------------------------------------

  let allProjects = [];
  let allAssociations = [];

  /** Computed layout nodes with x/y positions. */
  let nodes = [];
  /** id → node lookup. */
  let nodeMap = {};
  /** id → Set<id> adjacency list. */
  let adjacency = {};
  /** Rendered edge list: [{source, target, type}]. */
  let edges = [];

  let pan     = { x: 0, y: 0 };
  let zoom    = 1;
  let isPanning = false;
  let panLast   = { x: 0, y: 0 };

  let hoveredNode  = null;
  let selectedNode = null;
  let focusMode    = false;
  let showAssoc    = true;

  let filterTrack  = 'all';
  let filterStatus = 'all';

  /** requestAnimationFrame handle. */
  let rafId      = null;
  let needRender = true;

  /** Device pixel ratio. */
  let dpr = 1;

  // Touch state
  let touchPrev = null;
  let touchPinchDist = null;

  // ---- DOM references -----------------------------------------------------------

  let canvas, ctx;
  let tooltipEl, detailsPanel, detailsContentEl;
  let assocBtn, focusBtn, resetBtn;
  let trackSel, statusSel;
  let loadingEl, emptyEl;

  // ---- Initialisation -----------------------------------------------------------

  async function init() {
    canvas         = document.getElementById('spiral-canvas');
    ctx            = canvas.getContext('2d');
    tooltipEl      = document.getElementById('spiral-tooltip');
    detailsPanel   = document.getElementById('details-panel');
    detailsContentEl = document.getElementById('details-content');
    assocBtn       = document.getElementById('toggle-assoc');
    focusBtn       = document.getElementById('toggle-focus');
    resetBtn       = document.getElementById('reset-view');
    trackSel       = document.getElementById('spiral-track-filter');
    statusSel      = document.getElementById('spiral-status-filter');
    loadingEl      = document.getElementById('spiral-loading');
    emptyEl        = document.getElementById('spiral-empty');

    setupCanvas();
    bindEvents();

    // With <base href="../"> in views/spiral.html the browser resolves all
    // relative fetch paths against the repository root automatically.
    try {
      const [pRes, aRes] = await Promise.all([
        fetch('data/projects.json'),
        fetch('data/associations.json')
      ]);
      if (!pRes.ok || !aRes.ok) throw new Error('Fetch failed');
      allProjects      = await pRes.json();
      allAssociations  = await aRes.json();
    } catch (err) {
      console.error('[spiral] Failed to load data:', err);
      if (loadingEl) loadingEl.style.display = 'none';
      if (emptyEl) {
        emptyEl.querySelector('strong').textContent = 'Could not load project data.';
        emptyEl.querySelector('p').textContent = 'Check that data/projects.json and data/associations.json exist.';
        emptyEl.style.display = 'block';
      }
      return;
    }

    if (loadingEl) loadingEl.style.display = 'none';

    populateFilters();
    buildLayout();
    scheduleRender();
  }

  // ---- Canvas setup -------------------------------------------------------------

  function setupCanvas() {
    resizeCanvas();
    window.addEventListener('resize', () => { resizeCanvas(); scheduleRender(); });
  }

  function resizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    const wrap = canvas.parentElement;
    const w = wrap.clientWidth  || window.innerWidth;
    const h = wrap.clientHeight || window.innerHeight;
    canvas.width  = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    // Reset transform then apply DPR scale once.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    needRender = true;
  }

  // Logical canvas dimensions (CSS pixels).
  function cw() { return canvas.width  / dpr; }
  function ch() { return canvas.height / dpr; }

  // ---- Layout -------------------------------------------------------------------

  function buildLayout() {
    const filtered = filteredProjects();

    if (filtered.length === 0) {
      nodes = [];
      nodeMap = {};
      adjacency = {};
      edges = [];
      if (emptyEl) emptyEl.style.display = 'block';
      needRender = true;
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    // Sort by track (so same-track projects get consecutive spiral indices →
    // they naturally form arc-cluster segments) then by id for determinism.
    const sorted = [...filtered].sort((a, b) => {
      const ai = TRACK_ORDER.indexOf(a.track);
      const bi = TRACK_ORDER.indexOf(b.track);
      return ai !== bi ? ai - bi : a.id.localeCompare(b.id);
    });

    nodes = sorted.map((project, i) => {
      const angle    = i * GOLDEN_ANGLE;
      const r        = LAYOUT_SCALE * Math.sqrt(i + 1);
      const progress = project.goal > 0 ? project.raised / project.goal : 0;
      const size     = 6 + Math.min(progress, 1) * 7;
      return {
        ...project,
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        size
      };
    });

    // Rebuild lookup maps.
    nodeMap = {};
    nodes.forEach(n => { nodeMap[n.id] = n; });

    adjacency = {};
    nodes.forEach(n => { adjacency[n.id] = new Set(); });

    const visibleIds = new Set(nodes.map(n => n.id));
    edges = allAssociations
      .filter(a => visibleIds.has(a.source) && visibleIds.has(a.target))
      .map(a => {
        adjacency[a.source].add(a.target);
        adjacency[a.target].add(a.source);
        return { source: nodeMap[a.source], target: nodeMap[a.target], type: a.type };
      });

    needRender = true;
  }

  function filteredProjects() {
    return allProjects.filter(p => {
      const okTrack  = filterTrack  === 'all' || p.track  === filterTrack;
      const okStatus = filterStatus === 'all' || p.status === filterStatus;
      return okTrack && okStatus;
    });
  }

  // ---- Render loop --------------------------------------------------------------

  function scheduleRender() {
    needRender = true;
    if (!rafId) rafId = requestAnimationFrame(onAnimFrame);
  }

  function onAnimFrame() {
    rafId = null;
    if (needRender) {
      render();
      needRender = false;
    }
  }

  function render() {
    const W = cw();
    const H = ch();

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, H);

    // Subtle star field (deterministic by using fixed positions).
    drawStarField(W, H);

    if (nodes.length === 0) return;

    ctx.save();
    // World origin at centre of viewport.
    ctx.translate(W / 2 + pan.x, H / 2 + pan.y);
    ctx.scale(zoom, zoom);

    if (showAssoc) drawEdges();
    drawNodes();

    ctx.restore();

    // Track cluster labels at low zoom.
    if (zoom < 1.2) drawClusterLabels(W, H);
  }

  // ---- Star field ---------------------------------------------------------------

  const STARS = (function () {
    const s = [];
    // Seeded simple LCG for determinism.
    let seed = 0x9e3779b9;
    function rand() {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0x100000000;
    }
    for (let i = 0; i < 180; i++) {
      s.push({ x: rand(), y: rand(), r: rand() * 1.2 + 0.3, a: rand() * 0.35 + 0.15 });
    }
    return s;
  }());

  function drawStarField(W, H) {
    ctx.save();
    STARS.forEach(s => {
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(226,232,240,${s.a})`;
      ctx.fill();
    });
    ctx.restore();
  }

  // ---- Edges --------------------------------------------------------------------

  function drawEdges() {
    ctx.save();
    edges.forEach(({ source, target, type }) => {
      const selId = selectedNode?.id;

      // In focus mode only draw edges touching the selected node.
      if (focusMode && selId) {
        if (source.id !== selId && target.id !== selId) return;
      }

      const isHighlighted = focusMode && selId &&
        (source.id === selId || target.id === selId);

      const sameTrack = source.track === target.track;
      const color = sameTrack
        ? (TRACK_COLORS[source.track] || '#94a3b8')
        : '#94a3b8';
      const alpha = isHighlighted ? 0.62 : (focusMode ? 0.04 : 0.16);

      // Quadratic bezier with slight curvature.
      const mx = (source.x + target.x) / 2;
      const my = (source.y + target.y) / 2;
      const dx = target.x - source.x;
      const dy = target.y - source.y;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.quadraticCurveTo(mx - dy * 0.12, my + dx * 0.12, target.x, target.y);
      ctx.strokeStyle = hexAlpha(color, alpha);
      ctx.lineWidth = (isHighlighted ? 1.4 : 0.7) / zoom;
      ctx.stroke();
    });
    ctx.restore();
  }

  // ---- Nodes --------------------------------------------------------------------

  function drawNodes() {
    nodes.forEach(node => {
      const isHovered  = hoveredNode?.id  === node.id;
      const isSelected = selectedNode?.id === node.id;
      const connected  = focusMode && selectedNode && adjacency[node.id]?.has(selectedNode.id);
      const isDimmed   = focusMode && selectedNode && !isSelected && !connected;

      const color   = TRACK_COLORS[node.track] || '#94a3b8';
      const alpha   = isDimmed ? 0.13 : 1;
      const visSize = (isHovered || isSelected) ? node.size * 1.3 : node.size;

      // Outer glow for hovered / selected.
      if ((isHovered || isSelected) && !isDimmed) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, visSize * 2.6, 0, Math.PI * 2);
        ctx.fillStyle = hexAlpha(color, 0.08);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(node.x, node.y, visSize * 1.6, 0, Math.PI * 2);
        ctx.fillStyle = hexAlpha(color, 0.14);
        ctx.fill();
      }

      // Main filled circle.
      ctx.beginPath();
      ctx.arc(node.x, node.y, visSize, 0, Math.PI * 2);
      ctx.fillStyle = hexAlpha(color, alpha * 0.75);
      ctx.fill();

      // Border ring.
      ctx.strokeStyle = hexAlpha(color, alpha);
      ctx.lineWidth   = (isSelected ? 2 : 1) / zoom;
      ctx.stroke();

      // Funding progress arc (outside node ring).
      if (node.goal > 0 && alpha > 0.25) {
        const progress = Math.min(node.raised / node.goal, 1);
        if (progress > 0) {
          ctx.beginPath();
          ctx.arc(
            node.x, node.y,
            visSize + 3.5 / zoom,
            -Math.PI / 2,
            -Math.PI / 2 + progress * Math.PI * 2
          );
          ctx.strokeStyle = hexAlpha(color, alpha * 0.5);
          ctx.lineWidth   = 2 / zoom;
          ctx.stroke();
        }
      }

      // Status indicator dot (top-right of node).
      const sdot = STATUS_COLORS[node.status] || '#94a3b8';
      ctx.beginPath();
      ctx.arc(
        node.x + visSize * 0.65,
        node.y - visSize * 0.65,
        Math.max(1.8, 2.8 / zoom),
        0, Math.PI * 2
      );
      ctx.fillStyle = hexAlpha(sdot, alpha);
      ctx.fill();

      // Node label — shown when zoomed in or when this node is active.
      if ((zoom > 1.9 || isSelected || isHovered) && !isDimmed) {
        ctx.fillStyle  = hexAlpha('#e5e7eb', alpha * 0.92);
        ctx.font       = `${Math.max(9, 10.5 / zoom)}px Inter, system-ui, sans-serif`;
        ctx.textAlign  = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(node.name, node.x, node.y + visSize + (5 / zoom));
        ctx.textBaseline = 'alphabetic';
      }
    });
  }

  // ---- Cluster labels -----------------------------------------------------------

  function drawClusterLabels(W, H) {
    // Compute centroid per track in screen space.
    const centroids = {};
    nodes.forEach(n => {
      if (!centroids[n.track]) centroids[n.track] = { sx: 0, sy: 0, count: 0 };
      const c   = centroids[n.track];
      // World → screen.
      c.sx    += n.x * zoom + W / 2 + pan.x;
      c.sy    += n.y * zoom + H / 2 + pan.y;
      c.count += 1;
    });

    ctx.save();
    Object.entries(centroids).forEach(([track, c]) => {
      const sx = c.sx / c.count;
      const sy = c.sy / c.count;
      const color = TRACK_COLORS[track] || '#94a3b8';

      ctx.font      = 'bold 11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = hexAlpha(color, 0.55);
      ctx.fillText(track, sx, sy);
    });
    ctx.restore();
  }

  // ---- Hit testing --------------------------------------------------------------

  function hitTest(mx, my) {
    const W  = cw();
    const H  = ch();
    const wx = (mx - W / 2 - pan.x) / zoom;
    const wy = (my - H / 2 - pan.y) / zoom;

    let best     = null;
    let bestDist = Infinity;

    nodes.forEach(node => {
      const dx    = node.x - wx;
      const dy    = node.y - wy;
      const dist  = Math.sqrt(dx * dx + dy * dy);
      const hitR  = node.size * 1.4 + 6 / zoom;
      if (dist < hitR && dist < bestDist) {
        best     = node;
        bestDist = dist;
      }
    });
    return best;
  }

  // ---- Events -------------------------------------------------------------------

  function bindEvents() {
    canvas.addEventListener('mousemove',  onMouseMove);
    canvas.addEventListener('mousedown',  onMouseDown);
    canvas.addEventListener('mouseup',    onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('click',      onClick);
    canvas.addEventListener('dblclick',   onDblClick);
    canvas.addEventListener('wheel',      onWheel, { passive: false });

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   onTouchEnd);

    assocBtn?.addEventListener('click', () => {
      showAssoc = !showAssoc;
      assocBtn.setAttribute('aria-pressed', String(showAssoc));
      assocBtn.classList.toggle('active', showAssoc);
      scheduleRender();
    });

    focusBtn?.addEventListener('click', () => {
      focusMode = !focusMode;
      if (!focusMode) selectedNode = null;
      focusBtn.setAttribute('aria-pressed', String(focusMode));
      focusBtn.classList.toggle('active', focusMode);
      if (!focusMode) closeDetails();
      scheduleRender();
    });

    resetBtn?.addEventListener('click', resetView);

    trackSel?.addEventListener('change', () => {
      filterTrack = trackSel.value;
      buildLayout();
      scheduleRender();
    });

    statusSel?.addEventListener('change', () => {
      filterStatus = statusSel.value;
      buildLayout();
      scheduleRender();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeDetails();
    });
  }

  // ---- Mouse events -------------------------------------------------------------

  function onMouseMove(e) {
    const { mx, my } = mousePos(e);
    if (isPanning) {
      pan.x += mx - panLast.x;
      pan.y += my - panLast.y;
      panLast = { x: mx, y: my };
      scheduleRender();
      return;
    }
    const hit = hitTest(mx, my);
    if (hit !== hoveredNode) {
      hoveredNode = hit;
      canvas.style.cursor = hit ? 'pointer' : 'grab';
      hit ? showTooltip(hit, mx, my) : hideTooltip();
      scheduleRender();
    } else if (hit) {
      moveTooltip(mx, my);
    }
    panLast = { x: mx, y: my };
  }

  function onMouseDown(e) {
    const { mx, my } = mousePos(e);
    isPanning = true;
    panLast   = { x: mx, y: my };
    canvas.style.cursor = 'grabbing';
  }

  function onMouseUp() {
    isPanning = false;
    canvas.style.cursor = hoveredNode ? 'pointer' : 'grab';
  }

  function onMouseLeave() {
    isPanning  = false;
    hoveredNode = null;
    hideTooltip();
    scheduleRender();
  }

  function onClick(e) {
    const { mx, my } = mousePos(e);
    const hit = hitTest(mx, my);
    if (hit) {
      selectNode(hit);
    } else if (focusMode) {
      exitFocus();
    }
  }

  function onDblClick() {
    resetView();
  }

  function onWheel(e) {
    e.preventDefault();
    const { mx, my } = mousePos(e);
    const factor  = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = clamp(zoom * factor, 0.1, 10);
    const W = cw();
    const H = ch();
    // Zoom toward the cursor position in world space.
    const worldX = (mx - W / 2 - pan.x) / zoom;
    const worldY = (my - H / 2 - pan.y) / zoom;
    pan.x = mx - W / 2 - worldX * newZoom;
    pan.y = my - H / 2 - worldY * newZoom;
    zoom = newZoom;
    scheduleRender();
  }

  // ---- Touch events -------------------------------------------------------------

  function onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      isPanning  = true;
      touchPrev  = touch1(e);
      panLast    = touchPrev;
    } else if (e.touches.length === 2) {
      touchPinchDist = pinchDist(e);
    }
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && isPanning) {
      const cur = touch1(e);
      pan.x += cur.x - panLast.x;
      pan.y += cur.y - panLast.y;
      panLast = cur;
      scheduleRender();
    } else if (e.touches.length === 2) {
      const d = pinchDist(e);
      if (touchPinchDist && d > 0) {
        zoom = clamp(zoom * (d / touchPinchDist), 0.1, 10);
        touchPinchDist = d;
        scheduleRender();
      }
    }
  }

  function onTouchEnd() {
    isPanning      = false;
    touchPrev      = null;
    touchPinchDist = null;
  }

  function touch1(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
  }

  function pinchDist(e) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ---- Focus / select -----------------------------------------------------------

  function selectNode(node) {
    selectedNode = node;
    focusMode    = true;
    focusBtn?.classList.add('active');
    focusBtn?.setAttribute('aria-pressed', 'true');
    showDetails(node);
    scheduleRender();
  }

  function exitFocus() {
    focusMode    = false;
    selectedNode = null;
    focusBtn?.classList.remove('active');
    focusBtn?.setAttribute('aria-pressed', 'false');
    closeDetails();
    scheduleRender();
  }

  function resetView() {
    pan   = { x: 0, y: 0 };
    zoom  = 1;
    exitFocus();
  }

  // ---- Tooltip ------------------------------------------------------------------

  function showTooltip(node, mx, my) {
    if (!tooltipEl) return;
    const progress = node.goal > 0 ? Math.round((node.raised / node.goal) * 100) : 0;
    const connCount = adjacency[node.id] ? adjacency[node.id].size : 0;
    tooltipEl.innerHTML =
      `<strong>${escHtml(node.name)}</strong>` +
      `<span class="tip-track" style="color:${TRACK_COLORS[node.track] || '#94a3b8'}">${escHtml(node.track)}</span>` +
      `<span>${capitalize(node.status)} &middot; ${progress}% funded</span>` +
      `<span>${node.stewards} steward${node.stewards !== 1 ? 's' : ''}` +
        (connCount ? ` &middot; ${connCount} connection${connCount !== 1 ? 's' : ''}` : '') +
      `</span>`;
    tooltipEl.classList.add('visible');
    moveTooltip(mx, my);
  }

  function moveTooltip(mx, my) {
    if (!tooltipEl) return;
    const W = cw();
    const H = ch();
    const offset = 16;
    const ttW = 230;
    const ttH = 80;
    const left = mx + offset + ttW > W ? mx - offset - ttW : mx + offset;
    const top  = my + offset + ttH > H ? my - offset - ttH : my + offset;
    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top  = top  + 'px';
  }

  function hideTooltip() {
    tooltipEl?.classList.remove('visible');
  }

  // ---- Details panel ------------------------------------------------------------

  function showDetails(node) {
    if (!detailsPanel || !detailsContentEl) return;
    const fmt = v => new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0
    }).format(v);
    const progress  = node.goal > 0 ? Math.round((node.raised / node.goal) * 100) : 0;
    const color     = TRACK_COLORS[node.track] || '#94a3b8';
    const connected = adjacency[node.id]
      ? [...adjacency[node.id]].map(id => nodeMap[id]).filter(Boolean)
      : [];

    const repoLink    = node.repoUrl
      ? `<a href="${escAttr(node.repoUrl)}" target="_blank" rel="noreferrer">Repository ↗</a>` : '';
    const artizenLink = node.artizenUrl
      ? `<a href="${escAttr(node.artizenUrl)}" target="_blank" rel="noreferrer">Artizen ↗</a>` : '';

    const connHtml = connected.length
      ? `<div class="details-connections">
          <h3>Connections (${connected.length})</h3>
          <ul>${connected.map(n =>
            `<li style="border-left:3px solid ${TRACK_COLORS[n.track] || '#94a3b8'}">${escHtml(n.name)}</li>`
          ).join('')}</ul>
        </div>` : '';

    const linksHtml = (repoLink || artizenLink)
      ? `<div class="details-links">${repoLink}${artizenLink}</div>` : '';

    detailsContentEl.innerHTML =
      `<p class="details-track" style="color:${color}">${escHtml(node.track)}</p>` +
      `<h2 class="details-title">${escHtml(node.name)}</h2>` +
      `<p class="details-desc">${escHtml(node.description || '')}</p>` +
      `<div class="details-meta">` +
        `<span class="badge badge-${node.status}">${capitalize(node.status)}</span>` +
        `<span>${node.stewards} steward${node.stewards !== 1 ? 's' : ''}</span>` +
        `<span>Updated ${escHtml(node.lastUpdate)}</span>` +
      `</div>` +
      `<div class="details-funding">` +
        `<div class="funding-bar-track">` +
          `<div class="funding-bar-fill" style="width:${progress}%;background:${color}"></div>` +
        `</div>` +
        `<p>${fmt(node.raised)} / ${fmt(node.goal)} &middot; ${progress}%</p>` +
      `</div>` +
      connHtml +
      linksHtml;

    detailsPanel.classList.add('open');
    detailsPanel.setAttribute('aria-hidden', 'false');
  }

  function closeDetails() {
    detailsPanel?.classList.remove('open');
    detailsPanel?.setAttribute('aria-hidden', 'true');
    selectedNode = null;
    focusMode    = false;
    focusBtn?.classList.remove('active');
    focusBtn?.setAttribute('aria-pressed', 'false');
    scheduleRender();
  }

  // ---- Filters ------------------------------------------------------------------

  function populateFilters() {
    if (!trackSel || !statusSel) return;

    const tracks = TRACK_ORDER.filter(t => allProjects.some(p => p.track === t));
    tracks.forEach(t => {
      const o = document.createElement('option');
      o.value       = t;
      o.textContent = t;
      trackSel.appendChild(o);
    });

    const statuses = Object.keys(STATUS_COLORS);
    statuses.forEach(s => {
      const o = document.createElement('option');
      o.value       = s;
      o.textContent = capitalize(s);
      statusSel.appendChild(o);
    });
  }

  // ---- Utilities ----------------------------------------------------------------

  function mousePos(e) {
    const r = canvas.getBoundingClientRect();
    return { mx: e.clientX - r.left, my: e.clientY - r.top };
  }

  function hexAlpha(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escAttr(s) {
    return String(s).replace(/"/g, '%22');
  }

  // ---- Boot ---------------------------------------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
