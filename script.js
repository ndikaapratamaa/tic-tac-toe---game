const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const boardCard = canvas.closest('.board-card');
  const boardPanel = document.getElementById('boardPanel');

  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let size = 400;
  let cell = size / 3;

  // ----- Game state (unchanged logic) -----
  let board = Array(9).fill(null);
  let currentPlayer = 'X';
  let gameOver = false;
  let vsBot = false;

  const WIN_LINES = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];

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

  // ----- Leaderboard Pemain (global, terpisah dari statistik per-mode) -----
  // Daftar nama pemain tetap, dan disimpan di localStorage secara independen
  // supaya tidak tercampur/berubah oleh fitur skor, streak, atau achievement
  // yang sudah ada.
  const PLAYER_LB_KEY = 'tttPlayerLeaderboardV1';

  // ----- Konfigurasi simulasi kenaikan per pemain (khusus demo) -----
  // Atur di sini untuk mengubah perilaku tiap pemain secara independen:
  //   name             - nama pemain (harus unik, dipakai sebagai kunci data)
  //   initialWins      - jumlah kemenangan awal sebelum simulasi berjalan
  //   initialDelayMs   - jeda sebelum kenaikan PERTAMA pemain ini (waktu awal
  //                      berbeda per pemain supaya tidak naik bersamaan)
  //   intervalMs       - jarak waktu rata-rata antar kenaikan berikutnya
  //   intervalJitterMs - besar randomisasi (+/-) yang ditambahkan ke setiap
  //                      interval (termasuk kenaikan pertama) supaya jadwal
  //                      tidak pernah persis sama tiap siklus
  //   minAmount/maxAmount - rentang jumlah win yang ditambahkan tiap kenaikan
  const PLAYER_SIM_CONFIG = [
    { name: 'Raka',          initialWins: 0, initialDelayMs: 0,                intervalMs: 5  * 60 * 60 * 1000, intervalJitterMs: 2 * 60 * 60 * 1000, minAmount: 1, maxAmount: 2 },
    { name: 'Dimas sapzz',   initialWins: 0, initialDelayMs: 40  * 60 * 1000,  intervalMs: 8  * 60 * 60 * 1000, intervalJitterMs: 4 * 60 * 60 * 1000, minAmount: 1, maxAmount: 3 },
    { name: 'Fajar Rama M.', initialWins: 0, initialDelayMs: 95  * 60 * 1000,  intervalMs: 12 * 60 * 60 * 1000, intervalJitterMs: 5 * 60 * 60 * 1000, minAmount: 1, maxAmount: 2 },
    { name: 'maulana?',      initialWins: 0, initialDelayMs: 150 * 60 * 1000,  intervalMs: 6  * 60 * 60 * 1000, intervalJitterMs: 3 * 60 * 60 * 1000, minAmount: 1, maxAmount: 4 },
    { name: 'Ardi Nugraha',  initialWins: 0, initialDelayMs: 210 * 60 * 1000,  intervalMs: 20 * 60 * 60 * 1000, intervalJitterMs: 8 * 60 * 60 * 1000, minAmount: 2, maxAmount: 3 },
    { name: 'Aditya',        initialWins: 0, initialDelayMs: 260 * 60 * 1000,  intervalMs: 4  * 60 * 60 * 1000, intervalJitterMs: 2 * 60 * 60 * 1000, minAmount: 1, maxAmount: 2 },
    { name: 'Kevin cuyy',    initialWins: 0, initialDelayMs: 320 * 60 * 1000,  intervalMs: 15 * 60 * 60 * 1000, intervalJitterMs: 6 * 60 * 60 * 1000, minAmount: 1, maxAmount: 3 }
  ];
  const SIM_MIN_INTERVAL_FLOOR_MS = 15 * 60 * 1000; // batas bawah antar kenaikan, jaga-jaga jika jitter besar
  const SIM_CHECK_INTERVAL_MS = 5 * 60 * 1000; // cek ulang tiap 5 menit selama tab terbuka
  const SIM_MAX_CATCHUP_STEPS = 200; // jaga-jaga agar tidak infinite loop jika offline sangat lama

  function getPlayerSimConfig(name) {
    return PLAYER_SIM_CONFIG.find(cfg => cfg.name === name);
  }

  // Interval berikutnya = intervalMs pemain tsb +/- intervalJitterMs acak,
  // dibulatkan dan tidak pernah di bawah SIM_MIN_INTERVAL_FLOOR_MS.
  function randomSimInterval(config) {
    const jitter = config.intervalJitterMs || 0;
    const offset = jitter > 0 ? (Math.random() * jitter * 2 - jitter) : 0;
    return Math.round(Math.max(config.intervalMs + offset, SIM_MIN_INTERVAL_FLOOR_MS));
  }

  function randomSimAmount(config) {
    const min = Number.isFinite(config.minAmount) ? config.minAmount : 1;
    const max = Number.isFinite(config.maxAmount) ? config.maxAmount : min;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  // Sedikit randomisasi (+/-) yang dipakai khusus untuk menggeser jadwal
  // kenaikan PERTAMA pemain, terpisah dari randomisasi interval berikutnya.
  function randomStartJitter(config) {
    const jitter = config.intervalJitterMs || 0;
    return jitter > 0 ? Math.round(Math.random() * jitter * 2 - jitter) : 0;
  }

  function firstBumpAt(now, cfg) {
    return Math.max(now, now + (cfg.initialDelayMs || 0) + randomStartJitter(cfg));
  }

  function defaultPlayerLeaderboard() {
    const now = Date.now();
    return PLAYER_SIM_CONFIG.map(cfg => ({
      name: cfg.name,
      wins: cfg.initialWins || 0,
      // Waktu awal tiap pemain berbeda (initialDelayMs) plus sedikit
      // randomisasi tambahan supaya kenaikan pertama tidak pernah bersamaan.
      nextBumpAt: firstBumpAt(now, cfg)
    }));
  }

  function loadPlayerLeaderboard() {
    try {
      const raw = localStorage.getItem(PLAYER_LB_KEY);
      if (!raw) return defaultPlayerLeaderboard();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return defaultPlayerLeaderboard();
      const byName = new Map(
        parsed.filter(p => p && typeof p.name === 'string').map(p => [p.name, p])
      );
      // Selalu kembalikan nama-nama dari konfigurasi (jaga urutan awal), pakai
      // kemenangan tersimpan jika ada, atau initialWins konfigurasi jika belum
      // pernah tersimpan. Jadwal kenaikan otomatis (nextBumpAt) juga
      // dipertahankan per nama, atau dibuat baru sesuai konfigurasi pemain
      // tsb jika belum pernah ada.
      const now = Date.now();
      return PLAYER_SIM_CONFIG.map(cfg => {
        const saved = byName.get(cfg.name);
        const wins = saved && Number.isFinite(saved.wins) ? saved.wins : (cfg.initialWins || 0);
        const nextBumpAt = saved && Number.isFinite(saved.nextBumpAt)
          ? saved.nextBumpAt
          : firstBumpAt(now, cfg);
        return { name: cfg.name, wins, nextBumpAt };
      });
    } catch (e) {
      return defaultPlayerLeaderboard();
    }
  }

  function savePlayerLeaderboard() {
    try {
      localStorage.setItem(PLAYER_LB_KEY, JSON.stringify(playerLeaderboard));
    } catch (e) {
      /* localStorage unavailable — fail silently */
    }
  }

  let playerLeaderboard = loadPlayerLeaderboard();

  // Terapkan kenaikan yang "sudah waktunya" berdasarkan jadwal tersimpan
  // (menangani waktu yang berlalu sejak kunjungan terakhir), memakai
  // konfigurasi interval/jumlah milik masing-masing pemain, lalu jadwalkan
  // pengecekan berkala selama halaman tetap terbuka. Fungsi ini hanya
  // menyentuh playerLeaderboard/PLAYER_LB_KEY — tidak pernah mengubah
  // stats/scores/streak/achievement milik user.
  function runSimulatedLeaderboardGrowth() {
    const now = Date.now();
    let changed = false;
    playerLeaderboard.forEach(entry => {
      const cfg = getPlayerSimConfig(entry.name);
      if (!cfg) return; // pemain tidak lagi terdaftar di konfigurasi
      let steps = 0;
      while (entry.nextBumpAt <= now && steps < SIM_MAX_CATCHUP_STEPS) {
        entry.wins += randomSimAmount(cfg);
        entry.nextBumpAt = entry.nextBumpAt + randomSimInterval(cfg);
        changed = true;
        steps++;
      }
    });
    if (changed) {
      savePlayerLeaderboard();
      renderPlayerLeaderboard();
    }
  }

  const playerLbListEl = document.getElementById('playerLbList');

  function renderPlayerLeaderboard() {
    const ranked = playerLeaderboard
      .map((p, i) => ({ ...p, order: i }))
      .sort((a, b) => b.wins - a.wins || a.order - b.order);
    playerLbListEl.innerHTML = '';
    ranked.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'player-lb-row' + (i === 0 && p.wins > 0 ? ' is-leader' : '');
      li.innerHTML = `
        <span class="player-lb-rank">#${i + 1}</span>
        <span class="player-lb-name">${p.name}</span>
        <span class="player-lb-score">${p.wins}</span>
      `;
      playerLbListEl.appendChild(li);
    });
  }

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

  function updateLeaderboardUI() {
    lbListEl.innerHTML = '';
    if (!stats.leaderboard.length) {
      const li = document.createElement('li');
      li.className = 'lb-empty';
      li.textContent = 'Menang 2x berturut-turut untuk masuk papan peringkat.';
      lbListEl.appendChild(li);
      return;
    }
    stats.leaderboard.forEach((entry, i) => {
      const li = document.createElement('li');
      li.className = 'lb-row';
      li.innerHTML = `
        <span class="lb-rank">#${i + 1}</span>
        <span class="lb-badge lb-${entry.player.toLowerCase()}">${entry.player}</span>
        <span class="lb-meta">
          <span class="lb-count">${entry.count}x berturut-turut</span>
          <span class="lb-date">${formatDate(entry.date)}</span>
        </span>
      `;
      lbListEl.appendChild(li);
    });
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

  // ----- Live Leaderboard Pemain (Firebase Firestore, real-time lintas pengunjung) -----
  // Terpisah total dari "Leaderboard Pemain" demo di atas (yang isinya 7
  // nama tetap dengan simulasi kenaikan). Kartu ini isinya PEMAIN ASLI:
  // nama diambil dari Profile yang sudah dibuat, dan win/loss/draw dikirim
  // ke Firestore setiap kali menang/kalah/seri di mode Lawan Bot, lalu
  // disiarkan secara live (onSnapshot) ke semua pengunjung web lain.
  //
  // CARA MENGAKTIFKAN:
  //   1. Buat project gratis di https://console.firebase.google.com
  //   2. Aktifkan Firestore Database (mode production/locked, lalu pasang
  //      security rules di bawah).
  //   3. Project settings -> General -> Your apps -> tambah "Web app" ->
  //      copy objek firebaseConfig ke FIREBASE_CONFIG di bawah ini.
  //   4. Firestore Rules (Firestore -> Rules), supaya publik hanya bisa
  //      baca dan menaikkan angka wajar (bukan menulis bebas):
  //
  //      rules_version = '2';
  //      service cloud.firestore {
  //        match /databases/{database}/documents {
  //          match /players/{playerId} {
  //            allow read: if true;
  //            allow create: if request.resource.data.wins is int
  //              && request.resource.data.losses is int
  //              && request.resource.data.draws is int
  //              && request.resource.data.matches is int
  //              && request.resource.data.name is string
  //              && request.resource.data.name.size() <= 24;
  //            allow update: if request.resource.data.name is string
  //              && request.resource.data.name.size() <= 24
  //              && request.resource.data.wins is int
  //              && request.resource.data.wins <= resource.data.wins + 1
  //              && request.resource.data.losses is int
  //              && request.resource.data.losses <= resource.data.losses + 1
  //              && request.resource.data.draws is int
  //              && request.resource.data.draws <= resource.data.draws + 1;
  //          }
  //        }
  //      }
  //
  // Selama FIREBASE_CONFIG masih placeholder, fitur ini otomatis nonaktif
  // (tanpa error) dan kartunya menampilkan status "belum diatur" — jadi
  // file ini tetap aman dibuka apa adanya sebelum config diisi.
  const FIREBASE_CONFIG = {
    apiKey: 'GANTI_DENGAN_API_KEY',
    authDomain: 'GANTI_DENGAN_PROJECT.firebaseapp.com',
    projectId: 'GANTI_DENGAN_PROJECT_ID',
    storageBucket: 'GANTI_DENGAN_PROJECT.appspot.com',
    messagingSenderId: 'GANTI_DENGAN_SENDER_ID',
    appId: 'GANTI_DENGAN_APP_ID'
  };

  const LIVE_PLAYER_ID_KEY = 'tttLivePlayerIdV1';
  const liveLbListEl = document.getElementById('liveLbList');
  const liveLbStatusEl = document.getElementById('liveLbStatus');
  const liveDotEl = document.getElementById('liveDot');

  function isFirebaseConfigured() {
    return !!FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith('GANTI_');
  }

  // Setiap browser/perangkat punya satu ID acak tersimpan sendiri, dipakai
  // sebagai kunci dokumen Firestore-nya supaya kemenangan dari perangkat
  // ini selalu terakumulasi ke baris yang sama (bukan menimpa punya orang
  // lain yang kebetulan pakai nama sama).
  function getOrCreateLivePlayerId() {
    try {
      let id = localStorage.getItem(LIVE_PLAYER_ID_KEY);
      if (!id) {
        id = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(LIVE_PLAYER_ID_KEY, id);
      }
      return id;
    } catch (e) {
      return 'p_' + Math.random().toString(36).slice(2, 10);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  let liveDb = null;

  function setLiveStatus(text, state) {
    liveLbStatusEl.textContent = text;
    liveDotEl.className = 'live-dot' + (state ? ' live-dot-' + state : '');
  }

  function renderLiveLeaderboard(players) {
    liveLbListEl.innerHTML = '';
    if (!players.length) {
      const li = document.createElement('li');
      li.className = 'lb-empty';
      li.textContent = 'Belum ada data. Menangkan pertandingan mode Lawan Bot untuk tampil di sini.';
      liveLbListEl.appendChild(li);
      return;
    }
    players.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'player-lb-row' + (i === 0 && p.wins > 0 ? ' is-leader' : '');
      li.innerHTML = `
        <span class="player-lb-rank">#${i + 1}</span>
        <span class="player-lb-name">${escapeHtml(p.name || 'Pemain')}</span>
        <span class="player-lb-score">${p.wins || 0}</span>
      `;
      liveLbListEl.appendChild(li);
    });
  }

  function initLiveLeaderboard() {
    if (!isFirebaseConfigured()) {
      setLiveStatus('Belum diatur — isi FIREBASE_CONFIG di script.js', 'off');
      return;
    }
    if (typeof firebase === 'undefined') {
      setLiveStatus('SDK Firebase gagal dimuat', 'error');
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      liveDb = firebase.firestore();
      setLiveStatus('Menghubungkan...', 'connecting');

      liveDb.collection('players').orderBy('wins', 'desc').limit(20)
        .onSnapshot(
          snapshot => {
            renderLiveLeaderboard(snapshot.docs.map(d => d.data()));
            setLiveStatus('Live — tersinkron ke semua pengunjung', 'live');
          },
          err => {
            console.error('Live leaderboard error:', err);
            setLiveStatus('Gagal terhubung ke server', 'error');
          }
        );
    } catch (e) {
      console.error('Firebase init error:', e);
      setLiveStatus('Gagal terhubung ke server', 'error');
    }
  }

  // Kirim hasil (mode Lawan Bot saja) ke Firestore untuk profil aktif.
  // Mode 2 Pemain sengaja tidak dikirim karena satu perangkat dipakai
  // bergantian oleh dua orang, jadi tidak jelas kemenangan itu milik siapa.
  // Tidak pernah mengirim foto profil supaya datanya tetap ringan.
  function reportLiveResult(outcome) {
    if (!liveDb || !profile || !profile.name) return;
    const ref = liveDb.collection('players').doc(getOrCreateLivePlayerId());
    const field = outcome === 'win' ? 'wins' : outcome === 'loss' ? 'losses' : 'draws';
    liveDb.runTransaction(tx => tx.get(ref).then(snap => {
      const data = snap.exists ? snap.data() : { name: profile.name, wins: 0, losses: 0, draws: 0, matches: 0 };
      data.name = profile.name;
      data[field] = (data[field] || 0) + 1;
      data.matches = (data.matches || 0) + 1;
      data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      tx.set(ref, data);
    })).catch(e => console.error('Gagal mengirim hasil live:', e));
  }

  initLiveLeaderboard();

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
    cell = size / 3;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduceMotion) drawBoard();
  }

  function cellCenter(idx) {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    return { x: col * cell + cell / 2, y: row * cell + cell / 2 };
  }

  function drawGrid() {
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    for (let i = 1; i < 3; i++) {
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
    const [a, , c] = winInfo.line;
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

  // ----- Game logic (unchanged) -----
  function checkWinner() {
    for (const line of WIN_LINES) {
      const [a, b, c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return { winner: board[a], line };
      }
    }
    if (board.every(cellVal => cellVal !== null)) {
      return { winner: 'draw', line: null };
    }
    return null;
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

    // Live Leaderboard: hanya mode Lawan Bot, karena pemain manusia selalu
    // berperan sebagai X di mode ini.
    if (vsBot) {
      const outcome = result.winner === 'draw' ? 'draw' : (result.winner === 'X' ? 'win' : 'loss');
      reportLiveResult(outcome);
    }
  }

  function botMove() {
    const empty = board.map((v, i) => v === null ? i : null).filter(v => v !== null);
    if (empty.length === 0) return;
    const pick = empty[Math.floor(Math.random() * empty.length)];
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
    if (col < 0 || col > 2 || row < 0 || row > 2) return -1;
    return row * 3 + col;
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
    board = Array(9).fill(null);
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

  function switchMode(toVsBot) {
    if (vsBot === toVsBot) return;
    vsBot = toVsBot;
    stats = loadStats(currentStatsKey());
    scores = stats.scores;
    updateScoreLabels();
    refreshStatsUI();
    resetGame();
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
  renderPlayerLeaderboard();
  runSimulatedLeaderboardGrowth();
  setInterval(runSimulatedLeaderboardGrowth, SIM_CHECK_INTERVAL_MS);
  checkAchievements(false);
  resizeCanvas();
  updateTurnUI();
  if (reduceMotion) {
    drawBoard();
  } else {
    requestAnimationFrame(loop);
  }
