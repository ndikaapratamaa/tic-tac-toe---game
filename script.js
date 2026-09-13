const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const boardCard = canvas.closest('.board-card');
  const boardPanel = document.getElementById('boardPanel');

  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let size = 400;

  // ----- Sistem tingkat kesulitan (mode Lawan Bot) -----
  // Tiap level menentukan ukuran papan (n x n) dan panjang garis menang
  // (winLen sel berurutan). Untuk 3x3, winLen == n (baris penuh, sama
  // seperti Tic Tac Toe klasik). Untuk papan yang lebih besar, winLen
  // dikunci di 4 supaya permainan tetap punya ritme wajar — butuh baris
  // penuh 5-6 sel nyaris mustahil dan cuma akan membuat semua permainan
  // berakhir seri.
  const DIFFICULTIES = {
    easy:    { key: 'easy',    label: 'Mudah',   meta: '3×3', n: 3, winLen: 3, botLevel: 'random' },
    normal:  { key: 'normal',  label: 'Normal',  meta: '4×4', n: 4, winLen: 4, botLevel: 'medium' },
    hard:    { key: 'hard',    label: 'Hard',    meta: '5×5', n: 5, winLen: 4, botLevel: 'hard' },
    extreme: { key: 'extreme', label: 'Ekstrem', meta: '6×6', n: 6, winLen: 4, botLevel: 'extreme' }
  };

  let boardN = 3;
  let winLen = 3;
  let cell = size / boardN;
  let currentDifficulty = 'easy';

  function computeWinLines(n, len) {
    const lines = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c <= n - len; c++) {
        const line = [];
        for (let k = 0; k < len; k++) line.push(r * n + (c + k));
        lines.push(line);
      }
    }
    for (let c = 0; c < n; c++) {
      for (let r = 0; r <= n - len; r++) {
        const line = [];
        for (let k = 0; k < len; k++) line.push((r + k) * n + c);
        lines.push(line);
      }
    }
    for (let r = 0; r <= n - len; r++) {
      for (let c = 0; c <= n - len; c++) {
        const line = [];
        for (let k = 0; k < len; k++) line.push((r + k) * n + (c + k));
        lines.push(line);
      }
    }
    for (let r = 0; r <= n - len; r++) {
      for (let c = len - 1; c < n; c++) {
        const line = [];
        for (let k = 0; k < len; k++) line.push((r + k) * n + (c - k));
        lines.push(line);
      }
    }
    return lines;
  }

  // ----- Game state (logika dasar tidak berubah, hanya digeneralisasi) -----
  let winLines = computeWinLines(boardN, winLen);
  let board = Array(boardN * boardN).fill(null);
  let currentPlayer = 'X';
  let gameOver = false;
  let vsBot = false;

  function applyBoardConfig(n, len) {
    boardN = n;
    winLen = len;
    winLines = computeWinLines(n, len);
    canvas.setAttribute('aria-label', `Papan permainan Tic Tac Toe, ${n} kali ${n} kotak`);
  }

  // ----- Visual-only state -----
  let hoverIdx = -1;
  let placedAt = {};        // idx -> timestamp, for scale-in animation
  let winInfo = null;       // { line, startTime }
  const MARK_ANIM_MS = 220;
  const LINE_ANIM_MS = 320;

  const X_COLOR = getComputedStyle(document.documentElement).getPropertyValue('--x-color').trim();
  const O_COLOR = getComputedStyle(document.documentElement).getPropertyValue('--o-color').trim();
  const LINE_COLOR = 'rgba(237, 239, 246, 0.16)';

  const statusEl = document.getElementById('status');
  const scoreXEl = document.getElementById('scoreX');
  const scoreOEl = document.getElementById('scoreO');
  const scoreDrawEl = document.getElementById('scoreDraw');
  const turnXEl = document.getElementById('turnX');
  const turnOEl = document.getElementById('turnO');
  const scoreItemX = document.getElementById('scoreItemX');
  const scoreItemO = document.getElementById('scoreItemO');
  const scoreItemDraw = document.getElementById('scoreItemDraw');
  const scoreLabelX = document.getElementById('scoreLabelX');
  const scoreLabelO = document.getElementById('scoreLabelO');
  let scores = { X: 0, O: 0, draw: 0 };

  // ----- Persistent stats: Win Streak + Leaderboard (localStorage) -----
  // Setiap mode (2 Pemain / Lawan Bot) punya key localStorage sendiri, jadi
  // skor, streak, leaderboard, dan achievement kedua mode tidak pernah
  // tercampur maupun terbawa saat berpindah mode.
  const STATS_KEYS = {
    vsPlayer: 'tttStatsV1_vsPlayer',
    vsBot: 'tttStatsV1_vsBot'
  };
  function currentStatsKey() {
    return vsBot ? STATS_KEYS.vsBot : STATS_KEYS.vsPlayer;
  }

  // Migrasi satu kali: versi lama menyimpan statistik gabungan (2 Pemain dan
  // Lawan Bot tercampur) di bawah key 'tttStatsV1'. Karena data lama itu
  // tidak bisa dipetakan secara akurat ke salah satu mode, key lama cukup
  // dihapus supaya kedua mode baru mulai bersih dari 0 dan benar-benar
  // terpisah sejak awal.
  (function migrateLegacyStats() {
    try {
      localStorage.removeItem('tttStatsV1');
    } catch (e) {
      /* localStorage unavailable — skip migration silently */
    }
  })();
  const streakFlameEl = document.getElementById('streakFlame');
  const streakValueEl = document.getElementById('streakValue');
  const streakBestEl = document.getElementById('streakBest');
  const lbListEl = document.getElementById('lbList');
  const statsResetBtn = document.getElementById('statsResetBtn');
  const achvGridEl = document.getElementById('achvGrid');
  const achvToastContainer = document.getElementById('achvToastContainer');

  // ----- Achievements -----
  const ACHIEVEMENTS = [
    {
      id: 'first_win',
      icon: 'fa-solid fa-star',
      title: 'First Win',
      desc: 'Menangkan pertandingan pertama kali',
      check: (s) => (s.scores.X + s.scores.O) >= 1
    },
    {
      id: 'five_wins',
      icon: 'fa-solid fa-trophy',
      title: '5 Wins',
      desc: 'Total menang 5 kali',
      check: (s) => (s.scores.X + s.scores.O) >= 5
    },
    {
      id: 'streak_5',
      icon: 'fa-solid fa-bolt',
      title: 'Win Streak 5',
      desc: 'Menang 5x berturut-turut',
      check: (s) => s.bestStreak.count >= 5
    }
  ];

  let achvToastQueue = [];
  let achvToastActive = false;

  function renderAchievements() {
    achvGridEl.innerHTML = '';
    ACHIEVEMENTS.forEach(a => {
      const unlocked = stats.achievements.includes(a.id);
      const div = document.createElement('div');
      div.className = 'achv-item' + (unlocked ? ' unlocked' : '');
      div.title = unlocked ? a.desc : `Terkunci — ${a.desc}`;
      div.innerHTML = `
        <div class="achv-icon"><i class="${unlocked ? a.icon : 'fa-solid fa-lock'}"></i></div>
        <span class="achv-name">${a.title}</span>
      `;
      achvGridEl.appendChild(div);
    });
  }

  function showNextAchvToast() {
    if (!achvToastQueue.length) { achvToastActive = false; return; }
    achvToastActive = true;
    const a = achvToastQueue.shift();
    const toast = document.createElement('div');
    toast.className = 'achv-toast';
    toast.innerHTML = `
      <div class="achv-toast-icon"><i class="${a.icon}"></i></div>
      <div class="achv-toast-text">
        <span class="achv-toast-label">Achievement Terbuka</span>
        <span class="achv-toast-title">${a.title}</span>
      </div>
    `;
    achvToastContainer.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    const holdMs = reduceMotion ? 2200 : 2600;
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
        showNextAchvToast();
      }, reduceMotion ? 0 : 400);
    }, holdMs);
  }

  function checkAchievements(announce) {
    let changed = false;
    ACHIEVEMENTS.forEach(a => {
      if (!stats.achievements.includes(a.id) && a.check(stats)) {
        stats.achievements.push(a.id);
        changed = true;
        if (announce) {
          achvToastQueue.push(a);
        }
      }
    });
    if (changed) saveStats();
    renderAchievements();
    if (announce && achvToastQueue.length && !achvToastActive) {
      showNextAchvToast();
    }
  }

  function defaultStats() {
    return {
      scores: { X: 0, O: 0, draw: 0 },
      streak: { player: null, count: 0 },
      bestStreak: { player: null, count: 0 },
      leaderboard: [], // { player, count, date }
      achievements: [] // array of unlocked achievement ids
    };
  }

  function loadStats(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaultStats();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultStats(), parsed);
    } catch (e) {
      return defaultStats();
    }
  }

  function saveStats() {
    try {
      localStorage.setItem(currentStatsKey(), JSON.stringify(stats));
    } catch (e) {
      /* localStorage unavailable (private mode, quota, etc.) — fail silently */
    }
  }

  let stats = loadStats(currentStatsKey());
  scores = stats.scores; // keep existing score-card logic untouched, backed by persisted object

  // Menampilkan ulang seluruh panel statistik (skor, streak, leaderboard,
  // achievement) sesuai data mode yang sedang aktif.
  function refreshStatsUI() {
    scoreXEl.textContent = scores.X;
    scoreOEl.textContent = scores.O;
    scoreDrawEl.textContent = scores.draw;
    updateStreakUI();
    updateLeaderboardUI();
    renderAchievements();
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    } catch (e) {
      return '';
    }
  }

  function updateStreakUI() {
    const { player, count } = stats.streak;
    if (!player || count < 1) {
      streakValueEl.textContent = 'Belum ada streak';
      streakFlameEl.className = 'streak-flame';
    } else {
      streakValueEl.innerHTML = `<b class="streak-${player.toLowerCase()}-text">${player}</b> menang ${count}x berturut-turut`;
      streakFlameEl.className = 'streak-flame streak-' + player.toLowerCase();
    }
    const best = stats.bestStreak;
    streakBestEl.textContent = (best.player && best.count > 0)
      ? `Rekor terbaik: ${best.player} x${best.count}`
      : 'Rekor terbaik: -';
  }

  const MEDALS = ['gold', 'silver', 'bronze'];
  const LB_MAX_SLOTS = 5; // data tetap disimpan top 5, hanya tampilan yang diringkas
  const LB_VISIBLE_RANKS = 3;

  function updateLeaderboardUI() {
    lbListEl.innerHTML = '';
    for (let i = 0; i < LB_VISIBLE_RANKS; i++) {
      const entry = stats.leaderboard[i];
      const medal = MEDALS[i];
      const li = document.createElement('li');
      li.className = 'lb-row' + (medal ? ' lb-row-' + medal : '') + (entry ? '' : ' lb-row-empty');
      const rankHtml = `<span class="lb-rank${medal ? ' lb-rank-' + medal : ''}">${i + 1}.</span>`;
      if (entry) {
        li.innerHTML = `
          ${rankHtml}
          <span class="lb-badge lb-${entry.player.toLowerCase()}">${entry.player}</span>
          <span class="lb-meta">
            <span class="lb-count">${entry.count}x berturut-turut</span>
            <span class="lb-date">${formatDate(entry.date)}</span>
          </span>
        `;
      } else {
        li.innerHTML = `
          ${rankHtml}
          <span class="lb-placeholder">???</span>
        `;
      }
      lbListEl.appendChild(li);
    }
    const dst = document.createElement('li');
    dst.className = 'lb-dst';
    dst.textContent = 'dst.';
    lbListEl.appendChild(dst);
  }

  function finalizeStreak() {
    if (stats.streak.player && stats.streak.count >= 2) {
      stats.leaderboard.push({
        player: stats.streak.player,
        count: stats.streak.count,
        date: new Date().toISOString()
      });
      stats.leaderboard.sort((a, b) => b.count - a.count);
      stats.leaderboard = stats.leaderboard.slice(0, 5);
    }
  }

  function recordStreak(winner) {
    // Win Streak (dan leaderboard turunannya) hanya boleh berubah di mode
    // "Lawan Bot". Mode "2 Pemain" tidak menambah maupun mereset streak.
    if (vsBot) {
      if (winner === 'draw') {
        finalizeStreak();
        stats.streak = { player: null, count: 0 };
      } else {
        if (stats.streak.player === winner) {
          stats.streak.count++;
        } else {
          finalizeStreak();
          stats.streak = { player: winner, count: 1 };
        }
        if (stats.streak.count > stats.bestStreak.count) {
          stats.bestStreak = { player: winner, count: stats.streak.count };
        }
      }
    }
    saveStats();
    updateStreakUI();
    updateLeaderboardUI();
    checkAchievements(true);
  }

  // ----- Reset stats confirmation modal -----
  const statsResetOverlay = document.getElementById('statsResetOverlay');
  const statsResetCancelBtn = document.getElementById('statsResetCancelBtn');
  const statsResetConfirmBtn = document.getElementById('statsResetConfirmBtn');
  let statsResetLastFocus = null;

  function openStatsResetModal() {
    statsResetLastFocus = document.activeElement;
    statsResetOverlay.classList.add('show');
    statsResetConfirmBtn.focus();
    document.addEventListener('keydown', onStatsResetKeydown);
  }

  function closeStatsResetModal() {
    statsResetOverlay.classList.remove('show');
    document.removeEventListener('keydown', onStatsResetKeydown);
    if (statsResetLastFocus) statsResetLastFocus.focus();
  }

  function onStatsResetKeydown(e) {
    if (e.key === 'Escape') closeStatsResetModal();
  }

  statsResetBtn.addEventListener('click', openStatsResetModal);
  statsResetCancelBtn.addEventListener('click', closeStatsResetModal);
  statsResetOverlay.addEventListener('click', (e) => {
    if (e.target === statsResetOverlay) closeStatsResetModal();
  });

  statsResetConfirmBtn.addEventListener('click', () => {
    stats = defaultStats();
    scores = stats.scores;
    saveStats();
    refreshStatsUI();
    closeStatsResetModal();
  });

  // ----- Profile Setup / Edit (nama + foto avatar, tersimpan di localStorage) -----
  // Foto dibaca langsung dari perangkat lewat FileReader (data URL) dan
  // tidak pernah diunggah ke server mana pun. Sebelum disimpan, foto
  // diperkecil lewat <canvas> supaya ukurannya tetap ringan untuk
  // localStorage. Fitur ini berdiri sendiri dan tidak menyentuh state
  // game/skor/streak/leaderboard yang sudah ada.
  const PROFILE_KEY = 'tttProfileV1';
  const AVATAR_MAX_DIMENSION = 256;
  const AVATAR_JPEG_QUALITY = 0.85;

  function loadProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.name !== 'string') return null;
      return { name: parsed.name, avatar: typeof parsed.avatar === 'string' ? parsed.avatar : null };
    } catch (e) {
      return null;
    }
  }

  function saveProfile(profile) {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (e) {
      /* localStorage unavailable atau kuota penuh — fail silently */
    }
  }

  let profile = loadProfile();

  const profileBadge = document.getElementById('profileBadge');
  const profileAvatarImg = document.getElementById('profileAvatarImg');
  const profileAvatarFallback = document.getElementById('profileAvatarFallback');
  const profileNameLabel = document.getElementById('profileNameLabel');

  const profileModalOverlay = document.getElementById('profileModalOverlay');
  const profileModalTitle = document.getElementById('profileModalTitle');
  const profileModalSub = document.getElementById('profileModalSub');
  const profileEditAvatarImg = document.getElementById('profileEditAvatarImg');
  const profileEditAvatarFallback = document.getElementById('profileEditAvatarFallback');
  const avatarPickBtn = document.getElementById('avatarPickBtn');
  const avatarRemoveBtn = document.getElementById('avatarRemoveBtn');
  const avatarFileInput = document.getElementById('avatarFileInput');
  const profileNameInput = document.getElementById('profileNameInput');
  const profileError = document.getElementById('profileError');
  const profileCancelBtn = document.getElementById('profileCancelBtn');
  const profileSaveBtn = document.getElementById('profileSaveBtn');

  let profileModalMode = 'edit'; // 'setup' (wajib diisi, tanpa Batal) atau 'edit'
  let pendingAvatar = null;      // data URL avatar yang sedang diedit di modal (belum disimpan)
  let profileLastFocus = null;

  function initials(name) {
    const trimmed = (name || '').trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
  }

  function setAvatarVisual(imgEl, fallbackEl, dataUrl, name) {
    if (dataUrl) {
      imgEl.src = dataUrl;
      imgEl.hidden = false;
      fallbackEl.hidden = true;
    } else {
      imgEl.src = '';
      imgEl.hidden = true;
      fallbackEl.hidden = false;
      fallbackEl.textContent = initials(name);
    }
  }

  function renderProfileBadge() {
    if (profile && profile.name) {
      profileNameLabel.textContent = profile.name;
      setAvatarVisual(profileAvatarImg, profileAvatarFallback, profile.avatar, profile.name);
    } else {
      profileNameLabel.textContent = 'Atur Profil';
      setAvatarVisual(profileAvatarImg, profileAvatarFallback, null, '');
    }
  }

  // Resize + kompres foto lewat canvas supaya hemat ruang localStorage,
  // lalu kembalikan sebagai data URL (JPEG). Tetap 100% di sisi klien.
  function resizeImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Gagal memuat gambar'));
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > AVATAR_MAX_DIMENSION) {
            height = Math.round(height * (AVATAR_MAX_DIMENSION / width));
            width = AVATAR_MAX_DIMENSION;
          } else if (height >= width && height > AVATAR_MAX_DIMENSION) {
            width = Math.round(width * (AVATAR_MAX_DIMENSION / height));
            height = AVATAR_MAX_DIMENSION;
          }
          const canvasEl = document.createElement('canvas');
          canvasEl.width = width;
          canvasEl.height = height;
          const cctx = canvasEl.getContext('2d');
          cctx.drawImage(img, 0, 0, width, height);
          resolve(canvasEl.toDataURL('image/jpeg', AVATAR_JPEG_QUALITY));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  avatarPickBtn.addEventListener('click', () => avatarFileInput.click());

  avatarFileInput.addEventListener('change', async () => {
    const file = avatarFileInput.files && avatarFileInput.files[0];
    avatarFileInput.value = ''; // supaya bisa pilih file yang sama lagi jika perlu
    if (!file || !file.type.startsWith('image/')) return;
    try {
      pendingAvatar = await resizeImageFile(file);
      setAvatarVisual(profileEditAvatarImg, profileEditAvatarFallback, pendingAvatar, profileNameInput.value);
      avatarRemoveBtn.hidden = false;
    } catch (e) {
      /* file tidak valid/gagal dibaca — biarkan avatar tidak berubah */
    }
  });

  avatarRemoveBtn.addEventListener('click', () => {
    pendingAvatar = null;
    setAvatarVisual(profileEditAvatarImg, profileEditAvatarFallback, null, profileNameInput.value);
    avatarRemoveBtn.hidden = true;
  });

  profileNameInput.addEventListener('input', () => {
    if (!profileError.hidden) profileError.hidden = true;
    if (!pendingAvatar) profileEditAvatarFallback.textContent = initials(profileNameInput.value);
  });

  function openProfileModal(mode) {
    profileModalMode = mode;
    const isSetup = mode === 'setup';
    profileModalTitle.textContent = isSetup ? 'Siapa nama kamu?' : 'Edit Profil';
    profileModalSub.hidden = false;
    profileCancelBtn.hidden = isSetup;

    pendingAvatar = profile ? profile.avatar : null;
    profileNameInput.value = profile ? profile.name : '';
    profileError.hidden = true;
    setAvatarVisual(profileEditAvatarImg, profileEditAvatarFallback, pendingAvatar, profileNameInput.value);
    avatarRemoveBtn.hidden = !pendingAvatar;

    profileLastFocus = document.activeElement;
    profileModalOverlay.classList.add('show');
    document.addEventListener('keydown', onProfileModalKeydown);
    setTimeout(() => profileNameInput.focus(), 0);
  }

  function closeProfileModal() {
    profileModalOverlay.classList.remove('show');
    document.removeEventListener('keydown', onProfileModalKeydown);
    if (profileLastFocus) profileLastFocus.focus();
  }

  function onProfileModalKeydown(e) {
    if (e.key === 'Escape' && profileModalMode !== 'setup') closeProfileModal();
  }

  profileBadge.addEventListener('click', () => openProfileModal('edit'));
  profileCancelBtn.addEventListener('click', closeProfileModal);
  profileModalOverlay.addEventListener('click', (e) => {
    if (e.target === profileModalOverlay && profileModalMode !== 'setup') closeProfileModal();
  });

  profileSaveBtn.addEventListener('click', () => {
    const name = profileNameInput.value.trim();
    if (!name) {
      profileError.hidden = false;
      profileNameInput.focus();
      return;
    }
    profile = { name, avatar: pendingAvatar || null };
    saveProfile(profile);
    renderProfileBadge();
    closeProfileModal();
  });

  // Tampilkan modal setup otomatis saat pertama kali membuka game (belum
  // ada profil tersimpan / nama kosong).
  renderProfileBadge();
  if (!profile || !profile.name) {
    openProfileModal('setup');
  }

  // ----- Unlock progress level Ekstrem (localStorage) -----
  // Ekstrem terkunci sampai pemain menang 50x di mode Lawan Bot (dihitung
  // gabungan dari semua level yang sudah terbuka). Progress ini terpisah
  // dari statistik skor/streak supaya tetap konsisten walau pemain
  // mereset statistik lewat tombol "Reset statistik".
  const EXTREME_UNLOCK_KEY = 'tttExtremeUnlockV1';
  const EXTREME_UNLOCK_WINS = 50;
  const DIFFICULTY_KEY = 'tttDifficultyV1';

  function loadExtremeUnlock() {
    try {
      const raw = localStorage.getItem(EXTREME_UNLOCK_KEY);
      if (!raw) return { wins: 0, unlocked: false };
      const parsed = JSON.parse(raw);
      return {
        wins: Number.isFinite(parsed.wins) ? parsed.wins : 0,
        unlocked: !!parsed.unlocked
      };
    } catch (e) {
      return { wins: 0, unlocked: false };
    }
  }

  function saveExtremeUnlock() {
    try {
      localStorage.setItem(EXTREME_UNLOCK_KEY, JSON.stringify(extremeUnlock));
    } catch (e) {
      /* localStorage unavailable — fail silently */
    }
  }

  let extremeUnlock = loadExtremeUnlock();

  function isExtremeUnlocked() {
    return extremeUnlock.unlocked || extremeUnlock.wins >= EXTREME_UNLOCK_WINS;
  }

  function registerBotWinForUnlock() {
    if (isExtremeUnlocked()) return;
    extremeUnlock.wins++;
    const justUnlocked = extremeUnlock.wins >= EXTREME_UNLOCK_WINS;
    if (justUnlocked) extremeUnlock.unlocked = true;
    saveExtremeUnlock();
    updateDifficultyUI();
    if (justUnlocked) showExtremeUnlockToast();
  }

  function showExtremeUnlockToast() {
    const toast = document.createElement('div');
    toast.className = 'achv-toast';
    toast.innerHTML = `
      <div class="achv-toast-icon"><i class="fa-solid fa-lock-open"></i></div>
      <div class="achv-toast-text">
        <span class="achv-toast-label">Level Terbuka</span>
        <span class="achv-toast-title">Ekstrem (6×6)</span>
      </div>
    `;
    achvToastContainer.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    const holdMs = reduceMotion ? 2200 : 2600;
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), reduceMotion ? 0 : 400);
    }, holdMs);
  }

  function loadDifficulty() {
    try {
      const raw = localStorage.getItem(DIFFICULTY_KEY);
      if (raw && DIFFICULTIES[raw]) return raw;
    } catch (e) {
      /* localStorage unavailable — fail silently */
    }
    return 'easy';
  }

  function saveDifficulty(diff) {
    try {
      localStorage.setItem(DIFFICULTY_KEY, diff);
    } catch (e) {
      /* localStorage unavailable — fail silently */
    }
  }

  // ----- Score-card labels adapt to game mode (values/logic unchanged) -----
  // Pemain selalu bermain sebagai X dan bot selalu sebagai O, jadi di mode
  // "Lawan Bot" label X/O cukup diganti jadi "Menang"/"Kalah" tanpa mengubah
  // angka scores.X / scores.O itu sendiri.
  function updateScoreLabels() {
    if (vsBot) {
      scoreLabelX.textContent = 'Menang';
      scoreLabelO.textContent = 'Kalah';
    } else {
      scoreLabelX.textContent = 'Menang X';
      scoreLabelO.textContent = 'Menang O';
    }
  }

  function easeOutBack(t) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  // ----- Canvas sizing (responsive) -----
  function resizeCanvas() {
    const rect = boardCard.getBoundingClientRect();
    const cssSize = Math.max(rect.width - (parseFloat(getComputedStyle(boardCard).paddingLeft) * 2), 200);
    size = cssSize;
    cell = size / boardN;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduceMotion) drawBoard();
  }

  function cellCenter(idx) {
    const col = idx % boardN;
    const row = Math.floor(idx / boardN);
    return { x: col * cell + cell / 2, y: row * cell + cell / 2 };
  }

  function drawGrid() {
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    for (let i = 1; i < boardN; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, size * 0.04);
      ctx.lineTo(i * cell, size * 0.96);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(size * 0.04, i * cell);
      ctx.lineTo(size * 0.96, i * cell);
      ctx.stroke();
    }
  }

  function drawHover() {
    if (hoverIdx < 0 || gameOver || board[hoverIdx]) return;
    if (vsBot && currentPlayer === 'O') return;
    const { x, y } = cellCenter(hoverIdx);
    const pad = cell * 0.09;
    const half = cell / 2 - pad;
    const color = currentPlayer === 'X' ? X_COLOR : O_COLOR;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.06;
    roundRect(x - half, y - half, half * 2, half * 2, 12);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawMark(mark, idx, now) {
    const { x: cx, y: cy } = cellCenter(idx);
    const placedTime = placedAt[idx];
    let scale = 1;
    if (!reduceMotion && placedTime) {
      const t = Math.min((now - placedTime) / MARK_ANIM_MS, 1);
      scale = t < 1 ? Math.max(easeOutBack(t), 0) : 1;
    }

    const r = cell * 0.26 * scale;
    if (r <= 0) return;

    const color = mark === 'X' ? X_COLOR : O_COLOR;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = cell * 0.052;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = reduceMotion ? 0 : 14;

    if (mark === 'X') {
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
      ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWinLine(now) {
    if (!winInfo) return;
    const line = winInfo.line;
    const a = line[0];
    const c = line[line.length - 1];
    const start = cellCenter(a);
    const end = cellCenter(c);
    const t = reduceMotion ? 1 : Math.min((now - winInfo.startTime) / LINE_ANIM_MS, 1);
    const curX = start.x + (end.x - start.x) * t;
    const curY = start.y + (end.y - start.y) * t;
    const color = board[a] === 'X' ? X_COLOR : O_COLOR;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = cell * 0.06;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = reduceMotion ? 0 : 20;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(curX, curY);
    ctx.stroke();
    ctx.restore();
  }

  function drawBoard(now) {
    now = now || performance.now();
    ctx.clearRect(0, 0, size, size);
    drawHover();
    drawGrid();
    board.forEach((mark, idx) => { if (mark) drawMark(mark, idx, now); });
    drawWinLine(now);
  }

  // Continuous render loop drives the entrance/win animations; on
  // reduced-motion systems we draw only on state changes instead.
  function loop(now) {
    drawBoard(now);
    requestAnimationFrame(loop);
  }

  // ----- Game logic (digeneralisasi untuk papan n x n) -----
  function checkWinnerOn(b, lines) {
    for (const line of lines) {
      const first = b[line[0]];
      if (first && line.every(idx => b[idx] === first)) {
        return { winner: first, line };
      }
    }
    if (b.every(cellVal => cellVal !== null)) {
      return { winner: 'draw', line: null };
    }
    return null;
  }

  function checkWinner() {
    return checkWinnerOn(board, winLines);
  }

  function setStatus(html, cls) {
    statusEl.innerHTML = html;
    statusEl.className = 'status-text' + (cls ? ' ' + cls : '');
  }

  function updateTurnUI() {
    turnXEl.classList.toggle('active', currentPlayer === 'X');
    turnOEl.classList.toggle('active', currentPlayer === 'O');
    boardPanel.classList.toggle('turn-o', currentPlayer === 'O');
    boardGlowSync();
  }

  function boardGlowSync() {
    const glowVar = currentPlayer === 'X' ? 'var(--x-glow)' : 'var(--o-glow)';
    document.getElementById('boardGlow').style.setProperty('--turn-glow', glowVar);
    document.documentElement.style.setProperty('--turn-glow', glowVar);
  }

  function updateStatusTurn() {
    setStatus(`Giliran <b>${currentPlayer}</b> untuk melangkah`);
    updateTurnUI();
  }

  function pulseScore(el) {
    el.classList.add('pulse');
    setTimeout(() => el.classList.remove('pulse'), 700);
  }

  function handleResult(result) {
    gameOver = true;
    if (result.winner === 'draw') {
      scores.draw++;
      scoreDrawEl.textContent = scores.draw;
      pulseScore(scoreItemDraw);
      setStatus('Hasilnya seri! Papan penuh.');
    } else {
      scores[result.winner]++;
      (result.winner === 'X' ? scoreXEl : scoreOEl).textContent = scores[result.winner];
      pulseScore(result.winner === 'X' ? scoreItemX : scoreItemO);
      setStatus(`<b>${result.winner}</b> memenangkan permainan`, result.winner === 'X' ? 'win-x' : 'win-o');
      winInfo = { line: result.line, startTime: performance.now() };
    }
    hoverIdx = -1;
    recordStreak(result.winner);
    if (vsBot && result.winner === 'X') {
      registerBotWinForUnlock();
    }
  }

  // ----- Kecerdasan bot, bertingkat sesuai difficulty -----
  function emptyIndices(b) {
    const out = [];
    for (let i = 0; i < b.length; i++) if (b[i] === null) out.push(i);
    return out;
  }

  function randomMove(empties) {
    return empties[Math.floor(Math.random() * empties.length)];
  }

  // Cari sel yang langsung membuat `player` menang bila diisi sekarang.
  function findImmediateWin(b, lines, player) {
    const empties = emptyIndices(b);
    for (const idx of empties) {
      b[idx] = player;
      const win = checkWinnerOn(b, lines);
      b[idx] = null;
      if (win && win.winner === player) return idx;
    }
    return -1;
  }

  // Skor heuristik papan dari sudut pandang bot (O): tiap garis yang
  // masih "hidup" (belum diblok lawan) menyumbang skor eksponensial
  // sesuai jumlah tanda yang sudah mengisinya — garis dengan banyak
  // tanda dan berpotensi menang dinilai jauh lebih tinggi.
  function evaluateLinesScore(b, lines) {
    let score = 0;
    for (const line of lines) {
      let o = 0, x = 0;
      for (const idx of line) {
        if (b[idx] === 'O') o++;
        else if (b[idx] === 'X') x++;
      }
      if (o > 0 && x > 0) continue;
      if (o > 0) score += Math.pow(9, o);
      else if (x > 0) score -= Math.pow(9, x) * 1.15;
    }
    return score;
  }

  // Batasi kandidat langkah di papan besar supaya pencarian tetap cepat:
  // hanya sel kosong yang bertetangga (radius 1) dengan sel terisi.
  function restrictCandidates(empties) {
    if (boardN <= 4 || empties.length === boardN * boardN) return empties;
    const set = new Set();
    for (let idx = 0; idx < board.length; idx++) {
      if (board[idx] === null) continue;
      const col = idx % boardN, row = Math.floor(idx / boardN);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = row + dr, c = col + dc;
          if (r >= 0 && r < boardN && c >= 0 && c < boardN) {
            const ni = r * boardN + c;
            if (board[ni] === null) set.add(ni);
          }
        }
      }
    }
    return set.size ? Array.from(set) : empties;
  }

  // Normal: menang/blok 1 langkah, selain itu asal-asalan.
  function mediumBotMove() {
    const empties = emptyIndices(board);
    const winIdx = findImmediateWin(board, winLines, 'O');
    if (winIdx !== -1) return winIdx;
    const blockIdx = findImmediateWin(board, winLines, 'X');
    if (blockIdx !== -1) return blockIdx;
    return randomMove(empties);
  }

  // Hard: menang/blok 1 langkah, lalu pilih sel bernilai heuristik
  // tertinggi (rakus, tanpa memikirkan balasan lawan).
  function hardBotMove() {
    const empties = emptyIndices(board);
    const winIdx = findImmediateWin(board, winLines, 'O');
    if (winIdx !== -1) return winIdx;
    const blockIdx = findImmediateWin(board, winLines, 'X');
    if (blockIdx !== -1) return blockIdx;
    let bestScore = -Infinity, bestMoves = [];
    for (const idx of empties) {
      board[idx] = 'O';
      const s = evaluateLinesScore(board, winLines);
      board[idx] = null;
      if (s > bestScore) { bestScore = s; bestMoves = [idx]; }
      else if (s === bestScore) bestMoves.push(idx);
    }
    return bestMoves.length ? randomMove(bestMoves) : randomMove(empties);
  }

  // Ekstrem: menang 1 langkah, lalu pencarian 2 langkah (gerakan bot ->
  // balasan terbaik lawan) supaya bot menghindari langkah yang membuka
  // peluang menang bagi lawan di giliran berikutnya.
  function extremeBotMove() {
    const winIdx = findImmediateWin(board, winLines, 'O');
    if (winIdx !== -1) return winIdx;

    const empties = emptyIndices(board);
    let candidates = restrictCandidates(empties);
    const blockIdx = findImmediateWin(board, winLines, 'X');
    if (blockIdx !== -1 && !candidates.includes(blockIdx)) candidates = candidates.concat(blockIdx);

    let bestScore = -Infinity, bestMoves = [];
    for (const idx of candidates) {
      board[idx] = 'O';
      const winNow = checkWinnerOn(board, winLines);
      let score;
      if (winNow && winNow.winner === 'O') {
        score = 100000;
      } else {
        const empties2 = emptyIndices(board);
        let candidates2 = restrictCandidates(empties2);
        const oppWinIdx = findImmediateWin(board, winLines, 'X');
        if (oppWinIdx !== -1 && !candidates2.includes(oppWinIdx)) candidates2 = candidates2.concat(oppWinIdx);
        if (!candidates2.length) {
          score = evaluateLinesScore(board, winLines);
        } else {
          let worst = Infinity;
          for (const idx2 of candidates2) {
            board[idx2] = 'X';
            const win2 = checkWinnerOn(board, winLines);
            const s2 = (win2 && win2.winner === 'X') ? -100000 : evaluateLinesScore(board, winLines);
            board[idx2] = null;
            if (s2 < worst) worst = s2;
          }
          score = worst;
        }
      }
      board[idx] = null;
      if (score > bestScore) { bestScore = score; bestMoves = [idx]; }
      else if (score === bestScore) bestMoves.push(idx);
    }
    return bestMoves.length ? randomMove(bestMoves) : (blockIdx !== -1 ? blockIdx : randomMove(empties));
  }

  function botMove() {
    const empties = emptyIndices(board);
    if (empties.length === 0) return;
    let pick;
    const level = DIFFICULTIES[currentDifficulty] ? DIFFICULTIES[currentDifficulty].botLevel : 'random';
    switch (level) {
      case 'medium': pick = mediumBotMove(); break;
      case 'hard': pick = hardBotMove(); break;
      case 'extreme': pick = extremeBotMove(); break;
      default: pick = randomMove(empties); break;
    }
    if (pick === undefined || pick === -1 || board[pick] !== null) pick = randomMove(empties);
    board[pick] = 'O';
    placedAt[pick] = performance.now();
  }

  function pointerToIdx(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = size / rect.width;
    const scaleY = size / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    const col = Math.floor(x / cell);
    const row = Math.floor(y / cell);
    if (col < 0 || col >= boardN || row < 0 || row >= boardN) return -1;
    return row * boardN + col;
  }

  canvas.addEventListener('mousemove', (e) => {
    hoverIdx = pointerToIdx(e.clientX, e.clientY);
    if (reduceMotion) drawBoard();
  });
  canvas.addEventListener('mouseleave', () => {
    hoverIdx = -1;
    if (reduceMotion) drawBoard();
  });

  canvas.addEventListener('click', (e) => {
    if (gameOver) return;
    if (vsBot && currentPlayer === 'O') return;

    const idx = pointerToIdx(e.clientX, e.clientY);
    if (idx < 0 || board[idx]) return;

    board[idx] = currentPlayer;
    placedAt[idx] = performance.now();
    let result = checkWinner();

    if (!result && vsBot && currentPlayer === 'X') {
      currentPlayer = 'O';
      updateTurnUI();
      setStatus(`Giliran <b>O</b> untuk melangkah`);
      if (reduceMotion) drawBoard();
      setTimeout(() => {
        botMove();
        result = checkWinner();
        if (result) {
          handleResult(result);
        } else {
          currentPlayer = 'X';
          updateStatusTurn();
        }
        if (reduceMotion) drawBoard();
      }, 380);
      return;
    }

    if (result) {
      handleResult(result);
    } else {
      currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
      updateStatusTurn();
    }
    if (reduceMotion) drawBoard();
  });

  document.getElementById('resetBtn').addEventListener('click', resetGame);

  function resetGame() {
    board = Array(boardN * boardN).fill(null);
    currentPlayer = 'X';
    gameOver = false;
    placedAt = {};
    winInfo = null;
    hoverIdx = -1;
    updateStatusTurn();
    if (reduceMotion) drawBoard();
  }

  const modeToggle = document.getElementById('modeToggle');
  const modeVsPlayer = document.getElementById('modeVsPlayer');
  const modeVsBot = document.getElementById('modeVsBot');

  // ----- Difficulty bar (hanya tampil saat mode Lawan Bot aktif) -----
  const difficultyBar = document.getElementById('difficultyBar');
  const diffButtons = Array.from(document.querySelectorAll('.diff-btn'));
  const difficultyUnlockNote = document.getElementById('difficultyUnlockNote');

  function showDifficultyBar(show) {
    difficultyBar.classList.toggle('show', show);
  }

  function updateDifficultyUI() {
    const unlocked = isExtremeUnlocked();
    diffButtons.forEach(btn => {
      const key = btn.dataset.diff;
      const isLockedBtn = key === 'extreme' && !unlocked;
      btn.classList.toggle('active', key === currentDifficulty);
      btn.classList.toggle('diff-locked', isLockedBtn);
      btn.setAttribute('aria-disabled', isLockedBtn ? 'true' : 'false');
      btn.setAttribute('aria-pressed', key === currentDifficulty ? 'true' : 'false');
      if (key === 'extreme') {
        const nameEl = btn.querySelector('.diff-name');
        if (nameEl) nameEl.textContent = unlocked ? 'Ekstrem' : '🔒 Ekstrem';
      }
    });
    if (unlocked) {
      difficultyUnlockNote.hidden = true;
    } else {
      difficultyUnlockNote.hidden = false;
      difficultyUnlockNote.innerHTML = `🔒 Menang 50x untuk membuka <span class="difficulty-unlock-progress">(${extremeUnlock.wins}/${EXTREME_UNLOCK_WINS} menang)</span>`;
    }
  }

  function setDifficulty(diff) {
    if (diff === 'extreme' && !isExtremeUnlocked()) diff = 'easy';
    currentDifficulty = diff;
    saveDifficulty(diff);
    const cfg = DIFFICULTIES[diff];
    applyBoardConfig(cfg.n, cfg.winLen);
    updateDifficultyUI();
    resetGame();
    resizeCanvas();
  }

  diffButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.diff;
      if (!DIFFICULTIES[key]) return;
      if (key === 'extreme' && !isExtremeUnlocked()) return;
      if (key === currentDifficulty) return;
      setDifficulty(key);
    });
  });

  function switchMode(toVsBot) {
    if (vsBot === toVsBot) return;
    vsBot = toVsBot;
    stats = loadStats(currentStatsKey());
    scores = stats.scores;
    updateScoreLabels();
    refreshStatsUI();
    showDifficultyBar(vsBot);
    if (vsBot) {
      let diff = loadDifficulty();
      if (diff === 'extreme' && !isExtremeUnlocked()) diff = 'easy';
      setDifficulty(diff);
    } else {
      applyBoardConfig(3, 3);
      resetGame();
      resizeCanvas();
    }
  }

  modeVsPlayer.addEventListener('click', () => {
    modeVsPlayer.classList.add('active');
    modeVsBot.classList.remove('active');
    modeToggle.classList.remove('bot');
    switchMode(false);
  });
  modeVsBot.addEventListener('click', () => {
    modeVsBot.classList.add('active');
    modeVsPlayer.classList.remove('active');
    modeToggle.classList.add('bot');
    switchMode(true);
  });

  window.addEventListener('resize', resizeCanvas);

  // ----- Init -----
  updateScoreLabels();
  refreshStatsUI();
  checkAchievements(false);
  updateDifficultyUI();
  showDifficultyBar(false);
  resizeCanvas();
  updateTurnUI();
  if (reduceMotion) {
    drawBoard();
  } else {
    requestAnimationFrame(loop);
  }
