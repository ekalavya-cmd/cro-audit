/* global io */
// ── Gradient thumbnails ────────────────────────────────
let socket = null;
let lastSocketUpdate = 0;
let watchdogTimer = null;

function initSocket() {
  if (typeof io === 'undefined') {
    console.warn('[Socket] Socket.IO client not loaded');
    return;
  }

  socket = io();

  socket.on('connect', () => {
    console.log('[Socket] Connected');
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Disconnected');
  });

  socket.on('progress', (data) => {
    if (data.jobId === activeJobId) {
      lastSocketUpdate = Date.now();
      updateProgressFromSocket(data);
    }
  });

  socket.on('complete', (data) => {
    if (data.jobId === activeJobId) {
      lastSocketUpdate = Date.now();
      REPORT = data.result;
      activeJobId = null;
      saveState();
      finalizeAuditUI();
    }
  });

  socket.on('failed', (data) => {
    if (data.jobId === activeJobId) {
      activeJobId = null;
      saveState();
      toast('Audit failed: ' + (data.error || 'Unknown error'));
      goBack();
    }
  });
}

function joinJobRoom(jobId) {
  if (socket && jobId) {
    socket.emit('join', jobId);
    console.log('[Socket] Joined room:', jobId);
  }
}

let pollingTimer = null;
let lastPolledStatus = null;

function startPolling(jobId) {
  stopPolling();
  console.log('[Polling] Starting polling for job:', jobId);

  pollingTimer = setInterval(async () => {
    try {
      const response = await fetch('/api/audit/status/' + jobId);
      if (!response.ok) return;

      const data = await response.json();
      console.log('[Polling] Status:', data.status, 'Progress:', data.progress);

      if (lastPolledStatus !== data.status) {
        lastPolledStatus = data.status;
      }

      if (data.status === 'completed') {
        stopPolling();
        REPORT = data.result;
        activeJobId = null;
        saveState();
        finalizeAuditUI();
        console.log('[Polling] Audit completed via polling');
      } else if (data.status === 'failed') {
        stopPolling();
        activeJobId = null;
        saveState();
        toast('Audit failed: ' + (data.error || 'Unknown error'));
        goBack();
        console.log('[Polling] Audit failed via polling');
      } else if (data.status === 'waiting') {
        showQueuedUI();
      } else if (data.progress !== undefined) {
        updateProgressFromSocket({
          jobId: jobId,
          progress: data.progress,
          currentStep: data.currentStep || 'started',
          status: 'processing',
        });
      }
    } catch (error) {
      console.error('[Polling] Error:', error);
    }
  }, 5000);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    console.log('[Polling] Stopped polling');
  }
  lastPolledStatus = null;
}

function startWatchdog(jobId) {
  stopWatchdog();
  lastSocketUpdate = Date.now();
  console.log('[Watchdog] Starting watchdog for job:', jobId);

  watchdogTimer = setInterval(() => {
    const timeSinceUpdate = Date.now() - lastSocketUpdate;
    const isSocketDisconnected = !socket || !socket.connected;

    if (isSocketDisconnected || timeSinceUpdate > 15000) {
      console.warn(
        `[Watchdog] Socket unresponsive (Disconnected: ${isSocketDisconnected}, Time since update: ${timeSinceUpdate}ms). Falling back to polling.`,
      );
      stopWatchdog();
      startPolling(jobId);
    }
  }, 5000);
}

function stopWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
    console.log('[Watchdog] Stopped watchdog');
  }
}

function leaveJobRoom(jobId) {
  if (socket && jobId) {
    socket.emit('leave', jobId);
  }
}

function updateProgressFromSocket(data) {
  const pBar = document.getElementById('pBar');
  const pPct = document.getElementById('pPct');
  const pLabel = document.getElementById('pLabel');

  if (!pBar || !pPct || !pLabel) return;

  pBar.style.width = data.progress + '%';
  pPct.textContent = data.progress + '%';
  pBar.classList.add('active');

  const stepLabels = {
    started: 'Starting audit…',
    lighthouse: 'Analysing performance & core web vitals…',
    axe: 'Testing accessibility (WCAG 2.1)…',
    dom_nav: 'Checking navigation & link structure…',
    dom_seo: 'Evaluating SEO signals…',
    visual_mobile: 'Checking mobile responsiveness…',
    visual_trust: 'Computing conversion & trust heuristics…',
    scoring: 'Computing final scores…',
    complete: 'Generating your report…',
  };

  pLabel.textContent = stepLabels[data.currentStep] || data.message || 'Processing...';

  const progressTitle = document.getElementById('progressTitle');
  const progressSub = document.getElementById('progressSub');
  if (progressTitle) progressTitle.textContent = 'Scanning your website…';
  if (progressSub) progressSub.textContent = 'Grab a coffee ☕ — this takes about 60–90 seconds';

  updateProcessStatusFromSocket(data);
}

function showQueuedUI() {
  const progressTitle = document.getElementById('progressTitle');
  const progressSub = document.getElementById('progressSub');
  if (progressTitle) progressTitle.textContent = 'Audit is queued…';
  if (progressSub)
    progressSub.textContent =
      'Another audit is currently running. Your audit will start automatically. Grab a coffee ☕';

  const pBar = document.getElementById('pBar');
  const pPct = document.getElementById('pPct');
  const pLabel = document.getElementById('pLabel');

  if (pBar) {
    pBar.style.width = '0%';
    pBar.classList.remove('active');
  }
  if (pPct) pPct.textContent = '0%';
  if (pLabel) pLabel.textContent = 'Waiting in queue…';

  const auditType = picked || 'full';
  const config = AUDIT_CONFIGS[auditType] || AUDIT_CONFIGS.full;
  const activeIds = config.activeIds;

  STAT_IDS.forEach((id) => {
    const row = document.getElementById(id).closest('.scan-row');
    if (activeIds.includes(id)) {
      row.style.display = 'flex';
      const el = document.getElementById(id);
      el.className = 'scan-status s-wait';
      el.textContent = 'Queued';
    } else {
      row.style.display = 'none';
    }
  });
}

async function fetchCurrentStatus(jobId) {
  try {
    const response = await fetch('/api/audit/status/' + jobId);
    if (!response.ok) return;

    const data = await response.json();
    console.log('[Initial Status Check]', data.status, 'Progress:', data.progress);

    if (data.status === 'completed') {
      REPORT = data.result;
      activeJobId = null;
      saveState();
      finalizeAuditUI();
    } else if (data.status === 'failed') {
      activeJobId = null;
      saveState();
      toast('Audit failed: ' + (data.error || 'Unknown error'));
      goBack();
    } else if (data.status === 'waiting') {
      showQueuedUI();
    } else if (data.progress !== undefined) {
      updateProgressFromSocket({
        jobId: jobId,
        progress: data.progress,
        currentStep: data.currentStep || 'started',
        status: 'processing',
      });
    }
  } catch (error) {
    console.error('[Initial Status Check] Error:', error);
  }
}

function updateProcessStatusFromSocket(data) {
  const currentStep = data.currentStep;
  const status = data.status;
  const auditType = picked || 'full';
  const config = AUDIT_CONFIGS[auditType] || AUDIT_CONFIGS.full;

  // Mapping of audit steps to UI element IDs
  // These are the steps that are COMPLETED when the step name is reported
  const stepToIds = {
    lighthouse: ['p1'],
    axe: ['p2'],
    dom_nav: ['p4'],
    dom_seo: ['p5'],
    visual_mobile: ['p3'],
    visual_trust: ['p6'],
  };

  // Define the sequence of steps based on audit mode
  const stepSequence = config.sequence || [
    'started',
    'lighthouse',
    'axe',
    'dom',
    'visual',
    'scoring',
    'complete',
  ];
  const currentIndex = stepSequence.indexOf(currentStep);

  // Determine the next step that should be "Running" (used for non-parallel modes)
  const nextStep = currentIndex < stepSequence.length - 1 ? stepSequence[currentIndex + 1] : null;

  // ── Parallel group detection ──────────────────────────────────────────────────
  // If this audit mode has a parallel group and the trigger step just completed,
  // all members of the parallel group should be set to Running simultaneously.
  const parallelGroup = config.parallelGroup;
  const parallelGroupActive =
    parallelGroup && currentStep === parallelGroup.triggerStep && status !== 'completed';

  // Collect the IDs that belong to the parallel group (for Running highlight)
  const parallelRunningIds = parallelGroupActive
    ? parallelGroup.steps.flatMap((step) => stepToIds[step] || [])
    : [];

  STAT_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    // A step is "Done" if its step name or any subsequent step name has been reported
    let isDone = false;
    for (let i = 0; i <= currentIndex; i++) {
      const pastStep = stepSequence[i];
      if (stepToIds[pastStep] && stepToIds[pastStep].includes(id)) {
        isDone = true;
        break;
      }
    }

    // Special case: if status is 'completed' or currentStep is 'complete' or 'scoring', all are done
    if (status === 'completed' || currentStep === 'complete' || currentStep === 'scoring') {
      isDone = true;
    }

    // A step is in the parallel group that just launched — show all as Running together
    const isParallelRunning = parallelRunningIds.includes(id);

    // A step is "Running" if it is the next sequential step (non-parallel fallback)
    const isRunning =
      !parallelGroupActive && nextStep && stepToIds[nextStep] && stepToIds[nextStep].includes(id);

    // Enforce sequence: Done is final
    if (el.classList.contains('s-done')) {
      return; // Already done, stay done
    }

    if (isDone) {
      el.className = 'scan-status s-done';
      el.textContent = 'Done';
    } else if (isParallelRunning || isRunning) {
      // Transition to Running only if currently Queued (never revert)
      if (el.classList.contains('s-wait') || el.textContent === 'Queued') {
        el.className = 'scan-status s-run';
        el.textContent = 'Running';
      }
    }
    // Else: stay in current state
  });
}
function drawGradient(id, stops) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth || 218;
  canvas.height = canvas.offsetHeight || 108;
  const w = canvas.width,
    h = canvas.height;

  // base gradient
  const g1 = ctx.createLinearGradient(0, 0, w, h);
  stops.base.forEach(([pos, col]) => g1.addColorStop(pos, col));
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, w, h);

  // blobs
  stops.blobs.forEach(([cx, cy, r, col]) => {
    const rg = ctx.createRadialGradient(cx * w, cy * h, 0, cx * w, cy * h, r * Math.max(w, h));
    rg.addColorStop(0, col);
    rg.addColorStop(1, 'transparent');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
  });
}

const GRAD_DEFS = {
  cv1: {
    base: [
      [0, '#0f4c81'],
      [0.5, '#1a7aa8'],
      [1, '#56B8C8'],
    ],
    blobs: [
      [0.2, 0.3, 0.55, 'rgba(86,184,200,0.65)'],
      [0.8, 0.7, 0.45, 'rgba(124,58,237,0.45)'],
      [0.1, 0.8, 0.35, 'rgba(37,104,142,0.55)'],
    ],
  },
  cv2: {
    base: [
      [0, '#4c0e8f'],
      [0.5, '#7C3AED'],
      [1, '#a855f7'],
    ],
    blobs: [
      [0.7, 0.2, 0.55, 'rgba(240,88,112,0.50)'],
      [0.2, 0.7, 0.45, 'rgba(124,58,237,0.60)'],
      [0.9, 0.8, 0.4, 'rgba(247,148,51,0.30)'],
    ],
  },
  cv3: {
    base: [
      [0, '#b45309'],
      [0.5, '#F79433'],
      [1, '#fbbf24'],
    ],
    blobs: [
      [0.3, 0.3, 0.55, 'rgba(240,88,112,0.55)'],
      [0.8, 0.6, 0.4, 'rgba(247,148,51,0.55)'],
      [0.1, 0.7, 0.38, 'rgba(245,178,26,0.45)'],
    ],
  },
};

// ── Domain Blogs ──────────────────────────────────────
let DOMAIN_DATA = null;

async function loadDomainBlogs() {
  try {
    const response = await fetch('/domain-blogs.json');
    const data = await response.json();
    const params = new URLSearchParams(window.location.search);
    const hostname = (params.get('ref') || window.location.hostname).replace(/^www\./, '');
    DOMAIN_DATA = data[hostname] || null;
    renderBlogCards();
  } catch (error) {
    console.warn('Failed to load domain blogs:', error);
  }
}

function renderBlogCards() {
  const blogsWrap = document.getElementById('blogsWrap');
  const blogRail = document.getElementById('blogRail');
  if (!DOMAIN_DATA || !blogsWrap || !blogRail) return;

  blogRail.innerHTML = '';

  if (DOMAIN_DATA.blogs && DOMAIN_DATA.blogs.length > 0) {
    DOMAIN_DATA.blogs.forEach((blog, index) => {
      const badgeClass = getBadgeClass(blog.category);
      const card = document.createElement('a');
      card.className = 'blog-card';
      card.target = '_blank';
      card.href = blog.url;

      let thumbContent;
      if (blog.image && blog.image.startsWith('http')) {
        thumbContent = `<img src="${blog.image}" alt="${blog.title}" onerror="this.style.display='none'" />`;
      } else {
        const canvasId = blog.image || 'cv' + (index + 1);
        thumbContent = `<canvas id="${canvasId}"></canvas>`;
      }

      card.innerHTML = `
        <div class="bc-thumb">
          ${thumbContent}
          <span class="bc-badge ${badgeClass}">${blog.category}</span>
        </div>
        <div class="bc-body">
          <div class="bc-title">${blog.title}</div>
          <div class="bc-desc">${blog.description}</div>
          <div class="bc-read">
            Read
            <svg viewBox="0 0 24 24">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      `;
      blogRail.appendChild(card);
    });
  }

  if (DOMAIN_DATA.contactUrl) {
    const contactCard = document.createElement('a');
    contactCard.className = 'blog-card contact-card';
    contactCard.target = '_blank';
    contactCard.href = DOMAIN_DATA.contactUrl;
    contactCard.innerHTML = `
      <div class="contact-content">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--teal-blue)" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <h4>Need Help?</h4>
        <p>Talk to one of our experts to discuss your audit results or get a custom strategy.</p>
        <div class="contact-cta">
          Contact Us
          <svg viewBox="0 0 24 24">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    `;
    blogRail.appendChild(contactCard);
  }

  blogsWrap.style.display = 'block';

  // Update advisor link with contact URL
  const advisorLink = document.getElementById('advisorLink');
  if (advisorLink && DOMAIN_DATA && DOMAIN_DATA.contactUrl) {
    advisorLink.href = DOMAIN_DATA.contactUrl;
    advisorLink.target = '_blank';
    // Also add click handler to ensure it opens
    advisorLink.addEventListener('click', function (e) {
      e.preventDefault();
      window.open(this.href, '_blank');
    });
  }

  setTimeout(() => {
    document.querySelectorAll('#blogRail .blog-card .bc-thumb canvas').forEach((canvas) => {
      const gradient = GRAD_DEFS[canvas.id];
      if (gradient) {
        drawGradient(canvas.id, gradient);
      }
    });
  }, 100);
}

function getBadgeClass(category) {
  const cat = (category || '').toLowerCase();
  if (cat.includes('case')) return 'badge-case';
  if (cat.includes('blog')) return 'badge-blog';
  if (cat.includes('guide')) return 'badge-guide';
  return 'badge-blog';
}

// ── Initialization ────────────────────────────────────
function init() {
  initSocket();

  // Draw gradient thumbnails
  Object.keys(GRAD_DEFS).forEach((id) => drawGradient(id, GRAD_DEFS[id]));

  // Load domain-based blogs
  loadDomainBlogs();

  // Setup event listeners
  const bBack = document.getElementById('bBack');
  const bNext = document.getElementById('bNext');
  // const advisorLink = document.querySelector('.advisor-link');

  if (bBack) bBack.addEventListener('click', goBack);
  if (bNext) bNext.addEventListener('click', goNext);

  document.querySelectorAll('.audit-card').forEach((card) => {
    card.addEventListener('click', () => {
      pickAudit(card.dataset.type);
    });
  });

  const mFooter = document.getElementById('mFooter');
  if (mFooter) {
    mFooter.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('.btn-new')) {
        reset();
      }
    });
  }

  restoreState();

  // Open modal on load
  // openModal();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);

// ── Global State ────────────────────────────────
let step = 1,
  picked = null,
  timer = null,
  activeJobId = null;

function getSavedState() {
  try {
    const raw = sessionStorage.getItem('auditState');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Failed to parse saved audit state', error);
    return null;
  }
}

function saveState() {
  const state = {
    step,
    picked,
    auditUrl,
    activeJobId,
    email: document.getElementById('emailIn')?.value || '',
    report: REPORT,
  };
  sessionStorage.setItem('auditState', JSON.stringify(state));
}

function clearSavedState() {
  sessionStorage.removeItem('auditState');
}

function restoreState() {
  const state = getSavedState();
  if (!state) return;

  step = state.step || 1;
  picked = state.picked || null;
  auditUrl = state.auditUrl || '';
  REPORT = state.report || null;
  activeJobId = state.activeJobId || null;

  if (auditUrl) {
    const urlInput = document.getElementById('urlIn');
    if (urlInput) urlInput.value = auditUrl;
  }
  if (state.email) {
    const emailInput = document.getElementById('emailIn');
    if (emailInput) emailInput.value = state.email;
  }

  if (picked) {
    document.querySelectorAll('.audit-card').forEach((c) => {
      c.classList.toggle('selected', c.dataset.type === picked);
    });
  }

  if (step === 1) {
    setStep(1);
  } else if (step === 2) {
    setStep(2);
  } else if (step === 3) {
    setStep(3);
    if (REPORT) {
      setStep(4);
      loadResults();
    } else if (activeJobId) {
      joinJobRoom(activeJobId);
      startWatchdog(activeJobId);
      fetchCurrentStatus(activeJobId);
    }
  } else if (step === 4) {
    setStep(4);
    loadResults();
  }
}

const META = [
  { title: "Let's audit your website", sub: 'Enter your details to get started' },
  { title: 'Choose your audit type', sub: "Select what you'd like analysed" },
  { title: 'Audit in progress', sub: "We're scanning your website right now" },
  { title: 'Your Health Report', sub: '' },
];

// ── Modal open / close ─────────────────────────────────
// function openModal() {
//   document.getElementById('overlay').classList.add('open');
//   document.body.style.overflow = 'hidden';
// }
// function closeModal() {
//   document.getElementById('overlay').classList.remove('open');
//   document.body.style.overflow = '';
//   clearInterval(timer);
// }
// document.getElementById('overlay').addEventListener('click', (e) => {
//   if (e.target === e.currentTarget) closeModal();
// });
// document.addEventListener('keydown', (e) => {
//   if (e.key === 'Escape') closeModal();
// });

// ── Step render ────────────────────────────────────────
function setStep(n) {
  step = n;
  const meta = META[n - 1];
  document.getElementById('mTitle').textContent = meta.title;

  // For step 4, show the audited URL; for others show the subtitle
  if (n === 4 && auditUrl) {
    const urlDisplay = auditUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
    let auditMode = 'Full Audit';
    if (picked === 'seo') {
      auditMode = 'SEO Audit';
    } else if (picked === 'uxui') {
      auditMode = 'UX/UI Audit';
    }
    document.getElementById('mSub').textContent = `${urlDisplay} · ${auditMode}`;
  } else {
    document.getElementById('mSub').textContent = meta.sub;
  }

  document.querySelectorAll('.step-view').forEach((v) => v.classList.remove('active'));
  document.getElementById('s' + n).classList.add('active');

  // When entering step 3 (progress view), immediately setup processes and states
  if (n === 3) {
    const auditType = picked || 'full';
    const config = AUDIT_CONFIGS[auditType] || AUDIT_CONFIGS.full;
    const activeIds = config.activeIds;

    // Hide irrelevant processes and set initial states: all queued initially
    STAT_IDS.forEach((id) => {
      const row = document.getElementById(id).closest('.scan-row');
      if (activeIds.includes(id)) {
        row.style.display = 'flex';
        const el = document.getElementById(id);
        el.className = 'scan-status s-wait';
        el.textContent = 'Queued';
      } else {
        row.style.display = 'none';
      }
    });

    // Initialize progress bar as queued
    document.getElementById('pBar').style.width = '0%';
    document.getElementById('pPct').textContent = '0%';
    document.getElementById('pLabel').textContent = 'Waiting in queue…';
    document.getElementById('pBar').classList.remove('active');

    const progressTitle = document.getElementById('progressTitle');
    const progressSub = document.getElementById('progressSub');
    if (progressTitle) progressTitle.textContent = 'Audit is queued…';
    if (progressSub)
      progressSub.textContent =
        'Another audit is currently running. Your audit will start automatically. Grab a coffee ☕';
  }

  for (let i = 1; i <= 4; i++) {
    const d = document.getElementById('d' + i);
    d.classList.remove('active', 'done');
    if (i < n) d.classList.add('done');
    else if (i === n) d.classList.add('active');
    if (i <= 3) {
      const l = document.getElementById('l' + i);
      l.classList.toggle('done', i < n);
    }
  }

  const bk = document.getElementById('bBack');
  const bn = document.getElementById('bNext');
  const ft = document.getElementById('mFooter');

  // Back button: show on steps 2 & 3 only
  bk.style.display = n === 2 || n === 3 ? 'inline-flex' : 'none';

  if (n === 3) {
    bn.style.display = 'none';
  } else if (n === 4) {
    ft.innerHTML = `
      <button class="btn-new" id="btnNew">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
        New Audit
      </button>
      <button class="btn-email" id="btnEmail" style="margin-left:auto">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        Email My Report
      </button>`;
    // attach after DOM update
    const btnNew = document.getElementById('btnNew');
    const btnEmail = document.getElementById('btnEmail');
    if (btnNew) btnNew.addEventListener('click', reset);
    if (btnEmail) btnEmail.addEventListener('click', sendEmail);
  } else {
    bn.style.display = 'inline-flex';
    bn.innerHTML =
      n === 2
        ? 'Run Audit <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>'
        : 'Continue <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
  }
  saveState();
}

// ── Navigation ─────────────────────────────────────────
function goNext() {
  if (step === 1) {
    const u = document.getElementById('urlIn').value.trim();
    const e = document.getElementById('emailIn').value.trim();
    if (!u || !u.startsWith('https://')) {
      shake('urlIn');
      toast('Only SSL certified websites (https://) are allowed');
      return;
    }
    if (!e || !e.includes('@')) {
      shake('emailIn');
      return;
    }
    auditUrl = u;
    setStep(2);
  } else if (step === 2) {
    if (!picked) {
      flashCards();
      return;
    }
    setStep(3);
    runAudit();
  }
}

function goBack() {
  if (step === 2) setStep(1);
  else if (step === 3) {
    clearInterval(timer);
    stopPolling();
    stopWatchdog();
    if (activeJobId) {
      leaveJobRoom(activeJobId);
    }
    setStep(2);
  }
}

function shake(id) {
  const el = document.getElementById(id);
  el.style.borderColor = 'var(--crimson)';
  el.animate(
    [
      { transform: 'translateX(-5px)' },
      { transform: 'translateX(5px)' },
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(4px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 300 },
  );
  setTimeout(() => {
    el.style.borderColor = '';
  }, 800);
}

function flashCards() {
  const c = document.getElementById('auditCards');
  c.style.outline = '2px solid var(--crimson)';
  c.style.borderRadius = '12px';
  setTimeout(() => {
    c.style.outline = '';
  }, 700);
}

function pickAudit(t) {
  picked = t;
  document.querySelectorAll('.audit-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.type === t);
  });
  saveState();
}

// ── API Call & Progress ───────────────────────────────
async function runAudit() {
  try {
    const mode = picked;
    const emailValue = document.getElementById('emailIn').value.trim();
    const notifyEnabled = document.getElementById('notifyTog')?.checked ?? false;

    const response = await fetch('/api/audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: auditUrl,
        mode,
        notifyViaEmail: notifyEnabled,
        email: emailValue,
      }),
    });

    if (!response.ok) {
      let errorMessage = 'Audit failed';
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorMessage;
      } catch {
        errorMessage = (await response.text()) || errorMessage;
      }
      toast('Error: ' + errorMessage);
      goBack();
      return;
    }

    const result = await response.json();

    // Start real-time updates via Socket.IO
    if (result.jobId) {
      activeJobId = result.jobId;
      saveState();
      joinJobRoom(result.jobId);
      startWatchdog(result.jobId);
      fetchCurrentStatus(result.jobId);
    } else {
      // Fallback for immediate results (backward compatibility if needed)
      REPORT = result.data || result;
      activeJobId = null;
      saveState();
      finalizeAuditUI();
    }
  } catch (error) {
    console.error('Audit error:', error);
    toast('Connection Error: ' + (error.message || 'Could not connect to server'));
    goBack();
  }
}

function finalizeAuditUI() {
  stopPolling();
  stopWatchdog();
  const pBar = document.getElementById('pBar');
  pBar.style.width = '100%';
  document.getElementById('pPct').textContent = '100%';
  document.getElementById('pLabel').textContent = 'Done!';

  setTimeout(() => {
    setStep(4);
    loadResults();
  }, 1000);
}

// ── Progress ───────────────────────────────────────────
// Define audit-type specific stages and processes
const AUDIT_CONFIGS = {
  seo: {
    stages: [
      { pct: 30, label: 'Analysing performance & core web vitals…', run: 0 },
      { pct: 50, label: 'Checking navigation & link structure…', run: 3 },
      { pct: 70, label: 'Evaluating SEO signals…', run: 4 },
      { pct: 95, label: 'Generating your report…', run: -1 },
      { pct: 100, label: 'Done!', run: -1 },
    ],
    activeIds: ['p1', 'p4', 'p5'], // Only show relevant processes
    sequence: ['started', 'lighthouse', 'dom_nav', 'dom_seo', 'scoring', 'complete'],
    // No parallel group in SEO mode — only DOM runs after lighthouse
    parallelGroup: null,
  },
  uxui: {
    stages: [
      { pct: 20, label: 'Analysing performance & core web vitals…', run: 0 },
      { pct: 35, label: 'Testing accessibility (WCAG 2.1)…', run: 1 },
      { pct: 50, label: 'Checking navigation & link structure…', run: 2 },
      { pct: 75, label: 'Checking mobile responsiveness…', run: 3 },
      { pct: 85, label: 'Computing conversion & trust heuristics…', run: 5 },
      { pct: 95, label: 'Generating your report…', run: -1 },
      { pct: 100, label: 'Done!', run: -1 },
    ],
    activeIds: ['p1', 'p2', 'p4', 'p3', 'p6'], // Only show relevant processes
    sequence: [
      'started',
      'lighthouse',
      'axe',
      'dom_nav',
      'dom_seo',
      'visual_mobile',
      'visual_trust',
      'scoring',
      'complete',
    ],
    // After lighthouse completes, axe + dom_nav + dom_seo + visual_mobile all start in parallel.
    // triggerStep is the step whose completion kicks off the parallel group.
    parallelGroup: {
      triggerStep: 'lighthouse',
      steps: ['axe', 'dom_nav', 'dom_seo', 'visual_mobile'],
    },
  },
  full: {
    stages: [
      { pct: 15, label: 'Analysing performance & core web vitals…', run: 0 },
      { pct: 30, label: 'Testing accessibility (WCAG 2.1)…', run: 1 },
      { pct: 45, label: 'Analysing navigation & link structure…', run: 3 },
      { pct: 60, label: 'Evaluating SEO signals…', run: 4 },
      { pct: 75, label: 'Checking mobile responsiveness…', run: 2 },
      { pct: 85, label: 'Computing conversion & trust heuristics…', run: 5 },
      { pct: 95, label: 'Generating your report…', run: -1 },
      { pct: 100, label: 'Done!', run: -1 },
    ],
    activeIds: ['p1', 'p2', 'p4', 'p5', 'p3', 'p6'], // Show all processes
    sequence: [
      'started',
      'lighthouse',
      'axe',
      'dom_nav',
      'dom_seo',
      'visual_mobile',
      'visual_trust',
      'scoring',
      'complete',
    ],
    // After lighthouse completes, axe + dom_nav + dom_seo + visual_mobile all start in parallel.
    parallelGroup: {
      triggerStep: 'lighthouse',
      steps: ['axe', 'dom_nav', 'dom_seo', 'visual_mobile'],
    },
  },
};

const STAT_IDS = ['p1', 'p2', 'p4', 'p5', 'p3', 'p6'];

// ── Results ────────────────────────────────────────────
let REPORT = null;

let auditUrl = '';

function loadResults() {
  if (!REPORT) return;

  // Extract data from the actual API response (handle different field names)
  const score = REPORT.overallScore || REPORT.seoScore || REPORT.uxuiScore;
  const grade = REPORT.grade;
  const url = auditUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];

  // Determine the heading based on audit mode
  let headingText = 'Health Score';
  if (picked === 'seo') {
    headingText = 'SEO Health Score';
  } else if (picked === 'uxui') {
    headingText = 'UX/UI Health Score';
  } else if (picked === 'full' || picked === null) {
    headingText = 'Full Audit Health Score';
  }

  // const C = 2 * Math.PI * 38;
  const sc = scoreColor(score);

  let bd = '',
    metrics = '',
    issues = '',
    recs = '';

  // Build breakdown section based on audit type
  if (REPORT.breakdown) {
    if (picked === 'seo' && REPORT.breakdown.performance && REPORT.breakdown.navigation) {
      // SEO audit: show only performance and navigation
      const breakdownMap = {
        Performance: REPORT.breakdown.performance?.score || 75,
        'Navigation & IA': REPORT.breakdown.navigation?.score || 75,
      };
      for (const [k, v] of Object.entries(breakdownMap)) {
        const col = scoreColor(v);
        bd += `<div class="sc-item">
          <div class="sc-meta"><span>${k}</span><strong style="color:${col}">${v}</strong></div>
          <div class="bar-track"><div class="bar-fill" style="width:0%;background:${col}" data-w="${v}%"></div></div>
        </div>`;
      }
    } else if (picked === 'uxui') {
      // UX/UI audit: show only relevant UX/UI metrics
      const breakdownMap = {
        'Visual Clarity': REPORT.breakdown.visualClarity?.score || 75,
        'Conversion Flow': REPORT.breakdown.conversionFlow?.score || 75,
        'Mobile Experience': REPORT.breakdown.mobileExperience?.score || 75,
        'Trust & Credibility': REPORT.breakdown.trustCredibility?.score || 75,
        Accessibility: REPORT.breakdown.accessibility?.score || 75,
      };
      for (const [k, v] of Object.entries(breakdownMap)) {
        const col = scoreColor(v);
        bd += `<div class="sc-item">
          <div class="sc-meta"><span>${k}</span><strong style="color:${col}">${v}</strong></div>
          <div class="bar-track"><div class="bar-fill" style="width:0%;background:${col}" data-w="${v}%"></div></div>
        </div>`;
      }
    } else {
      // Full audit: show all breakdown metrics
      const breakdownMap = {
        'Visual Clarity': REPORT.breakdown.visualClarity || 75,
        'Mobile Experience': REPORT.breakdown.mobileExperience || 75,
        Performance: REPORT.breakdown.performance || 75,
        Accessibility: REPORT.breakdown.accessibility || 75,
        'Navigation & IA': REPORT.breakdown.navigationIA || 75,
        'Conversion Optimization': REPORT.breakdown.conversionOptimization || 75,
        Trust: REPORT.breakdown.trust || 75,
      };
      for (const [k, v] of Object.entries(breakdownMap)) {
        const col = scoreColor(v);
        bd += `<div class="sc-item">
          <div class="sc-meta"><span>${k}</span><strong style="color:${col}">${v}</strong></div>
          <div class="bar-track"><div class="bar-fill" style="width:0%;background:${col}" data-w="${v}%"></div></div>
        </div>`;
      }
    }
  }

  // Build metrics from REPORT.metrics
  if (REPORT.metrics) {
    const metricKeys = Object.entries(REPORT.metrics);
    metricKeys.forEach(([k, v]) => {
      const label = k.charAt(0).toUpperCase() + k.slice(1).replace(/([A-Z])/g, ' $1');
      const cls =
        typeof v === 'string'
          ? v.includes('Optimized')
            ? 'good'
            : v.includes('At Risk')
              ? 'risk'
              : 'avg'
          : 'avg';
      metrics += `<div class="metric-card"><div class="mc-lbl">${label}</div><div class="mc-val ${cls}">${v}</div></div>`;
    });
  }

  // Build issues from high-impact recommendations only
  if (REPORT.recommendations && Array.isArray(REPORT.recommendations)) {
    const highImpactIssues = REPORT.recommendations.filter((rec) => rec.impact === 'High');
    highImpactIssues.forEach((rec) => {
      const fix = rec.recommendation || rec.businessValue || rec.fix;
      issues += `<div class="issue issue-crit">
        <span class="i-dot d-red"></span>
        <div class="issue-content">
          <div class="issue-text">${rec.issue}</div>
        </div>
      </div>
      <div class="issue issue-win">
        <span class="i-dot d-green"></span>
        <div class="issue-content">
          <div class="issue-text">${fix}</div>
        </div>
      </div>`;
    });
  }

  // Build recommendation cards from REPORT.recommendations
  if (REPORT.recommendations && Array.isArray(REPORT.recommendations)) {
    REPORT.recommendations.forEach((rec) => {
      const cat = rec.category;
      const impact = rec.impact.charAt(0).toUpperCase() + rec.impact.slice(1);
      const message = rec.recommendation || rec.message;
      const fix = rec.businessValue || rec.fix;
      recs += `<div class="rec-card">
        <div class="rec-top"><span class="rc-cat">${cat}</span><span class="rc-impact">Impact: ${impact}</span></div>
        <h4>${rec.issue}</h4>
        <p>${message}</p>
        <div class="rec-biz">💡 ${fix}</div>
      </div>`;
    });
  }

  // Set the results
  document.getElementById('ringNum').textContent = score;
  document.getElementById('ringGrade').textContent = grade;
  document.getElementById('resultsHeading').textContent = headingText;
  document.getElementById('resultsMessage').textContent =
    REPORT.message || 'Your site is performing well with opportunities to optimize further.';
  document.getElementById('urlPill').innerHTML =
    `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="blue" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg> <a target="_blank" href=https://${url}>https://${url}</a>`;
  document.getElementById('scoreBreakdown').innerHTML = bd;
  document.getElementById('metricsGrid').innerHTML = metrics;
  document.getElementById('issuesList').innerHTML =
    issues ||
    '<p style="color: var(--mist); font-style: italic;">No critical issues detected — great job!</p>';
  document.getElementById('recommendations').innerHTML = recs;

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const ring = document.getElementById('ring');
      if (ring) {
        const C = 2 * Math.PI * 38;
        ring.style.strokeDashoffset = C - (score / 100) * C;
        ring.style.stroke = sc;
      }
      document.querySelectorAll('.bar-fill').forEach((b) => {
        b.style.width = b.dataset.w;
      });
    }),
  );
}

function scoreColor(v) {
  return v >= 85 ? '#1BA43A' : v >= 70 ? '#007AA2' : v >= 55 ? '#F59E0B' : '#D41638';
}

async function sendEmail() {
  const emailValue = document.getElementById('emailIn').value.trim();
  const btnEmail = document.getElementById('btnEmail');

  if (!emailValue) {
    toast('Please enter your email to receive the report');
    return;
  }

  if (!REPORT) {
    toast('No report available to send');
    return;
  }

  // Set loading state
  if (btnEmail) {
    btnEmail.disabled = true;
    btnEmail.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg> Sending...`;
  }

  const score = REPORT.overallScore || REPORT.seoScore || REPORT.uxuiScore;
  const mode = picked || 'full';

  const emailData = {
    email: emailValue,
    data: {
      url: auditUrl,
      mode: mode,
      grade: REPORT.grade,
      score: score,
      label: REPORT.label || (mode === 'seo' ? 'SEO' : mode === 'uxui' ? 'UX/UI' : 'Health'),
      message: REPORT.message || '',
      breakdown: REPORT.breakdown || {},
      metrics: REPORT.metrics,
      quickWins: REPORT.quickWins || REPORT.recommendations || [],
      recommendations: REPORT.recommendations || [],
      criticalIssueCount: REPORT.criticalIssueCount || REPORT.criticalIssues?.length || 0,
      timestamp: REPORT.timestamp || new Date().toISOString(),
    },
  };

  try {
    const response = await fetch('/api/audit/send-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailData),
    });

    const result = await response.json();
    if (response.ok) {
      toast('Report sent to ' + emailValue);
      if (btnEmail) {
        btnEmail.innerHTML = `Sent! <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>`;
      }
    } else {
      toast(result.message || 'Failed to send report');
      resetEmailBtn(btnEmail);
    }
  } catch (error) {
    console.error('Email send error:', error);
    toast('Failed to send report');
    resetEmailBtn(btnEmail);
  }
}

function resetEmailBtn(btnEmail) {
  if (btnEmail) {
    btnEmail.disabled = false;
    btnEmail.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Email My Report`;
  }
}
function toast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

function reset() {
  picked = null;
  clearInterval(timer);
  stopPolling();
  stopWatchdog();
  REPORT = null;
  auditUrl = '';
  document.getElementById('urlIn').value = '';
  document.getElementById('emailIn').value = '';
  document.querySelectorAll('.audit-card').forEach((c) => c.classList.remove('selected'));
  clearSavedState();
  document.getElementById('mFooter').innerHTML = `
    <button class="btn-back" id="bBack" style="display:none">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      Back
    </button>
    <button class="btn-primary" id="bNext">
      Continue
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </button>`;
  // re-attach event listeners after DOM update
  const bBack = document.getElementById('bBack');
  const bNext = document.getElementById('bNext');
  if (bBack) bBack.addEventListener('click', goBack);
  if (bNext) bNext.addEventListener('click', goNext);
  setStep(1);
}
