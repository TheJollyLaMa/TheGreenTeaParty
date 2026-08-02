/**
 * spiral.js — Branch Constellation Exploration View
 * The Green Tea Party Fund · v0.33
 */

(function () {
  'use strict';

  // ---- Constants ----------------------------------------------------------------

  const TRACK_COLORS = {
    'Green Tea': '#22c55e',
    'Blue Tea': '#3b82f6',
    'Red Rice': '#ef4444',
    'Purple Sage': '#a855f7',
    'Golden Root': '#f59e0b',
    'Silver Stream': '#94a3b8'
  };

  const TRACK_ORDER = Object.keys(TRACK_COLORS);

  const STATUS_COLORS = {
    active: '#22c55e',
    planning: '#f59e0b',
    completed: '#94a3b8',
    paused: '#ef4444'
  };

  const ASSOCIATION_PRIORITY = {
    'parent-child': 4,
    'shared-steward': 3,
    collaboration: 2,
    'funding-pool': 1.5,
    'research-link': 1,
    'same-track': 0.5
  };

  const MIN_ZOOM = 0.35;
  const MAX_ZOOM = 8;
  const FAR_LOD_ZOOM = 0.78;
  const NEAR_LOD_ZOOM = 1.8;
  const META_LOD_ZOOM = 2.65;
  const TRACK_RING_RADIUS = 270;
  const BASE_BRANCH_LENGTH = 92;
  const BRANCH_DECAY = 0.74;
  const BRANCH_SPREAD = Math.PI * 0.94;
  const VIEW_MARGIN = 120;
  const DRAG_THRESHOLD = 4;

  // ---- Application state --------------------------------------------------------

  let allProjects = [];
  let allAssociations = [];

  let nodes = [];
  let nodeMap = {};
  let adjacency = {};
  let relationTypes = {};
  let branchEdges = [];
  let relationEdges = [];
  let parentById = {};
  let childrenById = {};
  let subtreeSize = {};
  let descendantCache = {};
  let trackClusters = [];

  let pan = { x: 0, y: 0 };
  let zoom = 1;
  let homeCamera = { pan: { x: 0, y: 0 }, zoom: 1 };

  let pointerDown = false;
  let isPanning = false;
  let suppressClick = false;
  let panLast = { x: 0, y: 0 };
  let pointerStart = { x: 0, y: 0 };

  let hoveredNode = null;
  let selectedNode = null;
  let focusMode = false;
  let showAssoc = true;
  let focusHistory = [];

  let filterTrack = 'all';
  let filterStatus = 'all';

  let rafId = null;
  let needRender = true;
  let dpr = 1;
  let cameraAnimation = null;

  let touchPrev = null;
  let touchPinchDist = null;

  // ---- DOM references -----------------------------------------------------------

  let canvas;
  let ctx;
  let tooltipEl;
  let detailsPanel;
  let detailsContentEl;
  let assocBtn;
  let focusBtn;
  let resetBtn;
  let zoomInBtn;
  let zoomOutBtn;
  let backBtn;
  let closeDetailsBtn;
  let breadcrumbsEl;
  let trackSel;
  let statusSel;
  let loadingEl;
  let emptyEl;

  // ---- Initialisation -----------------------------------------------------------

  async function init() {
    canvas = document.getElementById('spiral-canvas');
    ctx = canvas.getContext('2d');
    tooltipEl = document.getElementById('spiral-tooltip');
    detailsPanel = document.getElementById('details-panel');
    detailsContentEl = document.getElementById('details-content');
    assocBtn = document.getElementById('toggle-assoc');
    focusBtn = document.getElementById('toggle-focus');
    resetBtn = document.getElementById('reset-view');
    zoomInBtn = document.getElementById('zoom-in');
    zoomOutBtn = document.getElementById('zoom-out');
    backBtn = document.getElementById('focus-back');
    closeDetailsBtn = document.getElementById('close-details');
    breadcrumbsEl = document.getElementById('spiral-breadcrumbs');
    trackSel = document.getElementById('spiral-track-filter');
    statusSel = document.getElementById('spiral-status-filter');
    loadingEl = document.getElementById('spiral-loading');
    emptyEl = document.getElementById('spiral-empty');

    setupCanvas();
    bindEvents();

    try {
      // Use the shared data layer when available, otherwise fall back to own fetch.
      if (typeof GTPData !== 'undefined') {
        await GTPData.load();
        allProjects = GTPData.getProjects();
        allAssociations = GTPData.getAssociations();
      } else {
        const [pRes, aRes] = await Promise.all([
          fetch('data/projects.json'),
          fetch('data/associations.json')
        ]);
        if (!pRes.ok || !aRes.ok) throw new Error('Fetch failed');
        allProjects = await pRes.json();
        allAssociations = await aRes.json();
      }
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
    applyHomeCamera(false);
    updateBreadcrumbs();
    updateBackButton();
    scheduleRender();
  }

  // ---- Canvas setup -------------------------------------------------------------

  function setupCanvas() {
    resizeCanvas();
    window.addEventListener('resize', () => {
      resizeCanvas();
      homeCamera = computeHomeCamera();
      scheduleRender();
    });
  }

  function resizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    const wrap = canvas.parentElement;
    const w = wrap.clientWidth || window.innerWidth;
    const h = wrap.clientHeight || window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    needRender = true;
  }

  function cw() {
    return canvas.width / dpr;
  }

  function ch() {
    return canvas.height / dpr;
  }

  // ---- Layout -------------------------------------------------------------------

  function buildLayout() {
    const filtered = filteredProjects();

    if (filtered.length === 0) {
      nodes = [];
      nodeMap = {};
      adjacency = {};
      relationTypes = {};
      branchEdges = [];
      relationEdges = [];
      parentById = {};
      childrenById = {};
      subtreeSize = {};
      descendantCache = {};
      trackClusters = [];
      if (selectedNode) closeDetails({ clearSelection: true });
      if (emptyEl) emptyEl.style.display = 'block';
      needRender = true;
      updateBreadcrumbs();
      updateBackButton();
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    const sorted = [...filtered].sort((a, b) => {
      const ai = TRACK_ORDER.indexOf(a.track);
      const bi = TRACK_ORDER.indexOf(b.track);
      return ai !== bi ? ai - bi : a.id.localeCompare(b.id);
    });

    nodes = sorted.map((project) => {
      const progress = project.goal > 0 ? project.raised / project.goal : 0;
      const size = 6 + Math.min(progress, 1) * 7;
      return {
        ...project,
        x: 0,
        y: 0,
        size,
        degree: 0,
        depth: 0,
        trackIndex: TRACK_ORDER.indexOf(project.track),
        screenX: 0,
        screenY: 0
      };
    });

    nodeMap = {};
    nodes.forEach((node) => {
      nodeMap[node.id] = node;
    });

    adjacency = {};
    childrenById = {};
    relationTypes = {};
    nodes.forEach((node) => {
      adjacency[node.id] = new Set();
      childrenById[node.id] = [];
    });

    const visibleIds = new Set(nodes.map((node) => node.id));
    relationEdges = allAssociations
      .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
      .map((edge) => {
        adjacency[edge.source].add(edge.target);
        adjacency[edge.target].add(edge.source);
        relationTypes[relationKey(edge.source, edge.target)] = edge.type;
        return {
          source: nodeMap[edge.source],
          target: nodeMap[edge.target],
          type: edge.type,
          priority: associationPriority(edge.type)
        };
      });

    nodes.forEach((node) => {
      node.degree = adjacency[node.id].size;
    });

    parentById = {};
    subtreeSize = {};
    descendantCache = {};
    trackClusters = [];

    const groups = TRACK_ORDER
      .map((track) => nodes.filter((node) => node.track === track))
      .filter((group) => group.length > 0);

    groups.forEach((group, index) => buildTrackHierarchy(group, index, groups.length));
    groups.forEach((group) => {
      const rootId = trackClusters.find((cluster) => cluster.track === group[0].track)?.rootId;
      if (rootId) {
        computeSubtreeSize(rootId);
        buildDescendantCache(rootId);
      }
    });

    trackClusters.forEach((cluster, index) => {
      const root = nodeMap[cluster.rootId];
      if (!root) return;
      const angle = groups.length === 1 ? -Math.PI / 2 : -Math.PI / 2 + (Math.PI * 2 * index) / groups.length;
      const hubRadius = groups.length === 1 ? 0 : TRACK_RING_RADIUS;
      const hubX = Math.cos(angle) * hubRadius;
      const hubY = Math.sin(angle) * hubRadius;
      cluster.x = hubX;
      cluster.y = hubY;
      placeBranch(root.id, hubX, hubY, angle, BRANCH_SPREAD, 0);
    });

    branchEdges = Object.entries(parentById)
      .filter(([, parentId]) => Boolean(parentId))
      .map(([childId, parentId]) => ({
        parent: nodeMap[parentId],
        child: nodeMap[childId]
      }))
      .filter((edge) => edge.parent && edge.child);

    homeCamera = computeHomeCamera();

    if (selectedNode && nodeMap[selectedNode.id]) {
      selectedNode = nodeMap[selectedNode.id];
      if (focusMode) showDetails(selectedNode);
    } else if (selectedNode) {
      closeDetails({ clearSelection: true });
      focusHistory = [];
    }

    updateBreadcrumbs();
    updateBackButton();
    needRender = true;
  }

  function buildTrackHierarchy(group, groupIndex, groupCount) {
    const root = chooseTrackRoot(group);
    const assigned = new Set([root.id]);
    const queue = [root.id];
    parentById[root.id] = null;

    while (queue.length) {
      const currentId = queue.shift();
      const childIds = sortedTrackNeighbours(currentId)
        .filter((id) => nodeMap[id]?.track === root.track)
        .filter((id) => !assigned.has(id));

      childIds.forEach((childId) => {
        assigned.add(childId);
        parentById[childId] = currentId;
        childrenById[currentId].push(childId);
        queue.push(childId);
      });
    }

    group
      .filter((node) => !assigned.has(node.id))
      .sort(compareNodePriority)
      .forEach((node) => {
        const parentId = findFallbackParent(node, group, assigned, root.id);
        assigned.add(node.id);
        parentById[node.id] = parentId;
        childrenById[parentId].push(node.id);
      });

    sortChildren(root.id);

    trackClusters.push({
      track: root.track,
      rootId: root.id,
      count: group.length,
      index: groupIndex,
      total: groupCount,
      x: 0,
      y: 0
    });
  }

  function chooseTrackRoot(group) {
    return [...group].sort(compareNodePriority)[0];
  }

  function compareNodePriority(a, b) {
    const degreeDiff = b.degree - a.degree;
    if (degreeDiff) return degreeDiff;
    const stewardDiff = (b.stewards || 0) - (a.stewards || 0);
    if (stewardDiff) return stewardDiff;
    const fundedDiff = (b.raised || 0) - (a.raised || 0);
    if (fundedDiff) return fundedDiff;
    return a.id.localeCompare(b.id);
  }

  function sortedTrackNeighbours(nodeId) {
    const source = nodeMap[nodeId];
    if (!source) return [];
    return [...(adjacency[nodeId] || [])].sort((aId, bId) => {
      const a = nodeMap[aId];
      const b = nodeMap[bId];
      const aTrackBonus = a?.track === source.track ? 1 : 0;
      const bTrackBonus = b?.track === source.track ? 1 : 0;
      if (bTrackBonus !== aTrackBonus) return bTrackBonus - aTrackBonus;
      const pa = associationPriority(relationTypes[relationKey(nodeId, aId)]);
      const pb = associationPriority(relationTypes[relationKey(nodeId, bId)]);
      if (pb !== pa) return pb - pa;
      const degreeDiff = (nodeMap[bId]?.degree || 0) - (nodeMap[aId]?.degree || 0);
      if (degreeDiff) return degreeDiff;
      return aId.localeCompare(bId);
    });
  }

  function findFallbackParent(node, group, assigned, rootId) {
    const sameTrackAssigned = group.filter((candidate) => assigned.has(candidate.id));
    const associated = sortedTrackNeighbours(node.id).find((candidateId) => assigned.has(candidateId));
    if (associated) return associated;
    const byIndex = [...sameTrackAssigned].sort((a, b) => {
      const ai = Math.abs(a.id.localeCompare(node.id));
      const bi = Math.abs(b.id.localeCompare(node.id));
      return ai - bi || compareNodePriority(a, b);
    })[0];
    return byIndex ? byIndex.id : rootId;
  }

  function sortChildren(nodeId) {
    const children = childrenById[nodeId] || [];
    children.sort((aId, bId) => {
      const ap = associationPriority(relationTypes[relationKey(nodeId, aId)] || 'same-track');
      const bp = associationPriority(relationTypes[relationKey(nodeId, bId)] || 'same-track');
      if (bp !== ap) return bp - ap;
      return compareNodePriority(nodeMap[aId], nodeMap[bId]);
    });
    children.forEach(sortChildren);
  }

  function computeSubtreeSize(nodeId) {
    const children = childrenById[nodeId] || [];
    const total = 1 + children.reduce((sum, childId) => sum + computeSubtreeSize(childId), 0);
    subtreeSize[nodeId] = total;
    return total;
  }

  function buildDescendantCache(nodeId) {
    const children = childrenById[nodeId] || [];
    const ids = [];
    children.forEach((childId) => {
      ids.push(childId);
      buildDescendantCache(childId);
      ids.push(...(descendantCache[childId] || []));
    });
    descendantCache[nodeId] = ids;
  }

  function placeBranch(nodeId, x, y, angle, spread, depth) {
    const node = nodeMap[nodeId];
    if (!node) return;

    node.x = x;
    node.y = y;
    node.depth = depth;

    const children = childrenById[nodeId] || [];
    if (!children.length) return;

    const offsets = angleOffsets(children.length, depth === 0 ? spread * 0.54 : spread * 0.7);
    const baseLength = BASE_BRANCH_LENGTH * Math.pow(BRANCH_DECAY, depth);

    children.forEach((childId, index) => {
      const child = nodeMap[childId];
      if (!child) return;
      const bias = (stableUnit(childId) - 0.5) * 0.2;
      const childAngle = angle + offsets[index] + bias;
      const weightBoost = 1 + Math.min((subtreeSize[childId] || 1) * 0.035, 0.34);
      const length = baseLength * weightBoost;
      const childX = x + Math.cos(childAngle) * length;
      const childY = y + Math.sin(childAngle) * length;
      placeBranch(childId, childX, childY, childAngle, Math.max(0.34, spread * 0.7), depth + 1);
    });
  }

  function angleOffsets(count, spread) {
    if (count === 1) return [0];
    const offsets = [];
    const step = spread / Math.max(1, count - 1);
    for (let i = 0; i < count; i += 1) {
      offsets.push(-spread / 2 + step * i);
    }
    return offsets;
  }

  function filteredProjects() {
    return allProjects.filter((project) => {
      const okTrack = filterTrack === 'all' || project.track === filterTrack;
      const okStatus = filterStatus === 'all' || project.status === filterStatus;
      return okTrack && okStatus;
    });
  }

  // ---- Render loop --------------------------------------------------------------

  function scheduleRender() {
    needRender = true;
    if (!rafId) rafId = requestAnimationFrame(onAnimFrame);
  }

  function onAnimFrame(now) {
    rafId = null;
    const animating = stepCameraAnimation(now);
    if (needRender || animating) {
      render();
      needRender = false;
    }
    if (animating || needRender) {
      rafId = requestAnimationFrame(onAnimFrame);
    }
  }

  function render() {
    const W = cw();
    const H = ch();
    const lod = currentLod();
    const world = worldBounds(VIEW_MARGIN / zoom);
    const focusContext = focusContextIds();

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, H);
    drawStarField(W, H);

    if (!nodes.length) return;

    ctx.save();
    ctx.translate(W / 2 + pan.x, H / 2 + pan.y);
    ctx.scale(zoom, zoom);

    drawTrackHubs(lod, focusContext, world);
    drawBranchEdges(lod, focusContext, world);
    if (showAssoc && lod !== 'far') drawAssociationEdges(focusContext, world);
    drawNodes(lod, focusContext, world);

    ctx.restore();
  }

  function currentLod() {
    if (zoom < FAR_LOD_ZOOM) return 'far';
    if (zoom < NEAR_LOD_ZOOM) return 'mid';
    return 'near';
  }

  // ---- Star field ---------------------------------------------------------------

  const STARS = (function () {
    const stars = [];
    let seed = 0x9e3779b9;
    function rand() {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0x100000000;
    }
    for (let i = 0; i < 180; i += 1) {
      stars.push({ x: rand(), y: rand(), r: rand() * 1.2 + 0.3, a: rand() * 0.35 + 0.15 });
    }
    return stars;
  }());

  function drawStarField(W, H) {
    ctx.save();
    STARS.forEach((star) => {
      ctx.beginPath();
      ctx.arc(star.x * W, star.y * H, star.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(226,232,240,${star.a})`;
      ctx.fill();
    });
    ctx.restore();
  }

  // ---- Edges --------------------------------------------------------------------

  function drawTrackHubs(lod, focusContext, world) {
    ctx.save();
    trackClusters.forEach((cluster) => {
      if (!pointInBounds(cluster.x, cluster.y, world, 90 / zoom)) return;
      const root = nodeMap[cluster.rootId];
      const selectedTrack = selectedNode?.track;
      const isDimmed = focusContext && selectedTrack && cluster.track !== selectedTrack;
      const alpha = isDimmed ? 0.16 : lod === 'far' ? 0.6 : 0.3;
      const color = TRACK_COLORS[cluster.track] || '#94a3b8';
      const radius = lod === 'far' ? 24 : 16;

      ctx.beginPath();
      ctx.arc(cluster.x, cluster.y, radius / zoom, 0, Math.PI * 2);
      ctx.fillStyle = hexAlpha(color, alpha * 0.35);
      ctx.fill();
      ctx.strokeStyle = hexAlpha(color, alpha);
      ctx.lineWidth = (lod === 'far' ? 2.5 : 1.4) / zoom;
      ctx.stroke();

      if (lod === 'far') {
        ctx.fillStyle = hexAlpha('#e5e7eb', isDimmed ? 0.4 : 0.82);
        ctx.font = `${Math.max(9, 12 / zoom)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(cluster.track, cluster.x, cluster.y - 11 / zoom);
        ctx.fillStyle = hexAlpha('#cbd5e1', isDimmed ? 0.3 : 0.65);
        ctx.font = `${Math.max(8, 10 / zoom)}px Inter, system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(`${cluster.count} projects`, cluster.x, cluster.y + 9 / zoom);
      } else if (root && root.depth === 0) {
        ctx.fillStyle = hexAlpha(color, isDimmed ? 0.25 : 0.45);
        ctx.font = `${Math.max(8, 10 / zoom)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(cluster.track, cluster.x, cluster.y - 16 / zoom);
      }
    });
    ctx.restore();
  }

  function drawBranchEdges(lod, focusContext, world) {
    ctx.save();
    branchEdges.forEach(({ parent, child }) => {
      if (!edgeVisible(parent, child, world)) return;
      const isContext = !focusContext || focusContext.has(parent.id) || focusContext.has(child.id);
      if (!isContext && focusMode) return;

      const color = TRACK_COLORS[parent.track] || '#94a3b8';
      const alpha = focusContext && !isContext ? 0.06 : lod === 'far' ? 0.42 : 0.28;
      const bend = 0.18 + (stableUnit(`${parent.id}:${child.id}`) * 0.18);
      const mx = (parent.x + child.x) / 2;
      const my = (parent.y + child.y) / 2;
      const dx = child.x - parent.x;
      const dy = child.y - parent.y;

      ctx.beginPath();
      ctx.moveTo(parent.x, parent.y);
      ctx.quadraticCurveTo(mx - dy * bend, my + dx * bend, child.x, child.y);
      ctx.strokeStyle = hexAlpha(color, alpha);
      ctx.lineWidth = (lod === 'far' ? 2.2 : 1.8) / zoom;
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawAssociationEdges(focusContext, world) {
    ctx.save();
    relationEdges.forEach(({ source, target, type, priority }) => {
      if (!edgeVisible(source, target, world)) return;
      const touchesSelection = selectedNode && (source.id === selectedNode.id || target.id === selectedNode.id);
      const inFocusContext = !focusContext || focusContext.has(source.id) || focusContext.has(target.id);
      if (focusMode && !touchesSelection && !inFocusContext) return;

      const sameTrack = source.track === target.track;
      const color = sameTrack ? (TRACK_COLORS[source.track] || '#94a3b8') : '#94a3b8';
      const alpha = touchesSelection ? 0.5 : focusMode ? 0.07 : 0.13;
      const bend = 0.08 + priority * 0.03;
      const mx = (source.x + target.x) / 2;
      const my = (source.y + target.y) / 2;
      const dx = target.x - source.x;
      const dy = target.y - source.y;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.quadraticCurveTo(mx - dy * bend, my + dx * bend, target.x, target.y);
      ctx.strokeStyle = hexAlpha(color, alpha);
      ctx.lineWidth = (touchesSelection ? 1.2 : 0.75) / zoom;
      ctx.setLineDash(type === 'research-link' ? [4 / zoom, 5 / zoom] : []);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ---- Nodes --------------------------------------------------------------------

  function drawNodes(lod, focusContext, world) {
    const labels = [];
    const visibleNodes = nodes
      .filter((node) => pointInBounds(node.x, node.y, world, node.size + 18 / zoom))
      .filter((node) => lod !== 'far' || node.depth <= 1 || hoveredNode?.id === node.id || selectedNode?.id === node.id)
      .sort((a, b) => a.depth - b.depth || a.size - b.size);

    visibleNodes.forEach((node) => {
      const isHovered = hoveredNode?.id === node.id;
      const isSelected = selectedNode?.id === node.id;
      const isContext = !focusContext || focusContext.has(node.id);
      const isDimmed = focusMode && !isContext && !isSelected;
      const color = TRACK_COLORS[node.track] || '#94a3b8';
      const alpha = isDimmed ? 0.16 : 1;
      const lodScale = lod === 'far' ? 0.9 : 1;
      const visSize = (isHovered || isSelected ? node.size * 1.28 : node.size) * lodScale;

      if ((isHovered || isSelected) && !isDimmed) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, visSize * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = hexAlpha(color, 0.08);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, visSize, 0, Math.PI * 2);
      ctx.fillStyle = hexAlpha(color, alpha * (lod === 'far' ? 0.55 : 0.74));
      ctx.fill();
      ctx.strokeStyle = hexAlpha(color, alpha);
      ctx.lineWidth = (isSelected ? 2.2 : node.depth === 0 ? 1.6 : 1) / zoom;
      ctx.stroke();

      if (lod !== 'far' && node.goal > 0 && alpha > 0.25) {
        const progress = Math.min(node.raised / node.goal, 1);
        if (progress > 0) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, visSize + 3.5 / zoom, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
          ctx.strokeStyle = hexAlpha(color, alpha * 0.48);
          ctx.lineWidth = 2 / zoom;
          ctx.stroke();
        }
      }

      if (lod !== 'far') {
        const sdot = STATUS_COLORS[node.status] || '#94a3b8';
        ctx.beginPath();
        ctx.arc(node.x + visSize * 0.64, node.y - visSize * 0.64, Math.max(1.8, 2.8 / zoom), 0, Math.PI * 2);
        ctx.fillStyle = hexAlpha(sdot, alpha);
        ctx.fill();
      }

      if (shouldDrawLabel(node, lod, isHovered, isSelected, isDimmed)) {
        drawNodeLabel(node, visSize, lod, alpha, labels);
      }
    });
  }

  function shouldDrawLabel(node, lod, isHovered, isSelected, isDimmed) {
    if (isDimmed) return false;
    if (isHovered || isSelected) return true;
    if (lod === 'far') return false;
    if (lod === 'mid') return node.depth <= 1 || node.degree >= 4;
    return node.depth <= 2 || node.degree >= 3 || node.size >= 10;
  }

  function drawNodeLabel(node, visSize, lod, alpha, labels) {
    const nameSize = Math.max(9, 11 / zoom);
    const metaSize = Math.max(8, 9 / zoom);
    const screen = worldToScreen(node.x, node.y);
    const lines = [node.name];

    if (lod === 'near' && zoom >= META_LOD_ZOOM) {
      const gap = Math.max(0, (node.goal || 0) - (node.raised || 0));
      lines.push(`${capitalize(node.status)} · ${gap > 0 ? `${shortCurrency(gap)} to go` : 'Goal met'}`);
      lines.push(shortActionLabel(node));
    } else if (lod === 'near') {
      lines.push(`${capitalize(node.status)} · ${Math.round(progressPct(node))}% funded`);
    }

    const widths = lines.map((line, index) => {
      ctx.font = `${index === 0 ? '600' : '400'} ${index === 0 ? nameSize : metaSize}px Inter, system-ui, sans-serif`;
      return ctx.measureText(line).width;
    });

    const width = Math.max(...widths) + 10;
    const lineHeight = zoom >= META_LOD_ZOOM && lod === 'near' ? 12 : 11;
    const height = lines.length * lineHeight + 2;
    const bounds = {
      left: screen.x - width / 2,
      right: screen.x + width / 2,
      top: screen.y + visSize * zoom + 8,
      bottom: screen.y + visSize * zoom + 8 + height
    };

    if (!reserveLabel(bounds, labels)) return;

    lines.forEach((line, index) => {
      ctx.fillStyle = hexAlpha(index === 0 ? '#f8fafc' : '#cbd5e1', alpha * (index === 0 ? 0.92 : 0.76));
      ctx.font = `${index === 0 ? '600' : '400'} ${index === 0 ? nameSize : metaSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(line, node.x, node.y + visSize + (6 + index * lineHeight) / zoom);
    });
    ctx.textBaseline = 'alphabetic';
  }

  function reserveLabel(bounds, labels) {
    const overlaps = labels.some((other) => !(bounds.right < other.left || bounds.left > other.right || bounds.bottom < other.top || bounds.top > other.bottom));
    if (overlaps) return false;
    labels.push(bounds);
    return true;
  }

  // ---- Hit testing --------------------------------------------------------------

  function hitTest(mx, my) {
    const world = screenToWorld(mx, my);
    let best = null;
    let bestDist = Infinity;

    nodes.forEach((node) => {
      const dx = node.x - world.x;
      const dy = node.y - world.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitR = node.size * 1.45 + 6 / zoom;
      if (dist < hitR && dist < bestDist) {
        best = node;
        bestDist = dist;
      }
    });

    return best;
  }

  // ---- Events -------------------------------------------------------------------

  function bindEvents() {
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    assocBtn?.addEventListener('click', () => {
      showAssoc = !showAssoc;
      assocBtn.setAttribute('aria-pressed', String(showAssoc));
      assocBtn.classList.toggle('active', showAssoc);
      scheduleRender();
    });

    focusBtn?.addEventListener('click', () => {
      if (focusMode) {
        exitFocus({ keepHistory: true });
      } else if (selectedNode && nodeMap[selectedNode.id]) {
        focusMode = true;
        focusBtn.setAttribute('aria-pressed', 'true');
        focusBtn.classList.add('active');
        showDetails(selectedNode);
        scheduleRender();
      }
    });

    resetBtn?.addEventListener('click', () => resetView(true));
    zoomInBtn?.addEventListener('click', () => zoomAtViewportCenter(1.25));
    zoomOutBtn?.addEventListener('click', () => zoomAtViewportCenter(0.8));
    backBtn?.addEventListener('click', goToPreviousFocus);
    closeDetailsBtn?.addEventListener('click', () => closeDetails({ clearSelection: true }));
    breadcrumbsEl?.addEventListener('click', onBreadcrumbClick);

    trackSel?.addEventListener('change', () => {
      filterTrack = trackSel.value;
      buildLayout();
      if (!selectedNode) applyHomeCamera(true);
      scheduleRender();
    });

    statusSel?.addEventListener('change', () => {
      filterStatus = statusSel.value;
      buildLayout();
      if (!selectedNode) applyHomeCamera(true);
      scheduleRender();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeDetails({ clearSelection: true });
      } else if (event.key === '+' || event.key === '=') {
        zoomAtViewportCenter(1.18);
      } else if (event.key === '-') {
        zoomAtViewportCenter(0.85);
      } else if (event.key === '0') {
        resetView(true);
      }
    });
  }

  // ---- Mouse events -------------------------------------------------------------

  function onMouseMove(event) {
    const { mx, my } = mousePos(event);

    if (pointerDown) {
      const moved = Math.hypot(mx - pointerStart.x, my - pointerStart.y) > DRAG_THRESHOLD;
      if (moved) {
        suppressClick = true;
        isPanning = true;
        pan.x += mx - panLast.x;
        pan.y += my - panLast.y;
        panLast = { x: mx, y: my };
        canvas.style.cursor = 'grabbing';
        scheduleRender();
        return;
      }
    }

    const hit = hitTest(mx, my);
    if (hit !== hoveredNode) {
      hoveredNode = hit;
      canvas.style.cursor = hit ? 'pointer' : 'grab';
      if (hit) showTooltip(hit, mx, my);
      else hideTooltip();
      scheduleRender();
    } else if (hit) {
      moveTooltip(mx, my);
    }

    panLast = { x: mx, y: my };
  }

  function onMouseDown(event) {
    const { mx, my } = mousePos(event);
    pointerDown = true;
    isPanning = false;
    suppressClick = false;
    pointerStart = { x: mx, y: my };
    panLast = { x: mx, y: my };
  }

  function onMouseUp() {
    pointerDown = false;
    isPanning = false;
    canvas.style.cursor = hoveredNode ? 'pointer' : 'grab';
  }

  function onMouseLeave() {
    pointerDown = false;
    isPanning = false;
    hoveredNode = null;
    hideTooltip();
    scheduleRender();
  }

  function onClick(event) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const { mx, my } = mousePos(event);
    const hit = hitTest(mx, my);
    if (hit) {
      focusNode(hit, { recordHistory: true, openDetails: true });
    } else if (focusMode) {
      exitFocus({ keepHistory: true });
    }
  }

  function onDblClick() {
    resetView(true);
  }

  function onWheel(event) {
    event.preventDefault();
    const { mx, my } = mousePos(event);
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAtScreenPoint(mx, my, factor);
  }

  // ---- Touch events -------------------------------------------------------------

  function onTouchStart(event) {
    event.preventDefault();
    if (event.touches.length === 1) {
      pointerDown = true;
      isPanning = true;
      touchPrev = touch1(event);
      panLast = touchPrev;
    } else if (event.touches.length === 2) {
      pointerDown = false;
      isPanning = false;
      touchPinchDist = pinchDist(event);
    }
  }

  function onTouchMove(event) {
    event.preventDefault();
    if (event.touches.length === 1 && isPanning) {
      const cur = touch1(event);
      pan.x += cur.x - panLast.x;
      pan.y += cur.y - panLast.y;
      panLast = cur;
      scheduleRender();
    } else if (event.touches.length === 2) {
      const dist = pinchDist(event);
      if (touchPinchDist && dist > 0) {
        const rect = canvas.getBoundingClientRect();
        const mx = ((event.touches[0].clientX + event.touches[1].clientX) / 2) - rect.left;
        const my = ((event.touches[0].clientY + event.touches[1].clientY) / 2) - rect.top;
        zoomAtScreenPoint(mx, my, dist / touchPinchDist);
        touchPinchDist = dist;
      }
    }
  }

  function onTouchEnd() {
    pointerDown = false;
    isPanning = false;
    touchPrev = null;
    touchPinchDist = null;
  }

  function touch1(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.touches[0].clientX - rect.left,
      y: event.touches[0].clientY - rect.top
    };
  }

  function pinchDist(event) {
    const dx = event.touches[0].clientX - event.touches[1].clientX;
    const dy = event.touches[0].clientY - event.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ---- Focus / camera -----------------------------------------------------------

  function focusNode(node, options = {}) {
    const { recordHistory = true, openDetails = true } = options;
    const actual = nodeMap[node.id] || node;
    if (!actual) return;

    if (recordHistory && selectedNode && selectedNode.id !== actual.id) {
      focusHistory.push(selectedNode.id);
      focusHistory = focusHistory.slice(-24);
    }

    selectedNode = actual;
    focusMode = true;
    focusBtn?.classList.add('active');
    focusBtn?.setAttribute('aria-pressed', 'true');
    updateBackButton();
    updateBreadcrumbs();

    if (openDetails) showDetails(actual);

    const target = focusTarget(actual);
    animateCameraTo(target.pan, target.zoom, 620);
    scheduleRender();
  }

  function focusTarget(node) {
    const ids = new Set([node.id]);
    const parentId = parentById[node.id];
    if (parentId) ids.add(parentId);
    (childrenById[node.id] || []).slice(0, 6).forEach((id) => ids.add(id));
    (descendantCache[node.id] || []).slice(0, 8).forEach((id) => ids.add(id));

    let sx = 0;
    let sy = 0;
    let weight = 0;

    [...ids].forEach((id) => {
      const candidate = nodeMap[id];
      if (!candidate) return;
      const w = id === node.id ? 3 : 1;
      sx += candidate.x * w;
      sy += candidate.y * w;
      weight += w;
    });

    const centerX = weight ? sx / weight : node.x;
    const centerY = weight ? sy / weight : node.y;
    const targetZoom = clamp(1.45 + Math.max(0, 3 - Math.min(node.depth, 3)) * 0.38, 1.45, 3.3);

    return {
      zoom: targetZoom,
      pan: {
        x: -centerX * targetZoom,
        y: -centerY * targetZoom
      }
    };
  }

  function goToPreviousFocus() {
    while (focusHistory.length) {
      const previousId = focusHistory.pop();
      if (nodeMap[previousId]) {
        focusNode(nodeMap[previousId], { recordHistory: false, openDetails: true });
        updateBackButton();
        return;
      }
    }
    updateBackButton();
  }

  function exitFocus(options = {}) {
    const { keepHistory = true } = options;
    focusMode = false;
    selectedNode = null;
    focusBtn?.classList.remove('active');
    focusBtn?.setAttribute('aria-pressed', 'false');
    if (!keepHistory) focusHistory = [];
    closeDetails({ clearSelection: false, preserveFocusState: false });
    updateBackButton();
    updateBreadcrumbs();
    scheduleRender();
  }

  function resetView(animate) {
    focusHistory = [];
    focusMode = false;
    selectedNode = null;
    focusBtn?.classList.remove('active');
    focusBtn?.setAttribute('aria-pressed', 'false');
    closeDetails({ clearSelection: false, preserveFocusState: true });
    updateBackButton();
    updateBreadcrumbs();
    applyHomeCamera(animate);
  }

  function applyHomeCamera(animate) {
    homeCamera = computeHomeCamera();
    if (animate) {
      animateCameraTo(homeCamera.pan, homeCamera.zoom, 520);
    } else {
      pan = { ...homeCamera.pan };
      zoom = homeCamera.zoom;
      scheduleRender();
    }
  }

  function computeHomeCamera() {
    if (!nodes.length) {
      return { pan: { x: 0, y: 0 }, zoom: 1 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    nodes.forEach((node) => {
      minX = Math.min(minX, node.x - node.size - 40);
      minY = Math.min(minY, node.y - node.size - 40);
      maxX = Math.max(maxX, node.x + node.size + 40);
      maxY = Math.max(maxY, node.y + node.size + 40);
    });

    const W = Math.max(1, cw());
    const H = Math.max(1, ch());
    const width = maxX - minX + 160;
    const height = maxY - minY + 180;
    const fitZoom = clamp(Math.min(W / width, H / height), MIN_ZOOM, 1.05);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    return {
      zoom: fitZoom,
      pan: {
        x: -centerX * fitZoom,
        y: -centerY * fitZoom
      }
    };
  }

  function zoomAtViewportCenter(factor) {
    zoomAtScreenPoint(cw() / 2, ch() / 2, factor, { animate: true });
  }

  function zoomAtScreenPoint(mx, my, factor, options = {}) {
    const { animate = false, duration = 240 } = options;
    const targetZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const world = screenToWorld(mx, my);
    const targetPan = {
      x: mx - cw() / 2 - world.x * targetZoom,
      y: my - ch() / 2 - world.y * targetZoom
    };

    if (animate) animateCameraTo(targetPan, targetZoom, duration);
    else {
      zoom = targetZoom;
      pan = targetPan;
      scheduleRender();
    }
  }

  function animateCameraTo(targetPan, targetZoom, duration) {
    cameraAnimation = {
      fromPan: { ...pan },
      toPan: { ...targetPan },
      fromZoom: zoom,
      toZoom: clamp(targetZoom, MIN_ZOOM, MAX_ZOOM),
      start: performance.now(),
      duration
    };
    scheduleRender();
  }

  function stepCameraAnimation(now) {
    if (!cameraAnimation) return false;
    const elapsed = now - cameraAnimation.start;
    const t = cameraAnimation.duration <= 0 ? 1 : clamp(elapsed / cameraAnimation.duration, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);

    pan = {
      x: lerp(cameraAnimation.fromPan.x, cameraAnimation.toPan.x, eased),
      y: lerp(cameraAnimation.fromPan.y, cameraAnimation.toPan.y, eased)
    };
    zoom = lerp(cameraAnimation.fromZoom, cameraAnimation.toZoom, eased);

    if (t >= 1) {
      cameraAnimation = null;
      return false;
    }
    return true;
  }

  // ---- Tooltip ------------------------------------------------------------------

  function showTooltip(node, mx, my) {
    if (!tooltipEl) return;
    const connCount = adjacency[node.id] ? adjacency[node.id].size : 0;
    tooltipEl.innerHTML =
      `<strong>${escHtml(node.name)}</strong>` +
      `<span class="tip-track" style="color:${TRACK_COLORS[node.track] || '#94a3b8'}">${escHtml(node.track)}</span>` +
      `<span>${capitalize(node.status)} &middot; ${Math.round(progressPct(node))}% funded</span>` +
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
    const ttH = 84;
    const left = mx + offset + ttW > W ? mx - offset - ttW : mx + offset;
    const top = my + offset + ttH > H ? my - offset - ttH : my + offset;
    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';
  }

  function hideTooltip() {
    tooltipEl?.classList.remove('visible');
  }

  // ---- Details panel ------------------------------------------------------------

  function showDetails(node) {
    if (!detailsPanel || !detailsContentEl) return;

    const color = TRACK_COLORS[node.track] || '#94a3b8';
    const progress = Math.round(progressPct(node));
    const gap = Math.max(0, (node.goal || 0) - (node.raised || 0));
    const parentId = parentById[node.id];
    const children = (childrenById[node.id] || []).map((id) => nodeMap[id]).filter(Boolean);
    const neighbours = [...(adjacency[node.id] || [])]
      .map((id) => nodeMap[id])
      .filter(Boolean)
      .filter((candidate) => candidate.id !== parentId && !children.some((child) => child.id === candidate.id));

    const parentHtml = parentId && nodeMap[parentId]
      ? `<div class="details-group">
          <h3>Parent branch</h3>
          <ul>
            <li style="border-left:3px solid ${TRACK_COLORS[nodeMap[parentId].track] || '#94a3b8'}">${escHtml(nodeMap[parentId].name)}</li>
          </ul>
        </div>`
      : '';

    const childHtml = children.length
      ? `<div class="details-group">
          <h3>Descendants (${children.length})</h3>
          <ul>${children.slice(0, 8).map((child) =>
            `<li style="border-left:3px solid ${TRACK_COLORS[child.track] || '#94a3b8'}">${escHtml(child.name)}</li>`
          ).join('')}</ul>
        </div>`
      : '';

    const assocHtml = neighbours.length
      ? `<div class="details-group">
          <h3>Shared stewardship + domain links (${neighbours.length})</h3>
          <ul>${neighbours.slice(0, 8).map((neighbour) =>
            `<li style="border-left:3px solid ${TRACK_COLORS[neighbour.track] || '#94a3b8'}">${escHtml(neighbour.name)} <small>· ${escHtml(relationLabel(node.id, neighbour.id))}</small></li>`
          ).join('')}</ul>
        </div>`
      : '';

    const repoLink = node.repoUrl
      ? `<a href="${escAttr(node.repoUrl)}" target="_blank" rel="noreferrer">Repository ↗</a>`
      : '';
    const artizenLink = node.artizenUrl
      ? `<a href="${escAttr(node.artizenUrl)}" target="_blank" rel="noreferrer">Artizen ↗</a>`
      : '';
    const linksHtml = repoLink || artizenLink ? `<div class="details-links">${repoLink}${artizenLink}</div>` : '';

    detailsContentEl.innerHTML =
      `<p class="details-track" style="color:${color}">${escHtml(node.track)}</p>` +
      `<h2 class="details-title">${escHtml(node.name)}</h2>` +
      `<div class="details-priority">` +
        `<h3>What needs action now</h3>` +
        `<p>${escHtml(primaryAction(node))}</p>` +
      `</div>` +
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
        `<p>${formatCurrency(node.raised)} / ${formatCurrency(node.goal)} &middot; ${progress}%` +
          (gap > 0 ? ` &middot; ${formatCurrency(gap)} remaining` : ' &middot; Goal reached') +
        `</p>` +
      `</div>` +
      parentHtml +
      childHtml +
      assocHtml +
      linksHtml;

    detailsPanel.classList.add('open');
    detailsPanel.setAttribute('aria-hidden', 'false');
  }

  function closeDetails(options = {}) {
    const { clearSelection = true, preserveFocusState = false } = options;
    detailsPanel?.classList.remove('open');
    detailsPanel?.setAttribute('aria-hidden', 'true');
    if (clearSelection) selectedNode = null;
    if (!preserveFocusState) {
      focusMode = false;
      focusBtn?.classList.remove('active');
      focusBtn?.setAttribute('aria-pressed', 'false');
    }
    updateBreadcrumbs();
    scheduleRender();
  }

  // ---- Breadcrumbs + filters ----------------------------------------------------

  function populateFilters() {
    if (!trackSel || !statusSel) return;

    const tracks = TRACK_ORDER.filter((track) => allProjects.some((project) => project.track === track));
    tracks.forEach((track) => {
      const option = document.createElement('option');
      option.value = track;
      option.textContent = track;
      trackSel.appendChild(option);
    });

    Object.keys(STATUS_COLORS).forEach((status) => {
      const option = document.createElement('option');
      option.value = status;
      option.textContent = capitalize(status);
      statusSel.appendChild(option);
    });
  }

  function updateBreadcrumbs() {
    if (!breadcrumbsEl) return;

    const crumbs = [{ label: 'Home', type: 'home' }];

    if (selectedNode && nodeMap[selectedNode.id]) {
      const chain = [];
      let currentId = selectedNode.id;
      while (currentId) {
        const current = nodeMap[currentId];
        if (!current) break;
        chain.unshift({ label: current.name, type: 'node', id: current.id });
        currentId = parentById[currentId];
      }
      if (chain.length) {
        crumbs.push({ label: chain[0].label, type: 'root', id: chain[0].id, track: nodeMap[chain[0].id]?.track });
        chain.slice(1).forEach((crumb) => crumbs.push(crumb));
      }
    } else if (filterTrack !== 'all') {
      const cluster = trackClusters.find((entry) => entry.track === filterTrack);
      if (cluster) crumbs.push({ label: cluster.track, type: 'root', id: cluster.rootId, track: cluster.track });
    }

    const seen = new Set();
    breadcrumbsEl.innerHTML = crumbs
      .filter((crumb, index) => {
        const key = `${crumb.type}:${crumb.id || crumb.label}:${index}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((crumb, index) => {
        const attrs = crumb.type === 'home'
          ? 'data-home="true"'
          : `data-node-id="${escAttr(crumb.id || '')}"`;
        const classes = ['crumb-btn'];
        if (selectedNode && crumb.id === selectedNode.id) classes.push('active');
        const sep = index === 0 ? '' : '<span class="crumb-sep" aria-hidden="true">›</span>';
        const style = crumb.track ? ` style="--crumb-color:${TRACK_COLORS[crumb.track] || '#94a3b8'}"` : '';
        return `${sep}<button type="button" class="${classes.join(' ')}" ${attrs}${style}>${escHtml(crumb.label)}</button>`;
      })
      .join('');
  }

  function onBreadcrumbClick(event) {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.home === 'true') {
      resetView(true);
      return;
    }
    const nodeId = btn.dataset.nodeId;
    if (nodeId && nodeMap[nodeId]) {
      focusNode(nodeMap[nodeId], { recordHistory: true, openDetails: true });
    }
  }

  function updateBackButton() {
    if (!backBtn) return;
    backBtn.disabled = focusHistory.length === 0;
    backBtn.setAttribute('aria-disabled', String(backBtn.disabled));
  }

  // ---- Utilities ----------------------------------------------------------------

  function mousePos(event) {
    const rect = canvas.getBoundingClientRect();
    return { mx: event.clientX - rect.left, my: event.clientY - rect.top };
  }

  function worldBounds(margin) {
    const W = cw();
    const H = ch();
    return {
      left: (-W / 2 - pan.x) / zoom - margin,
      right: (W / 2 - pan.x) / zoom + margin,
      top: (-H / 2 - pan.y) / zoom - margin,
      bottom: (H / 2 - pan.y) / zoom + margin
    };
  }

  function edgeVisible(source, target, bounds) {
    const minX = Math.min(source.x, target.x) - 80 / zoom;
    const maxX = Math.max(source.x, target.x) + 80 / zoom;
    const minY = Math.min(source.y, target.y) - 80 / zoom;
    const maxY = Math.max(source.y, target.y) + 80 / zoom;
    return !(maxX < bounds.left || minX > bounds.right || maxY < bounds.top || minY > bounds.bottom);
  }

  function pointInBounds(x, y, bounds, pad) {
    return x >= bounds.left - pad && x <= bounds.right + pad && y >= bounds.top - pad && y <= bounds.bottom + pad;
  }

  function screenToWorld(mx, my) {
    return {
      x: (mx - cw() / 2 - pan.x) / zoom,
      y: (my - ch() / 2 - pan.y) / zoom
    };
  }

  function worldToScreen(x, y) {
    return {
      x: x * zoom + cw() / 2 + pan.x,
      y: y * zoom + ch() / 2 + pan.y
    };
  }

  function focusContextIds() {
    if (!focusMode || !selectedNode) return null;
    const ids = new Set([selectedNode.id]);
    const parentId = parentById[selectedNode.id];
    if (parentId) ids.add(parentId);
    (childrenById[selectedNode.id] || []).forEach((id) => ids.add(id));
    (descendantCache[selectedNode.id] || []).forEach((id) => ids.add(id));
    (adjacency[selectedNode.id] || []).forEach((id) => ids.add(id));
    return ids;
  }

  function progressPct(node) {
    return node.goal > 0 ? Math.min(100, (node.raised / node.goal) * 100) : 0;
  }

  function primaryAction(node) {
    const gap = Math.max(0, (node.goal || 0) - (node.raised || 0));
    if (node.status === 'planning') {
      return gap > 0
        ? `Confirm the next steward step and close the ${formatCurrency(gap)} launch gap so this branch can move into active work.`
        : 'Confirm the next steward step and turn this planned branch into active delivery.';
    }
    if (node.status === 'completed') {
      return 'Capture what worked, link the next descendant initiative, and keep maintenance responsibilities visible.';
    }
    if (node.status === 'paused') {
      return 'Review blockers with the steward group and decide whether to resume, reshape, or archive this branch.';
    }
    return gap > 0
      ? `Coordinate the next steward action and raise the remaining ${formatCurrency(gap)} needed to reach this project’s goal.`
      : 'Document the next milestone, keep steward roles clear, and seed the most promising child branch.';
  }

  function shortActionLabel(node) {
    if (node.status === 'planning') return 'Needs launch plan';
    if (node.status === 'completed') return 'Share learnings';
    if (node.status === 'paused') return 'Resolve blockers';
    return Math.max(0, (node.goal || 0) - (node.raised || 0)) > 0 ? 'Needs next action' : 'Ready for next branch';
  }

  function relationLabel(aId, bId) {
    const raw = relationTypes[relationKey(aId, bId)] || 'same-track';
    return raw.replace(/-/g, ' ');
  }

  function relationKey(aId, bId) {
    return [aId, bId].sort().join('::');
  }

  function associationPriority(type) {
    return ASSOCIATION_PRIORITY[type] || 0;
  }

  function stableUnit(seedInput) {
    const text = String(seedInput);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % 1000) / 1000;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(value || 0);
  }

  function shortCurrency(value) {
    if (value >= 1000) return `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
    return formatCurrency(value);
  }

  function hexAlpha(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  function escHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escAttr(text) {
    return String(text).replace(/"/g, '%22');
  }

  // ---- Boot ---------------------------------------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
