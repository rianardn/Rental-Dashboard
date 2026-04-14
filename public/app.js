    // ═══════════════════════════════════════════════════════════════
    // PS3 Rental Manager - Railway Production Client
    // ═══════════════════════════════════════════════════════════════

    // Configuration
    const API_URL = ''; // Same origin (Railway serves both frontend and API)
    const POLL_INTERVAL = 10000; // 10 seconds for data fetching (allows text selection)
    const TIMER_INTERVAL = 1000; // 1 second for timer updates (smooth countdown)
    
    // Helpers - WIB timezone (UTC+7) for Indonesia
    function getWIBDateISO() {
      const now = new Date();
      const wibTime = new Date(now.getTime() + (7 * 60 * 60 * 1000)); // Add 7 hours
      return wibTime.toISOString().split('T')[0];
    }
    
    function getWIBDateDaysAgo(days) {
      const now = new Date();
      const wibTime = new Date(now.getTime() + (7 * 60 * 60 * 1000) - (days * 24 * 60 * 60 * 1000));
      return wibTime.toISOString().split('T')[0];
    }
    
    // State
    let authToken = localStorage.getItem('ps3_token');
    let currentUnitId = null;
    let settings = {};
    let units = [];
    let transactions = [];
    let expenses = [];
    let deletedTransactions = []; // Tempat sampah transaksi pendapatan
    let pollTimer = null;
    let timerInterval = null;

    // Global error handler for mobile debugging
    window.addEventListener('error', function(e) {
      showToast('JS Error: ' + e.message.substring(0, 50), 'error');
      console.error('Global error:', e.message, 'at', e.filename, ':', e.lineno);
    });
    let isOnline = true;
    
    // ═════════════════ Audio Warning System ═════════════════
    // Track which units have played warning sound (to avoid continuous playing)
    const warnedUnits = new Set();
    let activeAudioContext = null;
    let activeOscillators = [];
    let activeGainNodes = [];
    let alarmTimeout = null;
    let isMuted = false;
    
    // 4 Different RELAXING jingle patterns for each unit (frequencies in Hz)
    // Lower frequencies, longer durations, smoother tones - more "chill" vibe
    const JINGLE_PATTERNS = [
      // Unit 1: Gentle ascending chime (meditation style)
      [432, 0, 528, 0, 639, 0, 528],
      // Unit 2: Soft descending bells (wind chime feel)
      [600, 550, 500, 450, 400, 0, 400],
      // Unit 3: Calm wave pattern (ocean vibe)
      [396, 0, 417, 0, 396, 0, 417],
      // Unit 4: Peaceful intervals (tibetan bowl inspired)
      [432, 0, 432, 360, 432, 0, 288]
    ];
    
    // Stop all alarm sounds
    function stopAlarm() {
      isMuted = true;
      
      // Stop all active oscillators
      activeOscillators.forEach(osc => {
        try { osc.stop(); } catch(e) {}
      });
      activeOscillators = [];
      
      // Disconnect gain nodes
      activeGainNodes.forEach(gain => {
        try { gain.disconnect(); } catch(e) {}
      });
      activeGainNodes = [];
      
      // Clear timeout
      if (alarmTimeout) {
        clearTimeout(alarmTimeout);
        alarmTimeout = null;
      }
      
      // Close audio context
      if (activeAudioContext) {
        try { activeAudioContext.close(); } catch(e) {}
        activeAudioContext = null;
      }
      
      // Hide mute button
      document.getElementById('muteBtn')?.classList.remove('visible');
    }
    
    // Play relaxing alarm for 30 seconds with graceful tones
    async function playWarningJingle(unitIndex) {
      // Reset mute state for new alarm
      isMuted = false;
      
      // Show mute button
      document.getElementById('muteBtn')?.classList.add('visible');
      
      activeAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      const pattern = JINGLE_PATTERNS[unitIndex % 4];
      const startTime = Date.now();
      const DURATION = 30000; // 30 seconds
      
      // Play continuous gentle pattern for 30 seconds
      async function playPatternLoop() {
        if (isMuted || Date.now() - startTime >= DURATION) {
          stopAlarm();
          return;
        }
        
        // Play the relaxing pattern once
        for (let i = 0; i < pattern.length; i++) {
          if (isMuted) break;
          
          const freq = pattern[i];
          if (freq === 0) {
            await new Promise(r => setTimeout(r, 300));
            continue;
          }
          
          const osc = activeAudioContext.createOscillator();
          const gain = activeAudioContext.createGain();
          
          osc.connect(gain);
          gain.connect(activeAudioContext.destination);
          
          osc.frequency.value = freq;
          osc.type = 'sine'; // Smooth sine wave for relaxing tone
          
          // Gentle envelope - soft attack and release
          const now = activeAudioContext.currentTime;
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(0.15, now + 0.3); // Soft attack
          gain.gain.exponentialRampToValueAtTime(0.01, now + 1.2); // Long release
          
          osc.start(now);
          osc.stop(now + 1.3);
          
          activeOscillators.push(osc);
          activeGainNodes.push(gain);
          
          await new Promise(r => setTimeout(r, 400));
        }
        
        // Small pause between pattern loops
        if (!isMuted && Date.now() - startTime < DURATION) {
          await new Promise(r => setTimeout(r, 200));
          playPatternLoop();
        } else {
          stopAlarm();
        }
      }
      
      // Start the loop
      playPatternLoop();
      
      // Safety timeout
      alarmTimeout = setTimeout(() => {
        stopAlarm();
      }, DURATION + 1000);
    }

    // ═════════════════ API Client ═════════════════
    async function api(method, endpoint, body = null) {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      };
      if (body) options.body = JSON.stringify(body);
      
      try {
        const response = await fetch(`${API_URL}/api${endpoint}`, options);
        
        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        const isJson = contentType && contentType.includes('application/json');
        
        if (response.status === 401) {
          logout();
          throw new Error('Sesi berakhir - silakan login kembali');
        }
        
        if (!response.ok) {
          if (isJson) {
            const errorData = await response.json();
            // Buat custom error yang menyimpan data lengkap dari response
            const err = new Error(errorData.error || `Error ${response.status}`);
            err.status = response.status;
            err.data = errorData; // Simpan semua data termasuk requiresCancellation, schedule, dll
            throw err;
          } else {
            const text = await response.text();
            console.error('Server returned non-JSON error:', text.substring(0, 200));
            throw new Error(`Server error ${response.status}. Coba refresh halaman.`);
          }
        }
        
        if (!isJson) {
          const text = await response.text();
          console.error('Expected JSON, got:', text.substring(0, 200));
          throw new Error('Respons server tidak valid. Coba lagi.');
        }
        
        updateSyncStatus('synced');
        return await response.json();
      } catch (error) {
        updateSyncStatus('error');
        if (error.message.includes('Unexpected token') || error.message.includes('JSON')) {
          throw new Error('Kesalahan koneksi server. Coba refresh halaman.');
        }
        throw error;
      }
    }

    // ═════════════════ Auth Functions ═════════════════
    async function checkServer() {
      try {
        console.log('[checkServer] Fetching /ping...');
        const response = await fetch(`${API_URL}/ping`);
        console.log('[checkServer] Response status:', response.status);
        const data = await response.json();
        console.log('[checkServer] Data:', data);
        document.getElementById('loginStatus').textContent = `Server ready (v${data.version})`;
        document.getElementById('loginStatus').classList.add('connected');
        return true;
      } catch (e) {
        console.error('[checkServer] Error:', e.message);
        document.getElementById('loginStatus').textContent = 'Server offline - Check Railway deployment';
        document.getElementById('loginStatus').classList.add('error');
        return false;
      }
    }

    async function login(password) {
      try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Login failed');
        }
        
        const data = await response.json();
        authToken = data.token;
        localStorage.setItem('ps3_token', authToken);
        
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        
        initApp();
        showToast('Login successful', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    function logout() {
      authToken = null;
      localStorage.removeItem('ps3_token');
      if (pollTimer) clearInterval(pollTimer);
      document.getElementById('app').style.display = 'none';
      document.getElementById('loginScreen').style.display = 'flex';
      document.getElementById('loginPassword').value = '';
    }

    // ═════════════════ App Initialization ═════════════════
    async function initApp() {
      showLoading(true);
      try {
        await loadData();
        await loadStations(); // Load stations for Dashboard integration
        renderAll();
        startPolling();
        startTimers(); // Start timer updates separately (1 second interval)
        showLoading(false);
      } catch (error) {
        showLoading(false);
        showToast('Failed to load data: ' + error.message, 'error');
      }
    }

    async function loadData() {
      const data = await api('GET', '/db');
      settings = data.settings;
      units = data.units;
      transactions = data.transactions;
      expenses = data.expenses;
      
      // Update page title with business name from settings
      if (settings && settings.businessName) {
        document.getElementById('pageTitle').textContent = settings.businessName + ' - Manager';
        document.querySelector('.header-title').innerHTML = settings.businessName.replace(/(.+?)\s*(\S+)$/, '$1 <span>$2</span>') || settings.businessName;
      }
    }

    // Store previous data hashes for smart rendering
    let lastTransactionsHash = '';
    let lastExpensesHash = '';
    let lastStationsHash = '';
    
    function getDataHash(data) {
      // Simple hash of data length and last item ID/timestamp
      if (!data || data.length === 0) return 'empty';
      const lastItem = data[data.length - 1];
      return `${data.length}-${lastItem.id || ''}-${lastItem.endTime || lastItem.created_at || ''}`;
    }

    // Special hash for stations that checks is_valid and item_count
    function getStationsHash(stations) {
      if (!Array.isArray(stations) || stations.length === 0) return 'empty';
      // Check critical fields that affect UI: id, is_valid, item_count, active
      const summary = stations.map(s => 
        `${s.id}:${s.is_valid ? 1 : 0}:${s.item_count || 0}:${s.active ? 1 : 0}`
      ).join('|');
      return `${stations.length}-${summary}`;
    }
    
    function startPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        try {
          await loadData();
          await loadStations(); // Keep stations in sync for Dashboard
          
          // Smart render: only re-render if data actually changed
          const currentTxHash = getDataHash(transactions);
          const currentExpHash = getDataHash(expenses);
          const currentStationsHash = getStationsHash(stations);
          
          const txChanged = currentTxHash !== lastTransactionsHash;
          const expChanged = currentExpHash !== lastExpensesHash;
          const stationsChanged = currentStationsHash !== lastStationsHash;
          
          if (txChanged || expChanged) {
            lastTransactionsHash = currentTxHash;
            lastExpensesHash = currentExpHash;
            renderAll();
          }
          
          // Always update dashboard if stations changed (for SIAP/BELUM SIAP status sync)
          if (stationsChanged) {
            lastStationsHash = currentStationsHash;
            console.log('[Polling] Stations data changed, updating dashboard...');
            renderDashboard();
            // Also re-render stations list if on inventory tab
            if (document.getElementById('inventoryTabStations')?.style.display === 'block') {
              renderStations();
            }
          }
        } catch (e) {
          console.error('Poll error:', e);
        }
      }, POLL_INTERVAL);
    }

    // Separate timer update - runs every 1 second for smooth countdown (doesn't affect text selection)
    function startTimers() {
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        updateTimers();
      }, TIMER_INTERVAL);
    }

    function updateTimers() {
      // Update unit timers (legacy support)
      const unitDisplays = document.querySelectorAll('.timer-display[data-unit-id]');
      const stationDisplays = document.querySelectorAll('.timer-display[data-station-id]');
      const now = Date.now();
      const warnMs = settings.warnBefore * 60000;
      const FINAL_ALERT_SECONDS = 30;

      // Process unit displays (legacy)
      unitDisplays.forEach(display => {
        const unitId = parseInt(display.dataset.unitId);
        const startTime = parseInt(display.dataset.startTime);
        const duration = parseInt(display.dataset.duration);

        if (!startTime) return;

        const elapsed = now - startTime;
        const countdownEl = display.querySelector('[data-timer-type="countdown"]');
        const elapsedEl = display.querySelector('[data-timer-type="elapsed"]');

        if (elapsedEl) {
          elapsedEl.textContent = formatTime(elapsed);
        }

        if (countdownEl && duration > 0) {
          const remaining = (duration * 60000) - elapsed;
          const isWarning = remaining < warnMs && remaining > 0;
          const isExpired = remaining <= 0;
          const isFinal30Seconds = remaining <= (FINAL_ALERT_SECONDS * 1000) && remaining > 0;

          countdownEl.className = 'timer-countdown';
          if (isExpired) countdownEl.classList.add('expired');
          else if (isWarning) countdownEl.classList.add('warning');

          countdownEl.textContent = isExpired ? 'WAKTU HABIS' : formatTime(remaining);

          if (isFinal30Seconds && !warnedUnits.has('unit-' + unitId)) {
            warnedUnits.add('unit-' + unitId);
            const unitIndex = units.findIndex(u => u.id === unitId);
            if (unitIndex >= 0) playWarningJingle(unitIndex);
          }
          if (!isFinal30Seconds && warnedUnits.has('unit-' + unitId)) {
            warnedUnits.delete('unit-' + unitId);
          }
        }
      });

      // Process station displays (new)
      stationDisplays.forEach(display => {
        const stationId = display.dataset.stationId;
        const startTime = parseInt(display.dataset.startTime);
        const duration = parseInt(display.dataset.duration);

        if (!startTime) return;

        const elapsed = now - startTime;
        const countdownEl = display.querySelector('[data-timer-type="countdown"]');
        const elapsedEl = display.querySelector('[data-timer-type="elapsed"]');

        if (elapsedEl) {
          elapsedEl.textContent = formatTime(elapsed);
        }

        if (countdownEl && duration > 0) {
          const remaining = (duration * 60000) - elapsed;
          const isWarning = remaining < warnMs && remaining > 0;
          const isExpired = remaining <= 0;
          const isFinal30Seconds = remaining <= (FINAL_ALERT_SECONDS * 1000) && remaining > 0;

          countdownEl.className = 'timer-countdown';
          if (isExpired) countdownEl.classList.add('expired');
          else if (isWarning) countdownEl.classList.add('warning');

          countdownEl.textContent = isExpired ? 'WAKTU HABIS' : formatTime(remaining);

          // Play warning jingle for stations
          if (isFinal30Seconds && !warnedUnits.has('station-' + stationId)) {
            warnedUnits.add('station-' + stationId);
            const stationIndex = stations.findIndex(s => s.id === stationId);
            if (stationIndex >= 0) playWarningJingle(stationIndex % 4); // Cycle through 4 jingle patterns
          }
          if (!isFinal30Seconds && warnedUnits.has('station-' + stationId)) {
            warnedUnits.delete('station-' + stationId);
          }
        }
      });
    }

    // ═════════════════ Rendering ═════════════════
    function renderAll() {
      renderDashboard();
      renderReports();
      renderExpenses();
      updateClock();
    }

    function renderDashboard() {
      // Use stations array which is loaded from /api/pairings
      const activeStations = stations.filter(s => s.active);
      document.getElementById('statActive').textContent = activeStations.length;
      document.getElementById('totalStations').textContent = `${stations.length} stasiun`;

      // Calculate today's income (WIB timezone)
      const today = getWIBDateISO();
      const todayIncome = transactions
        .filter(t => t.date === today)
        .reduce((sum, t) => sum + (t.paid || 0), 0);
      document.getElementById('statIncome').textContent = formatMoney(todayIncome);

      // Render station cards
      const container = document.getElementById('stationsGrid');
      if (!container) return;
      
      if (stations.length === 0) {
        container.innerHTML = '<p class="empty-state-p20">Belum ada stasiun. Buat stasiun di menu Manajemen > Inventori > Stasiun.</p>';
        return;
      }
      
      container.innerHTML = stations.map(station => renderStationCard(station)).join('');
    }

    function renderStationCard(station) {
      const isActive = station.active;
      let timerHTML = '';

      if (isActive) {
        const elapsed = Date.now() - station.startTime;
        const remaining = station.duration > 0 ? (station.duration * 60000) - elapsed : null;

        if (remaining !== null) {
          const warnMs = settings.warnBefore * 60000;
          const isWarning = remaining < warnMs && remaining > 0;
          const isExpired = remaining <= 0;

          timerHTML = `
            <div class="timer-display" data-station-id="${station.id}" data-start-time="${station.startTime}" data-duration="${station.duration}">
              <div class="timer-countdown ${isWarning ? 'warning' : ''} ${isExpired ? 'expired' : ''}" data-timer-type="countdown">
                ${isExpired ? 'WAKTU HABIS' : formatTime(remaining)}
              </div>
              <div class="timer-elapsed" data-timer-type="elapsed">${formatTime(elapsed)}</div>
            </div>
          `;
        } else {
          // Open session (no duration limit)
          timerHTML = `
            <div class="timer-display" data-station-id="${station.id}" data-start-time="${station.startTime}" data-duration="0">
              <div class="timer-countdown infinite" data-timer-type="countdown">∞</div>
              <div class="timer-elapsed" data-timer-type="elapsed">${formatTime(elapsed)}</div>
            </div>
          `;
        }

        // Calculate estimated revenue based on elapsed time
        const elapsedMin = Math.floor(elapsed / 60000);
        const estimatedRevenue = Math.round((elapsedMin / 60) * (settings.ratePerHour || 4000));

        // Calculate end time
        const startDate = new Date(station.startTime);
        const endDate = station.duration > 0 ? new Date(station.startTime + station.duration * 60000) : null;
        const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' };
        const endTimeStr = endDate ? endDate.toLocaleTimeString('id-ID', timeOptions) : '∞';

        return `
          <div class="unit-card active" data-station-id="${station.id}" style="border: 2px solid var(--ps3-red);">
            <div class="unit-header">
              <div class="unit-name">${station.name}</div>
              <div class="unit-status-badge" style="background: var(--ps3-red); color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600;">AKTIF</div>
            </div>
            <div class="unit-body">
              <div class="customer-name">${station.customer || 'Walk-in'}</div>
              ${timerHTML}
              <div class="session-info" style="font-size: 0.75rem; color: var(--ps3-muted); margin-top: 8px;">
                <div>Selesai: ${endTimeStr}</div>
                <div>Estimasi: Rp${estimatedRevenue.toLocaleString()}</div>
              </div>
            </div>
            <div class="unit-actions">
              <button class="btn btn-stop" onclick="stopStation('${station.id}')">STOP</button>
            </div>
          </div>
        `;
      } else {
        // Inactive station - check if valid
        const isValid = station.is_valid;
        
        if (!isValid) {
          // Invalid station - show errors and disable click
          const errorList = station.validation_errors?.map(e => `• ${e}`).join('<br>') || 'Item belum lengkap';
          return `
            <div class="unit-card" data-station-id="${station.id}" style="cursor: not-allowed; opacity: 0.7; border: 2px solid var(--ps3-red);">
              <div class="unit-header">
                <div class="unit-name">${station.name}</div>
                <div class="unit-status-badge" style="background: var(--ps3-red); color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600;">BELUM SIAP</div>
              </div>
              <div class="unit-body" style="padding: 12px;">
                <div style="font-size: 0.75rem; color: var(--ps3-red); margin-bottom: 8px;">
                  <strong>Item belum terpasang:</strong>
                </div>
                <div style="font-size: 0.7rem; color: var(--ps3-text); line-height: 1.5;">
                  ${errorList}
                </div>
              </div>
            </div>
          `;
        }
        
        // Valid inactive station
        return `
          <div class="unit-card" data-station-id="${station.id}" onclick="openStartStationModal('${station.id}')" style="cursor: pointer; opacity: 0.9;">
            <div class="unit-header">
              <div class="unit-name">${station.name}</div>
              <div class="unit-status-badge" style="background: var(--ps3-surface); color: var(--ps3-muted); padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; border: 1px solid var(--ps3-border);">SIAP</div>
            </div>
            <div class="unit-body" style="text-align: center; padding: 20px 0;">
              <div style="font-size: 2rem; margin-bottom: 8px;">🎮</div>
              <div style="font-size: 0.85rem; color: var(--ps3-muted);">Klik untuk mulai</div>
            </div>
          </div>
        `;
      }
    }
    
    function renderDashboardUnitManagement() {
      const container = document.getElementById('dashUnitsManagement');
      if (!container) return;
      
      if (units.length === 0) {
        container.innerHTML = '<span style="color: var(--ps3-muted); font-size: 0.8rem;">Belum ada unit</span>';
        return;
      }
      
      container.innerHTML = units.map(unit => `
        <div class="unit-chip" style="
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: ${unit.active ? 'rgba(230,0,18,0.2)' : 'var(--ps3-surface)'};
          border: 1px solid ${unit.active ? 'var(--ps3-red)' : 'var(--ps3-border)'};
          border-radius: 8px;
          font-size: 0.85rem;
        ">
          <span class="fw-600">${unit.name}</span>
          ${unit.active ? '<span style="color: var(--ps3-red); font-size: 0.7rem;">(AKTIF)</span>' : `
            <button onclick="renameUnit(${unit.id}, '${unit.name}')" style="
              background: none; border: none; color: var(--ps3-muted); cursor: pointer;
              font-size: 0.75rem; padding: 2px 4px;
            " title="Ganti nama">✏️</button>
            <button onclick="deleteUnit(${unit.id})" style="
              background: none; border: none; color: var(--ps3-red); cursor: pointer;
              font-size: 0.75rem; padding: 2px 4px;
            " title="Hapus">🗑️</button>
          `}
        </div>
      `).join('');
    }

    function renderUnitCard(unit) {
      const isActive = unit.active;
      let timerHTML = '';
      
      if (isActive) {
        const elapsed = Date.now() - unit.startTime;
        const remaining = unit.duration > 0 ? (unit.duration * 60000) - elapsed : null;
        
        if (remaining !== null) {
          const warnMs = settings.warnBefore * 60000;
          const isWarning = remaining < warnMs && remaining > 0;
          const isExpired = remaining <= 0;
          
          // Note: Warning jingle logic moved to updateTimers() for real-time updates
          
          timerHTML = `
            <div class="timer-display" data-unit-id="${unit.id}" data-start-time="${unit.startTime}" data-duration="${unit.duration}">
              <div class="timer-countdown ${isWarning ? 'warning' : ''} ${isExpired ? 'expired' : ''}" data-timer-type="countdown">
                ${isExpired ? 'WAKTU HABIS' : formatTime(remaining)}
              </div>
              <div class="timer-elapsed" data-timer-type="elapsed">${formatTime(elapsed)}</div>
            </div>
          `;
        } else {
          // Open session (no duration limit)
          timerHTML = `
            <div class="timer-display" data-unit-id="${unit.id}" data-start-time="${unit.startTime}" data-duration="0">
              <div class="timer-countdown infinite" data-timer-type="countdown">∞</div>
              <div class="timer-elapsed" data-timer-type="elapsed">${formatTime(elapsed)}</div>
            </div>
          `;
        }
        
        // Calculate estimated revenue based on elapsed time
        const elapsedMin = Math.floor(elapsed / 60000);
        const estimatedRevenue = Math.round((elapsedMin / 60) * (settings.ratePerHour || 4000));
        
        // Calculate end time
        const startDate = new Date(unit.startTime);
        const endDate = unit.duration > 0 ? new Date(unit.startTime + (unit.duration * 60000)) : null;
        
        timerHTML += `
          <div class="customer-info">
            <div class="customer-info-row">
              <span class="customer-info-label">Pelanggan</span>
              <span class="customer-info-value" class="fw-700 text-primary">${unit.customer || '-'}</span>
            </div>
            <div class="customer-info-row">
              <span class="customer-info-label">Waktu Mulai</span>
              <span class="customer-info-value" class="fw-600 text-primary">${startDate.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false})} WIB</span>
            </div>
            ${endDate ? `
            <div class="customer-info-row">
              <span class="customer-info-label">Waktu Akhir</span>
              <span class="customer-info-value" class="fw-600 text-primary">${endDate.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false})} WIB</span>
            </div>
            ` : ''}
            <div class="customer-info-row">
              <span class="customer-info-label">Estimasi Pendapatan</span>
              <span class="customer-info-value" style="color: var(--ps3-green); font-weight: 700;">${formatMoney(estimatedRevenue)}</span>
            </div>
            ${unit.duration > 0 ? `
            <div class="customer-info-row">
              <span class="customer-info-label">Durasi</span>
              <span class="customer-info-value" class="fw-600 text-primary">${unit.duration} menit</span>
            </div>
            ` : ''}
            ${unit.note ? `
            <div class="customer-info-row">
              <span class="customer-info-label">Catatan</span>
              <span class="customer-info-value">${(() => {
              const txMatch = unit.note.match(/\[([A-Z]+-\d+)\](.*)/);
              if (txMatch) {
                const txId = txMatch[1];
                const actualNote = txMatch[2] ? txMatch[2].replace(/^ - /, '') : '';
                return `<span onclick="copyToClipboard('${txId}', this)" class="tx-badge-clickable" style="background: var(--ps3-green); color: #000; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; margin-right: 6px; cursor: pointer; user-select: none;" title="Klik untuk copy ID">📋 ${txId}</span>${actualNote ? `<span class="text-green">${actualNote}</span>` : ''}`;
              }
              return unit.note;
            })()}</span>
            </div>
            ` : ''}
          </div>
        `;
      }
      
      const isFromBooking = unit.note && /\[[A-Z]+-\d+\]/.test(unit.note);
      
      return `
        <div class="unit-card ${isActive ? 'active' : ''}">
          <div class="unit-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="unit-name">${unit.name}</div>
              ${isFromBooking ? '<span style="background: var(--ps3-green); color: #000; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 700;">📅 BOOKING</span>' : ''}
            </div>
            <div class="unit-status ${isActive ? 'active' : 'idle'}">
              ${isActive ? 'BERMAIN' : 'SIAP'}
            </div>
          </div>
          ${timerHTML}
          <div class="action-btns">
            ${isActive ? `
              <button class="btn-stop" onclick="stopSession(${unit.id})">AKHIRI</button>
            ` : `
              <button class="btn-start" onclick="startSession(${unit.id}, '${unit.name}')">MULAI</button>
            `}
          </div>
        </div>
      `;
    }

    function renderReports() {
      const period = document.querySelector('.tab.active')?.dataset.period || 'today';
      
      // Filter transactions (WIB timezone)
      let filtered = transactions;
      
      switch(period) {
        case 'today':
          const todayKey = getWIBDateISO();
          filtered = transactions.filter(t => t.date === todayKey);
          break;
        case 'week':
          const weekAgoWIB = getWIBDateDaysAgo(7);
          filtered = transactions.filter(t => t.date >= weekAgoWIB);
          break;
        case 'month':
          const wibNow = new Date(new Date().getTime() + (7 * 60 * 60 * 1000));
          const currentMonthPrefix = wibNow.toISOString().split('T')[0].slice(0, 7); // YYYY-MM
          filtered = transactions.filter(t => t.date && t.date.startsWith(currentMonthPrefix));
          break;
        case 'year':
          const wibYearTx = new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).getFullYear();
          filtered = transactions.filter(t => t.date && t.date.startsWith(wibYearTx + '-'));
          break;
      }
      
      const income = filtered.reduce((sum, t) => sum + (t.paid || 0), 0);
      
      // Filter expenses (WIB timezone)
      let filteredExpenses = expenses;
      switch(period) {
        case 'today':
          const todayKeyExp = getWIBDateISO();
          filteredExpenses = expenses.filter(e => e.date === todayKeyExp);
          break;
        case 'week':
          const weekAgoExpWIB = getWIBDateDaysAgo(7);
          filteredExpenses = expenses.filter(e => e.date >= weekAgoExpWIB);
          break;
        case 'month':
          const wibNowExp = new Date(new Date().getTime() + (7 * 60 * 60 * 1000));
          const currentMonthPrefixExp = wibNowExp.toISOString().split('T')[0].slice(0, 7);
          filteredExpenses = expenses.filter(e => e.date && e.date.startsWith(currentMonthPrefixExp));
          break;
        case 'year':
          const wibYearExp = new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).getFullYear();
          filteredExpenses = expenses.filter(e => e.date && e.date.startsWith(wibYearExp + '-'));
          break;
      }
      
      const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
      
      document.getElementById('reportIncome').textContent = formatMoney(income);
      document.getElementById('reportExpenses').textContent = formatMoney(totalExpenses);
      
      const profit = income - totalExpenses;
      const profitEl = document.getElementById('reportProfit');
      profitEl.textContent = formatMoney(profit);
      profitEl.classList.remove('profit', 'loss');
      profitEl.classList.add(profit >= 0 ? 'profit' : 'loss');
      
      document.getElementById('reportTransactions').textContent = filtered.length;

      // Render chart
      renderFinanceChart(period, filtered, filteredExpenses);

      // Render transactions list (max 5 latest)
      const container = document.getElementById('transactionsList');
      if (filtered.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📊</div>
            <div class="empty-state-text">Tidak ada transaksi untuk periode ini</div>
          </div>
        `;
      } else {
        // Sort by endTime descending (latest first)
        const sorted = filtered.sort((a, b) => (b.endTime || 0) - (a.endTime || 0));
        const latest5 = sorted.slice(0, 5);
        const hasMore = sorted.length > 5;
        
        container.innerHTML = latest5.map((t, index) => {
          const nomor = index + 1;
          return `
          <div style="background: rgba(34, 197, 94, 0.15); border: 2px solid var(--ps3-green); border-radius: 10px; padding: 14px; margin-bottom: 10px; position: relative;" data-tx-id="${t.id || ''}">
            <!-- Number Badge -->
            <div style="position: absolute; top: -8px; left: 10px; background: var(--ps3-green-dark); color: #fff; font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; z-index: 1;">${nomor}</div>
            <!-- Row 1: Date (left) + Amount (right) -->
            <div class="card-row-between">
              <div class="fs-9 text-muted fw-500">
                ${formatDateOnlyWIB(t.endTime)}
              </div>
              <div style="color: var(--ps3-green-dark); font-size: 1.15rem; font-weight: 600;">
                ${formatMoney(t.paid)}
              </div>
            </div>

            <!-- Row 2: Unit Name + Action Buttons -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: ${t.customer ? '6px' : '10px'};">
              <div class="fs-105 lh-14 flex-1 min-w-0 pr-10 text-primary">
                🎮 ${t.unitName || t.station_name || 'Unknown'}
              </div>
              <div class="flex-center-gap-4 flex-shrink-0">
                ${t.editCount > 0 ? `<button onclick="try { viewEditHistory('${t.id || ''}', '${(t.customer || 'No name').replace(/'/g, "\\'")}', '${t.unitName || t.station_name || 'Unknown'}'); } catch(e) { alert('Error: ' + e.message); }" class="icon-btn-green" title="Lihat riwayat edit">📋</button>` : ''}
                <button onclick="try { openEditModal('${t.id || ''}'); } catch(e) { alert('Error: ' + e.message); }" class="icon-btn-muted" title="Edit transaksi">✏️</button>
                <button onclick="try { openDeleteTransactionModal('${t.id || ''}', '${(t.customer || 'No name').replace(/'/g, "\\'")}', '${t.unitName || t.station_name || 'Unknown'}'); } catch(e) { alert('Error: ' + e.message); }" class="icon-btn-red" title="Hapus transaksi">🗑️</button>
              </div>
            </div>

            <!-- Row 3: Customer (left) + Note (right, if exists) -->
            ${t.customer || t.note ? `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.95rem; color: var(--ps3-text); margin-bottom: 10px; padding-left: 2px;">
              <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                ${t.customer ? `<span class="fs-1">👤</span><span>${t.customer}</span>` : ''}
              </div>
              ${t.note ? `<div style="text-align: right; font-style: italic; opacity: 0.8; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50%;">💬 ${t.note}</div>` : ''}
            </div>
            ` : ''}

            <!-- Row 4: Time | TX ID (centered) | Payment -->
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: var(--ps3-muted); padding-top: 8px; border-top: 1px solid var(--ps3-green); opacity: 0.85;">
              <div class="info-row-compact">
                <span>🕐</span>
                <span>${formatTimeOnlyWIB(t.endTime)}</span>
              </div>
              <div class="tab-btn-group">
                <span class="tx-id-label">TX ID:</span>
                <span onclick="copyToClipboard('${t.id || ''}')" class="tx-id-badge" title="Klik untuk copy ID" class="fs-75">${t.id || ''}</span>
              </div>
              <div class="text-right flex-1">
                💳 ${t.payment || 'cash'}
              </div>
            </div>

          </div>
        `;}).join('') + (hasMore ? `
          <div style="text-align: center; margin-top: 16px;">
            <button onclick="openAllTransactionsModal()" style="background: var(--ps3-surface); border: 1px solid var(--ps3-border); color: var(--ps3-text); padding: 12px 24px; border-radius: 10px; cursor: pointer; font-size: 0.95rem; display: inline-flex; align-items: center; gap: 8px;">
              <span>📋</span> Lihat Semua (${sorted.length} Transaksi)
            </button>
          </div>
        ` : '');
      }
    }

    // Alias for backward compatibility
    const updateReportStats = renderReports;

    function renderExpenses() {
      const container = document.getElementById('expensesList');
      const currentPeriod = document.querySelector('.tab.active')?.dataset.period || 'today';
      
      // Filter expenses based on current report period
      let filteredExpenses = [];
      const now = new Date();
      
      switch(currentPeriod) {
        case 'today': {
          const today = getWIBDateISO();
          filteredExpenses = expenses.filter(e => e.date === today);
          break;
        }
        case 'week': {
          const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
          filteredExpenses = expenses.filter(e => new Date(e.date) >= weekAgo);
          break;
        }
        case 'month': {
          const thisMonth = now.getMonth();
          const thisYear = now.getFullYear();
          filteredExpenses = expenses.filter(e => {
            const d = new Date(e.date);
            return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
          });
          break;
        }
        case 'year': {
          const thisYear = now.getFullYear();
          filteredExpenses = expenses.filter(e => new Date(e.date).getFullYear() === thisYear);
          break;
        }
        case 'all':
        default:
          filteredExpenses = expenses;
          break;
      }
      
      // Sort by date descending (latest first)
      filteredExpenses.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      // Take only latest 5 for display
      const latest5Expenses = filteredExpenses.slice(0, 5);
      const hasMoreExpenses = filteredExpenses.length > 5;
      
      if (filteredExpenses.length === 0) {
        const periodLabels = {
          'today': 'hari ini',
          'week': 'minggu ini',
          'month': 'bulan ini',
          'year': 'tahun ini',
          'all': 'semua periode'
        };
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">💸</div>
            <div class="empty-state-text">Belum ada pengeluaran ${periodLabels[currentPeriod] || 'pada periode ini'}</div>
          </div>
        `;
      } else {
        container.innerHTML = latest5Expenses.map((e, index) => {
          const catInfo = getExpenseCategoryInfo(e.item, e.category);
          const subCatEmoji = catInfo.subCategory ? getSubCategoryEmoji(catInfo.category, catInfo.subCategory) : '';
          const nomor = index + 1;
          return `
          <div style="background: rgba(220, 38, 38, 0.15); border: 2px solid var(--ps3-red-badge); border-radius: 10px; padding: 14px; margin-bottom: 10px; position: relative;" data-exp-id="${e.id || ''}">
            <!-- Number Badge -->
            <div class="badge-abs-top">${nomor}</div>
            <!-- Row 1: Date (left) + Amount (right) -->
            <div class="card-row-between">
              <div class="fs-9 text-muted fw-500">
                ${formatDateOnlyWIB(e.created_at)}
              </div>
              <div class="text-red fs-115 fw-600">
                ${formatMoney(e.amount)}
              </div>
            </div>

            <!-- Row 2: Category + Action Buttons -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: ${catInfo.subCategory ? '6px' : '10px'};">
              <div class="fs-105 lh-14 flex-1 min-w-0 pr-10 text-primary">
                ${catInfo.icon} ${catInfo.category}
              </div>
              <div class="flex-center-gap-4 flex-shrink-0">
                ${e.editCount > 0 ? `<button onclick="try { viewExpenseEditHistory('${e.id || ''}', '${(e.item || 'No item').replace(/'/g, "\\'")}'); } catch(e) { alert('Error: ' + e.message); }" class="icon-btn-green" title="Lihat riwayat">📋</button>` : ''}
                <button onclick="try { openEditExpenseModal('${e.id || ''}'); } catch(e) { alert('Error: ' + e.message); }" class="icon-btn-muted" title="Edit pengeluaran">✏️</button>
                <button onclick="try { openDeleteExpenseModal('${e.id || ''}', '${(e.item || 'No item').replace(/'/g, "\\'")}', ${e.amount}); } catch(e) { alert('Error: ' + e.message); }" class="icon-btn-red" title="Hapus pengeluaran">🗑️</button>
              </div>
            </div>

            <!-- Row 3: Sub-category (if exists) -->
            ${catInfo.subCategory ? `
            <div style="font-size: 0.95rem; color: var(--ps3-text); margin-bottom: 10px; padding-left: 2px; display: flex; align-items: center; gap: 6px;">
              <span class="fs-1">${subCatEmoji || '🏷️'}</span>
              <span>${catInfo.subCategory}</span>
            </div>
            ` : ''}

            <!-- Row 4: Time | TX ID (centered) | Note -->
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: var(--ps3-muted); padding-top: 8px; border-top: 1px solid var(--ps3-red-badge); opacity: 0.85;">
              <div class="info-row-compact">
                <span>🕐</span>
                <span>${formatTimeOnlyWIB(e.created_at)}</span>
              </div>
              <div class="tab-btn-group">
                <span class="tx-id-label">TX ID:</span>
                <span onclick="copyToClipboard('${e.id || ''}')" class="tx-id-badge" title="Klik untuk copy ID" class="fs-75">${e.id || ''}</span>
              </div>
              <div style="font-style: italic; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; flex: 1;">
                ${e.note ? `💬 ${e.note}` : ''}
              </div>
            </div>

          </div>
        `}).join('') + (hasMoreExpenses ? `
          <div style="text-align: center; margin-top: 16px;">
            <button onclick="openAllExpensesModal()" style="background: var(--ps3-surface); border: 1px solid var(--ps3-border); color: var(--ps3-text); padding: 12px 24px; border-radius: 10px; cursor: pointer; font-size: 0.95rem; display: inline-flex; align-items: center; gap: 8px;">
              <span>📋</span> Lihat Semua (${filteredExpenses.length} Pengeluaran)
            </button>
          </div>
        ` : '');
      }
    }

    // ═════════════════ Discord-like Search & Filter State ═════════════════
    let txSearchState = {
      search: '',
      customer: '',
      unit: '',
      payment: '',
      amountMin: '',
      amountMax: '',
      dateFrom: '',
      dateTo: '',
      note: '',
      sortBy: 'date',
      sortOrder: 'desc',
      page: 0,
      limit: 50,
      total: 0
    };

    let txSearchDebounceTimer = null;

    // ═════════════════ All Transactions/Expenses Modal Functions ═════════════════
    function openAllTransactionsModal() {
      // Reset search state but preserve current period context in date filters
      const currentPeriod = document.querySelector('.tab.active')?.dataset.period || 'today';
      const now = new Date();

      // Set default date range based on current period
      let dateFrom = '', dateTo = '';
      switch(currentPeriod) {
        case 'today':
          dateFrom = dateTo = getWIBDateISO();
          break;
        case 'week': {
          const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
          dateFrom = weekAgo.toISOString().split('T')[0];
          dateTo = getWIBDateISO();
          break;
        }
        case 'month': {
          const thisMonth = now.getMonth();
          const thisYear = now.getFullYear();
          dateFrom = `${thisYear}-${String(thisMonth + 1).padStart(2, '0')}-01`;
          dateTo = getWIBDateISO();
          break;
        }
        case 'year': {
          const thisYear = now.getFullYear();
          dateFrom = `${thisYear}-01-01`;
          dateTo = getWIBDateISO();
          break;
        }
        case 'all':
        default:
          dateFrom = '';
          dateTo = '';
          break;
      }

      // Reset search state with period-based defaults
      txSearchState = {
        search: '',
        customer: '',
        unit: '',
        payment: '',
        amountMin: '',
        amountMax: '',
        dateFrom: dateFrom,
        dateTo: dateTo,
        note: '',
        sortBy: 'date',
        sortOrder: 'desc',
        page: 0,
        limit: 50,
        total: 0
      };

      // Setup customer and unit autocomplete
      setupCustomerAutocomplete();
      setupUnitAutocomplete();

      // Sync UI with state
      syncTxSearchUI();

      // Clear previous results and show loading
      document.getElementById('allTransactionsList').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⏳</div>
          <div class="empty-state-text">Memuat transaksi...</div>
        </div>
      `;

      // Fetch data
      searchTransactions();

      openModal('modalAllTransactions');
    }

    // Customer autocomplete state
    let customerAutocompleteTimer = null;
    let uniqueCustomers = [];

    // Setup customer autocomplete from global transactions data
    function setupCustomerAutocomplete() {
      uniqueCustomers = [...new Set(transactions.map(t => t.customer).filter(Boolean))].sort();
    }

    // Immediate suggestion update + debounced search
    function onCustomerInput() {
      // Show suggestions immediately (no delay) with fresh highlight
      showCustomerSuggestions();
      
      // Debounce the actual transaction search
      if (customerAutocompleteTimer) {
        clearTimeout(customerAutocompleteTimer);
      }
      customerAutocompleteTimer = setTimeout(() => {
        updateTxSearchStateFromUI();
        searchTransactions();
      }, 300);
    }

    // Show autocomplete suggestions
    function showCustomerSuggestions() {
      const input = document.getElementById('txFilterCustomer');
      const dropdown = document.getElementById('customerSuggestions');
      const value = input.value.trim().toLowerCase();

      // Filter customers that match input (case-insensitive)
      const matches = value
        ? uniqueCustomers.filter(c => c.toLowerCase().includes(value))
        : uniqueCustomers.slice(0, 10); // Show first 10 if empty

      if (matches.length === 0) {
        dropdown.innerHTML = '<div class="suggestion-empty">Tidak ditemukan</div>';
      } else {
        dropdown.innerHTML = matches.map(customer => {
          // Highlight matching text
          const highlighted = value
            ? customer.replace(new RegExp(`(${escapeRegex(value)})`, 'gi'), '<mark>$1</mark>')
            : customer;
          return `<div class="suggestion-item" onclick="selectCustomer('${escapeHtml(customer)}')">${highlighted}</div>`;
        }).join('');
      }

      dropdown.style.display = 'block';

      // Close dropdown when clicking outside (use capture phase for better reliability)
      setTimeout(() => {
        document.addEventListener('click', hideCustomerSuggestionsOnClickOutside, { once: true, capture: true });
      }, 0);
    }

    // Hide suggestions when clicking outside
    function hideCustomerSuggestionsOnClickOutside(e) {
      const wrapper = document.querySelector('.autocomplete-wrapper');
      const dropdown = document.getElementById('customerSuggestions');
      
      // Check if click is outside both input and dropdown
      if (wrapper && !wrapper.contains(e.target)) {
        dropdown.style.display = 'none';
      } else {
        // Click was inside, re-add listener for next click
        document.addEventListener('click', hideCustomerSuggestionsOnClickOutside, { once: true, capture: true });
      }
    }

    // Hide autocomplete dropdown
    function hideCustomerSuggestions() {
      document.getElementById('customerSuggestions').style.display = 'none';
    }

    // Select a customer from suggestions
    function selectCustomer(customer) {
      document.getElementById('txFilterCustomer').value = customer;
      hideCustomerSuggestions();
      updateTxSearchStateFromUI();
      searchTransactions();
    }

    // ═════════════════ Unit Autocomplete Functions ═════════════════
    let unitAutocompleteTimer = null;
    let uniqueUnits = [];

    // Setup unit autocomplete from global transactions data
    function setupUnitAutocomplete() {
      uniqueUnits = [...new Set(transactions.map(t => t.unitName).filter(Boolean))].sort();
    }

    // Immediate suggestion update + debounced search
    function onUnitInput() {
      // Show suggestions immediately (no delay) with fresh highlight
      showUnitSuggestions();

      // Debounce the actual transaction search
      if (unitAutocompleteTimer) {
        clearTimeout(unitAutocompleteTimer);
      }
      unitAutocompleteTimer = setTimeout(() => {
        updateTxSearchStateFromUI();
        searchTransactions();
      }, 300);
    }

    // Show autocomplete suggestions for units
    function showUnitSuggestions() {
      const input = document.getElementById('txFilterUnit');
      const dropdown = document.getElementById('unitSuggestions');
      const value = input.value.trim().toLowerCase();

      // Filter units that match input (case-insensitive)
      const matches = value
        ? uniqueUnits.filter(u => u.toLowerCase().includes(value))
        : uniqueUnits.slice(0, 10); // Show first 10 if empty

      if (matches.length === 0) {
        dropdown.innerHTML = '<div class="suggestion-empty">Tidak ditemukan</div>';
      } else {
        dropdown.innerHTML = matches.map(unit => {
          // Highlight matching text
          const highlighted = value
            ? unit.replace(new RegExp(`(${escapeRegex(value)})`, 'gi'), '<mark>$1</mark>')
            : unit;
          return `<div class="suggestion-item" onclick="selectUnit('${escapeHtml(unit)}')">${highlighted}</div>`;
        }).join('');
      }

      dropdown.style.display = 'block';

      // Close dropdown when clicking outside
      setTimeout(() => {
        document.addEventListener('click', hideUnitSuggestionsOnClickOutside, { once: true, capture: true });
      }, 0);
    }

    // Hide suggestions when clicking outside
    function hideUnitSuggestionsOnClickOutside(e) {
      const input = document.getElementById('txFilterUnit');
      const dropdown = document.getElementById('unitSuggestions');

      // Check if click is outside both input and dropdown
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
      } else {
        // Click was inside, re-add listener for next click
        document.addEventListener('click', hideUnitSuggestionsOnClickOutside, { once: true, capture: true });
      }
    }

    // Hide unit autocomplete dropdown
    function hideUnitSuggestions() {
      document.getElementById('unitSuggestions').style.display = 'none';
    }

    // Select a unit from suggestions
    function selectUnit(unit) {
      document.getElementById('txFilterUnit').value = unit;
      hideUnitSuggestions();
      updateTxSearchStateFromUI();
      searchTransactions();
    }

    // Utility: escape regex special chars
    function escapeRegex(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Utility: escape HTML
    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // Sync UI elements with search state
    function syncTxSearchUI() {
      document.getElementById('txSearchInput').value = txSearchState.search;
      document.getElementById('txFilterCustomer').value = txSearchState.customer;
      document.getElementById('txFilterUnit').value = txSearchState.unit;
      document.getElementById('txFilterPayment').value = txSearchState.payment;
      document.getElementById('txFilterAmountMin').value = txSearchState.amountMin;
      document.getElementById('txFilterAmountMax').value = txSearchState.amountMax;
      document.getElementById('txFilterDateFrom').value = txSearchState.dateFrom;
      document.getElementById('txFilterDateTo').value = txSearchState.dateTo;
      document.getElementById('txFilterNote').value = txSearchState.note;
      document.getElementById('txSortBy').value = txSearchState.sortBy;
      document.getElementById('txSortOrder').value = txSearchState.sortOrder;
    }

    // Toggle filter panel visibility
    function toggleTxFilters() {
      const panel = document.getElementById('txFilterPanel');
      const isVisible = panel.style.display === 'block';
      panel.style.display = isVisible ? 'none' : 'block';
    }

    // Debounced search (300ms delay for typing)
    function debouncedSearchTransactions() {
      if (txSearchDebounceTimer) {
        clearTimeout(txSearchDebounceTimer);
      }
      txSearchDebounceTimer = setTimeout(() => {
        searchTransactions();
      }, 300);
    }

    // Read current filter values from UI and update state
    function updateTxSearchStateFromUI() {
      txSearchState.search = document.getElementById('txSearchInput').value.trim();
      txSearchState.customer = document.getElementById('txFilterCustomer').value;
      txSearchState.unit = document.getElementById('txFilterUnit').value;
      txSearchState.payment = document.getElementById('txFilterPayment').value;
      txSearchState.amountMin = document.getElementById('txFilterAmountMin').value;
      txSearchState.amountMax = document.getElementById('txFilterAmountMax').value;
      txSearchState.dateFrom = document.getElementById('txFilterDateFrom').value;
      txSearchState.dateTo = document.getElementById('txFilterDateTo').value;
      txSearchState.note = document.getElementById('txFilterNote').value.trim();
      txSearchState.sortBy = document.getElementById('txSortBy').value;
      txSearchState.sortOrder = document.getElementById('txSortOrder').value;
    }

    // Count active filters (excluding search and sort)
    function countActiveTxFilters() {
      let count = 0;
      if (txSearchState.customer) count++;
      if (txSearchState.unit) count++;
      if (txSearchState.payment) count++;
      if (txSearchState.amountMin || txSearchState.amountMax) count++;
      if (txSearchState.dateFrom || txSearchState.dateTo) count++;
      if (txSearchState.note) count++;
      return count;
    }

    // Update filter badge display
    function updateTxFilterBadge() {
      const count = countActiveTxFilters();
      const badge = document.getElementById('txActiveFilterCount');
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline';
      } else {
        badge.style.display = 'none';
      }
    }

    // Clear all filters
    function clearAllTxFilters() {
      txSearchState = {
        search: '',
        customer: '',
        unit: '',
        payment: '',
        amountMin: '',
        amountMax: '',
        dateFrom: '',
        dateTo: '',
        note: '',
        sortBy: 'date',
        sortOrder: 'desc',
        page: 0,
        limit: 50,
        total: 0
      };
      syncTxSearchUI();
      hideCustomerSuggestions();
      hideUnitSuggestions();
      document.getElementById('txFilterPanel').style.display = 'none';
      searchTransactions();
    }

    // Change page (-1 or +1)
    function changeTxPage(delta) {
      const newPage = txSearchState.page + delta;
      if (newPage < 0) return;

      const maxPage = Math.ceil(txSearchState.total / txSearchState.limit) - 1;
      if (newPage > maxPage) return;

      txSearchState.page = newPage;
      searchTransactions();
    }

    // Main search function - fetches from backend API
    async function searchTransactions() {
      updateTxSearchStateFromUI();
      updateTxFilterBadge();

      // Build query params
      const params = new URLSearchParams();
      params.set('limit', txSearchState.limit);
      params.set('offset', txSearchState.page * txSearchState.limit);

      if (txSearchState.search) params.set('search', txSearchState.search);
      if (txSearchState.customer) params.set('customer', txSearchState.customer);
      if (txSearchState.unit) params.set('unit', txSearchState.unit);
      if (txSearchState.payment) params.set('payment', txSearchState.payment);
      if (txSearchState.amountMin) params.set('amountMin', txSearchState.amountMin);
      if (txSearchState.amountMax) params.set('amountMax', txSearchState.amountMax);
      if (txSearchState.dateFrom) params.set('dateFrom', txSearchState.dateFrom);
      if (txSearchState.dateTo) params.set('dateTo', txSearchState.dateTo);
      if (txSearchState.note) params.set('note', txSearchState.note);
      params.set('sortBy', txSearchState.sortBy);
      params.set('sortOrder', txSearchState.sortOrder);

      try {
        const response = await fetch(`${API_URL}/api/transactions?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Update pagination state
        txSearchState.total = data.pagination?.total || 0;

        // Render results
        renderTxSearchResults(data.transactions || []);

        // Update pagination UI
        updateTxPaginationUI();

        // Update results count text
        const resultsText = data.pagination?.total > 0
          ? `${data.pagination.total} transaksi ditemukan`
          : 'Tidak ada transaksi';
        document.getElementById('txSearchResults').textContent = resultsText;

      } catch (error) {
        console.error('Search transactions failed:', error);
        document.getElementById('allTransactionsList').innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">❌</div>
            <div class="empty-state-text">Gagal memuat transaksi: ${error.message}</div>
          </div>
        `;
        document.getElementById('txSearchResults').textContent = 'Error loading data';
      }
    }

    // Render search results
    function renderTxSearchResults(transactions) {
      const container = document.getElementById('allTransactionsList');

      if (transactions.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">🔍</div>
            <div class="empty-state-text">Tidak ada transaksi sesuai filter</div>
            <div class="label-xs-muted" class="mt-8">
              Coba ubah filter atau reset pencarian
            </div>
          </div>
        `;
        return;
      }

      container.innerHTML = transactions.map((t, index) => {
        const nomor = index + 1;
        return `
        <div style="background: rgba(34, 197, 94, 0.15); border: 2px solid var(--ps3-green); border-radius: 10px; padding: 14px; margin-bottom: 12px; position: relative;" data-tx-id="${t.id || ''}">
          <!-- Number Badge -->
          <div style="position: absolute; top: -8px; left: 10px; background: var(--ps3-green-dark); color: #fff; font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; z-index: 1;">${nomor}</div>
          <!-- Row 1: Date (left) + Amount (right) -->
          <div class="card-row-between">
            <div class="fs-9 text-muted fw-500">
              ${formatDateOnlyWIB(t.endTime)}
            </div>
            <div style="color: var(--ps3-green-dark); font-size: 1.15rem; font-weight: 600;">
              ${formatMoney(t.paid)}
            </div>
          </div>

          <!-- Row 2: Unit Name + Action Buttons -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: ${t.customer ? '6px' : '10px'};">
            <div class="fs-105 lh-14 flex-1 min-w-0 pr-10 text-primary">
              🎮 ${t.unitName || t.station_name || 'Unknown'}
            </div>
            <div class="flex-center-gap-4 flex-shrink-0">
              ${t.editCount > 0 ? `<button onclick="try { viewEditHistory('${t.id || ''}', '${(t.customer || 'No name').replace(/'/g, "\\'")}', '${t.unitName || t.station_name || 'Unknown'}'); } catch(e) { alert('Error: ' + e.message); }" class="icon-btn-green" title="Lihat riwayat edit">📋</button>` : ''}
              <button onclick="try { openEditModal('${t.id || ''}'); } catch(e) { alert('Error: ' + e.message); }" class="icon-btn-muted" title="Edit transaksi">✏️</button>
              <button onclick="try { openDeleteTransactionModal('${t.id || ''}', '${(t.customer || 'No name').replace(/'/g, "\\'")}', '${t.unitName || t.station_name || 'Unknown'}'); } catch(e) { alert('Error: ' + e.message); }" class="icon-btn-red" title="Hapus transaksi">🗑️</button>
            </div>
          </div>

          <!-- Row 3: Customer (left) + Note (right, if exists) -->
          ${t.customer || t.note ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.95rem; color: var(--ps3-text); margin-bottom: 10px; padding-left: 2px;">
            <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
              ${t.customer ? `<span class="fs-1">👤</span><span>${t.customer}</span>` : ''}
            </div>
            ${t.note ? `<div style="text-align: right; font-style: italic; opacity: 0.8; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50%;">💬 ${t.note}</div>` : ''}
          </div>
          ` : ''}

          <!-- Row 4: Time | TX ID (centered) | Payment -->
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: var(--ps3-muted); padding-top: 8px; border-top: 1px solid var(--ps3-green); opacity: 0.85;">
            <div class="info-row-compact">
              <span>🕐</span>
              <span>${formatTimeOnlyWIB(t.endTime)}</span>
            </div>
            <div class="tab-btn-group">
              <span class="tx-id-label">TX ID:</span>
              <span onclick="copyToClipboard('${t.id || ''}')" class="tx-id-badge" title="Klik untuk copy ID" class="fs-75">${t.id || ''}</span>
            </div>
            <div class="text-right flex-1">
              💳 ${t.payment || 'cash'}
            </div>
          </div>

        </div>
      `;}).join('');
    }

    // Update pagination UI
    function updateTxPaginationUI() {
      const paginationDiv = document.getElementById('txPagination');
      const pageInfo = document.getElementById('txPageInfo');
      const prevBtn = document.getElementById('txPrevPage');
      const nextBtn = document.getElementById('txNextPage');

      const totalPages = Math.ceil(txSearchState.total / txSearchState.limit);
      const currentPage = txSearchState.page + 1;

      if (totalPages <= 1) {
        paginationDiv.style.display = 'none';
        return;
      }

      paginationDiv.style.display = 'flex';
      pageInfo.textContent = `Halaman ${currentPage} dari ${totalPages}`;

      prevBtn.disabled = txSearchState.page === 0;
      prevBtn.style.opacity = prevBtn.disabled ? '0.5' : '1';
      prevBtn.style.cursor = prevBtn.disabled ? 'not-allowed' : 'pointer';

      nextBtn.disabled = currentPage >= totalPages;
      nextBtn.style.opacity = nextBtn.disabled ? '0.5' : '1';
      nextBtn.style.cursor = nextBtn.disabled ? 'not-allowed' : 'pointer';
    }

    // ═════════════════════════════════════════════════════════════════
    // EXPENSE SEARCH & FILTER SYSTEM (mirrors transaction search)
    // ═════════════════════════════════════════════════════════════════

    // Expense search state
    let expSearchState = {
      search: '',
      category: '',
      subCategory: '',
      amountMin: '',
      amountMax: '',
      dateFrom: '',
      dateTo: '',
      note: '',
      sortBy: 'date',
      sortOrder: 'desc',
      page: 0,
      limit: 20,
      total: 0
    };

    // Debounce timer for expense search
    let expSearchTimer = null;

    // Debounced search for expense input fields
    function debouncedSearchExpenses() {
      if (expSearchTimer) clearTimeout(expSearchTimer);
      expSearchTimer = setTimeout(() => {
        expSearchState.page = 0; // Reset to first page on new search
        searchExpenses();
      }, 300);
    }

    // Toggle filter panel visibility
    function toggleExpFilters() {
      const panel = document.getElementById('expFilterPanel');
      const isVisible = panel.style.display === 'block';
      panel.style.display = isVisible ? 'none' : 'block';
    }

    // Handle filter category change - show/hide sub-category dropdown
    function onFilterCategoryChange() {
      const category = document.getElementById('expFilterCategory').value;
      const subGroup = document.getElementById('expFilterSubCategoryGroup');
      const subSelect = document.getElementById('expFilterSubCategory');

      // Reset sub-category
      subSelect.innerHTML = '<option value="">-- Semua Sub --</option>';

      // Show/hide sub-category based on category selection
      if (EXPENSE_SUB_CATEGORIES[category]) {
        subGroup.style.display = 'block';
        // Populate sub-categories
        EXPENSE_SUB_CATEGORIES[category].forEach(sub => {
          const option = document.createElement('option');
          option.value = sub.value;
          option.textContent = sub.label;
          subSelect.appendChild(option);
        });
      } else {
        subGroup.style.display = 'none';
        subSelect.value = '';
      }

      // Trigger search
      debouncedSearchExpenses();
    }

    // Handle filter sub-category change
    function onFilterSubCategoryChange() {
      debouncedSearchExpenses();
    }

    // Update search state from UI inputs
    function updateExpSearchStateFromUI() {
      expSearchState.search = document.getElementById('expSearchInput').value.trim();
      expSearchState.category = document.getElementById('expFilterCategory').value.trim();
      expSearchState.subCategory = document.getElementById('expFilterSubCategory').value.trim();
      expSearchState.amountMin = document.getElementById('expFilterAmountMin').value;
      expSearchState.amountMax = document.getElementById('expFilterAmountMax').value;
      expSearchState.dateFrom = document.getElementById('expFilterDateFrom').value;
      expSearchState.dateTo = document.getElementById('expFilterDateTo').value;
      expSearchState.note = document.getElementById('expFilterNote').value.trim();
      expSearchState.sortBy = document.getElementById('expSortBy').value;
      expSearchState.sortOrder = document.getElementById('expSortOrder').value;
    }

    // Update active filter badge count
    function updateExpFilterBadge() {
      const activeFilters = [
        expSearchState.search,
        expSearchState.category,
        expSearchState.subCategory,
        expSearchState.amountMin,
        expSearchState.amountMax,
        expSearchState.dateFrom,
        expSearchState.dateTo,
        expSearchState.note
      ].filter(v => v && v.trim && v.trim() !== '').length;

      const badge = document.getElementById('expActiveFilterCount');
      if (activeFilters > 0) {
        badge.textContent = activeFilters;
        badge.style.display = 'inline';
      } else {
        badge.style.display = 'none';
      }
    }

    // Clear all expense filters
    function clearAllExpFilters() {
      document.getElementById('expSearchInput').value = '';
      document.getElementById('expFilterCategory').value = '';
      document.getElementById('expFilterSubCategory').value = '';
      document.getElementById('expFilterAmountMin').value = '';
      document.getElementById('expFilterAmountMax').value = '';
      document.getElementById('expFilterDateFrom').value = '';
      document.getElementById('expFilterDateTo').value = '';
      document.getElementById('expFilterNote').value = '';
      document.getElementById('expSortBy').value = 'date';
      document.getElementById('expSortOrder').value = 'desc';

      // Hide sub-category group
      document.getElementById('expFilterSubCategoryGroup').style.display = 'none';

      // Reset state
      expSearchState = {
        search: '',
        category: '',
        subCategory: '',
        amountMin: '',
        amountMax: '',
        dateFrom: '',
        dateTo: '',
        note: '',
        sortBy: 'date',
        sortOrder: 'desc',
        page: 0,
        limit: 20,
        total: 0
      };

      document.getElementById('expFilterPanel').style.display = 'none';
      searchExpenses();
    }

    // Change page (-1 or +1)
    function changeExpPage(delta) {
      const newPage = expSearchState.page + delta;
      if (newPage < 0) return;

      const maxPage = Math.ceil(expSearchState.total / expSearchState.limit) - 1;
      if (newPage > maxPage) return;

      expSearchState.page = newPage;
      searchExpenses();
    }

    // Main search function - fetches from backend API
    async function searchExpenses() {
      updateExpSearchStateFromUI();
      updateExpFilterBadge();

      // Build query params
      const params = new URLSearchParams();
      params.set('limit', expSearchState.limit);
      params.set('offset', expSearchState.page * expSearchState.limit);

      if (expSearchState.search) params.set('search', expSearchState.search);
      if (expSearchState.category) params.set('category', expSearchState.category);
      // If subCategory is selected, filter by item pattern "Category - SubCategory%"
      if (expSearchState.subCategory && expSearchState.category) {
        params.set('item', `${expSearchState.category} - ${expSearchState.subCategory}`);
      }
      if (expSearchState.amountMin) params.set('amountMin', expSearchState.amountMin);
      if (expSearchState.amountMax) params.set('amountMax', expSearchState.amountMax);
      if (expSearchState.dateFrom) params.set('dateFrom', expSearchState.dateFrom);
      if (expSearchState.dateTo) params.set('dateTo', expSearchState.dateTo);
      if (expSearchState.note) params.set('note', expSearchState.note);
      params.set('sortBy', expSearchState.sortBy);
      params.set('sortOrder', expSearchState.sortOrder);

      try {
        const response = await fetch(`${API_URL}/api/expenses?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Update pagination state
        expSearchState.total = data.pagination?.total || 0;

        // Render results
        renderExpSearchResults(data.expenses || []);

        // Update pagination UI
        updateExpPaginationUI();

        // Update results count text
        const resultsText = data.pagination?.total > 0
          ? `${data.pagination.total} pengeluaran ditemukan`
          : 'Tidak ada pengeluaran';
        document.getElementById('expSearchResults').textContent = resultsText;

      } catch (error) {
        console.error('Search expenses failed:', error);
        document.getElementById('allExpensesList').innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">❌</div>
            <div class="empty-state-text">Gagal memuat pengeluaran: ${error.message}</div>
          </div>
        `;
        document.getElementById('expSearchResults').textContent = 'Error loading data';
      }
    }

    // Render expense search results
    function renderExpSearchResults(expenses) {
      const container = document.getElementById('allExpensesList');

      if (expenses.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">🔍</div>
            <div class="empty-state-text">Tidak ada pengeluaran sesuai filter</div>
            <div class="label-xs-muted" class="mt-8">
              Coba ubah filter atau reset pencarian
            </div>
          </div>
        `;
        return;
      }

      container.innerHTML = expenses.map((e, index) => {
        const nomor = index + 1;
        const catInfo = getExpenseCategoryInfo(e.item, e.category);
        const subCatEmoji = catInfo.subCategory ? getSubCategoryEmoji(catInfo.category, catInfo.subCategory) : '';
        return `
        <div style="background: rgba(220, 38, 38, 0.15); border: 2px solid var(--ps3-red-badge); border-radius: 10px; padding: 14px; margin-bottom: 12px; position: relative;" data-exp-id="${e.id || ''}">
          <!-- Number Badge -->
          <div class="badge-abs-top">${nomor}</div>

          <!-- Row 1: Date (left) + Amount (right) -->
          <div class="card-row-between">
            <div class="fs-9 text-muted fw-500">
              ${formatDate(new Date(e.date).getTime())}
            </div>
            <div class="text-red fs-115 fw-600">
              ${formatMoney(e.amount)}
            </div>
          </div>

          <!-- Row 2: Category + Action Buttons -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: ${catInfo.subCategory ? '6px' : '10px'};">
            <div class="fs-105 lh-14 flex-1 min-w-0 pr-10 text-primary">
              ${catInfo.icon} ${catInfo.category}
            </div>
            <div class="flex-center-gap-4 flex-shrink-0">
              ${e.editCount > 0 ? `<button onclick="try { viewExpenseEditHistory('${e.id || ''}', '${(e.item || 'No item').replace(/'/g, "\\'")}'); } catch(e) { alert('Error: ' + e.message); }" class="icon-btn-green" title="Lihat riwayat">📋</button>` : ''}
              <button onclick="try { openEditExpenseModal('${e.id || ''}'); } catch(e) { alert('Error: ' + e.message); }" class="icon-btn-muted" title="Edit pengeluaran">✏️</button>
              <button onclick="try { openDeleteExpenseModal('${e.id || ''}', '${(e.item || 'No item').replace(/'/g, "\\'")}', ${e.amount}); } catch(e) { alert('Error: ' + e.message); }" class="icon-btn-red" title="Hapus pengeluaran">🗑️</button>
            </div>
          </div>

          <!-- Row 3: Sub-category (if exists) -->
          ${catInfo.subCategory ? `
          <div style="font-size: 0.95rem; color: var(--ps3-text); margin-bottom: 10px; padding-left: 2px; display: flex; align-items: center; gap: 6px;">
            <span class="fs-1">${subCatEmoji || '🏷️'}</span>
            <span>${catInfo.subCategory}</span>
          </div>
          ` : ''}

          <!-- Row 4: Time | TX ID (centered) | Note -->
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: var(--ps3-muted); padding-top: 8px; border-top: 1px solid var(--ps3-red-badge); opacity: 0.85;">
            <div class="info-row-compact">
              <span>🕐</span>
              <span>${formatTimeOnlyWIB(e.date)}</span>
            </div>
            <div class="tab-btn-group">
              <span class="tx-id-label">TX ID:</span>
              <span onclick="copyToClipboard('${e.id || ''}')" class="tx-id-badge" title="Klik untuk copy ID" class="fs-75">${e.id || ''}</span>
            </div>
            <div style="font-style: italic; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; flex: 1;">
              ${e.note ? `💬 ${e.note}` : ''}
            </div>
          </div>

        </div>
      `}).join('');
    }

    // Update pagination UI
    function updateExpPaginationUI() {
      const paginationDiv = document.getElementById('expPagination');
      const pageInfo = document.getElementById('expPageInfo');
      const prevBtn = document.getElementById('expPrevPage');
      const nextBtn = document.getElementById('expNextPage');

      const totalPages = Math.ceil(expSearchState.total / expSearchState.limit);
      const currentPage = expSearchState.page + 1;

      if (totalPages <= 1) {
        paginationDiv.style.display = 'none';
        return;
      }

      paginationDiv.style.display = 'flex';
      pageInfo.textContent = `Halaman ${currentPage} dari ${totalPages}`;

      prevBtn.disabled = expSearchState.page === 0;
      prevBtn.style.opacity = prevBtn.disabled ? '0.5' : '1';
      prevBtn.style.cursor = prevBtn.disabled ? 'not-allowed' : 'pointer';

      nextBtn.disabled = currentPage >= totalPages;
      nextBtn.style.opacity = nextBtn.disabled ? '0.5' : '1';
      nextBtn.style.cursor = nextBtn.disabled ? 'not-allowed' : 'pointer';
    }

    // ═════════════════ EXPENSE AUTOCOMPLETE SYSTEM ═════════════════

    // Autocomplete state for categories
    let categoryAutocompleteTimer = null;
    let uniqueCategories = [];

    // Setup category autocomplete from global expenses data
    function setupCategoryAutocomplete() {
      uniqueCategories = [...new Set(expenses.map(e => e.category).filter(Boolean))].sort();
    }

    // Immediate suggestion update + debounced search
    function onCategoryInput() {
      showCategorySuggestions();
      if (categoryAutocompleteTimer) clearTimeout(categoryAutocompleteTimer);
      categoryAutocompleteTimer = setTimeout(() => {
        updateExpSearchStateFromUI();
        searchExpenses();
      }, 300);
    }

    // Show category autocomplete suggestions
    function showCategorySuggestions() {
      const input = document.getElementById('expFilterCategory');
      const dropdown = document.getElementById('categorySuggestions');
      const value = input.value.trim().toLowerCase();

      const matches = value
        ? uniqueCategories.filter(c => c.toLowerCase().includes(value))
        : uniqueCategories.slice(0, 10);

      if (matches.length === 0) {
        dropdown.innerHTML = '<div class="suggestion-empty">Tidak ditemukan</div>';
      } else {
        dropdown.innerHTML = matches.map(cat => {
          const highlighted = value
            ? highlightMatch(cat, value)
            : escapeHtml(cat);
          return `<div class="customer-suggestion-item" onclick="selectCategory('${escapeHtml(cat).replace(/'/g, "\\'")}')">${highlighted}</div>`;
        }).join('');
      }

      dropdown.style.display = matches.length > 0 ? 'block' : 'none';
    }

    // Select a category from suggestions
    function selectCategory(category) {
      document.getElementById('expFilterCategory').value = category;
      document.getElementById('categorySuggestions').style.display = 'none';
      updateExpSearchStateFromUI();
      searchExpenses();
    }

    // Autocomplete state for items
    let itemAutocompleteTimer = null;
    let uniqueItems = [];

    // Setup item autocomplete from global expenses data
    function setupItemAutocomplete() {
      uniqueItems = [...new Set(expenses.map(e => e.item).filter(Boolean))].sort();
    }

    // Immediate suggestion update + debounced search
    function onItemInput() {
      showItemSuggestions();
      if (itemAutocompleteTimer) clearTimeout(itemAutocompleteTimer);
      itemAutocompleteTimer = setTimeout(() => {
        updateExpSearchStateFromUI();
        searchExpenses();
      }, 300);
    }

    // Show item autocomplete suggestions
    function showItemSuggestions() {
      const input = document.getElementById('expFilterItem');
      const dropdown = document.getElementById('itemSuggestions');
      const value = input.value.trim().toLowerCase();

      const matches = value
        ? uniqueItems.filter(i => i.toLowerCase().includes(value))
        : uniqueItems.slice(0, 10);

      if (matches.length === 0) {
        dropdown.innerHTML = '<div class="suggestion-empty">Tidak ditemukan</div>';
      } else {
        dropdown.innerHTML = matches.map(item => {
          const highlighted = value
            ? highlightMatch(item, value)
            : escapeHtml(item);
          return `<div class="customer-suggestion-item" onclick="selectItem('${escapeHtml(item).replace(/'/g, "\\'")}')">${highlighted}</div>`;
        }).join('');
      }

      dropdown.style.display = matches.length > 0 ? 'block' : 'none';
    }

    // Select an item from suggestions
    function selectItem(item) {
      document.getElementById('expFilterItem').value = item;
      document.getElementById('itemSuggestions').style.display = 'none';
      updateExpSearchStateFromUI();
      searchExpenses();
    }

    // Helper: Highlight matching text
    function highlightMatch(text, query) {
      if (!query) return escapeHtml(text);
      const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
      return escapeHtml(text).replace(regex, '<mark style="background: #e60012; color: #fff; padding: 2px; border-radius: 2px; font-weight: bold;">$1</mark>');
    }

    // Helper: Escape HTML
    function escapeHtml(text) {
      if (!text) return '';
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Helper: Escape regex special chars
    function escapeRegex(string) {
      return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Close dropdowns when clicking outside
    document.addEventListener('click', function(e) {
      const categoryWrapper = document.querySelector('.autocomplete-wrapper:has(#expFilterCategory)');
      const itemWrapper = document.querySelector('.autocomplete-wrapper:has(#expFilterItem)');
      
      if (categoryWrapper && !categoryWrapper.contains(e.target)) {
        const dropdown = document.getElementById('categorySuggestions');
        if (dropdown) dropdown.style.display = 'none';
      }
      if (itemWrapper && !itemWrapper.contains(e.target)) {
        const dropdown = document.getElementById('itemSuggestions');
        if (dropdown) dropdown.style.display = 'none';
      }
    });

    // ═════════════════ OPEN ALL EXPENSES MODAL ═════════════════
    function openAllExpensesModal() {
      // Get current period from active tab (same as income modal)
      const currentPeriod = document.querySelector('.tab.active')?.dataset.period || 'today';
      const now = new Date();

      // Set default date range based on current period (same as income)
      let dateFrom = '', dateTo = '';
      switch(currentPeriod) {
        case 'today':
          dateFrom = dateTo = getWIBDateISO();
          break;
        case 'week': {
          const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
          dateFrom = weekAgo.toISOString().split('T')[0];
          dateTo = getWIBDateISO();
          break;
        }
        case 'month': {
          const thisMonth = now.getMonth();
          const thisYear = now.getFullYear();
          dateFrom = `${thisYear}-${String(thisMonth + 1).padStart(2, '0')}-01`;
          dateTo = getWIBDateISO();
          break;
        }
        case 'year': {
          const thisYear = now.getFullYear();
          dateFrom = `${thisYear}-01-01`;
          dateTo = getWIBDateISO();
          break;
        }
        case 'all':
        default:
          dateFrom = '';
          dateTo = '';
          break;
      }

      // Reset filters to default state with period-based date range
      clearAllExpFilters();

      // Set date range in UI and state
      document.getElementById('expFilterDateFrom').value = dateFrom;
      document.getElementById('expFilterDateTo').value = dateTo;
      expSearchState.dateFrom = dateFrom;
      expSearchState.dateTo = dateTo;

      // Setup autocomplete data
      setupCategoryAutocomplete();
      setupItemAutocomplete();

      // Initial search (loads expenses for current period)
      searchExpenses();

      openModal('modalAllExpenses');
    }

    // ═════════════════ Chart Rendering ═════════════════
    let financeChartInstance = null;
    
    function renderFinanceChart(period, transactions, expenses) {
      const ctx = document.getElementById('financeChart');
      if (!ctx) return;
      
      // Destroy existing chart
      if (financeChartInstance) {
        financeChartInstance.destroy();
      }
      
      // Prepare data based on period
      const now = new Date();
      let labels = [];
      let incomeData = [];
      let expenseData = [];
      
      switch(period) {
        case 'today':
          // Hourly breakdown for today
          labels = ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];
          incomeData = labels.map(() => 0);
          expenseData = labels.map(() => 0);
          
          transactions.forEach(t => {
            const hour = new Date(t.endTime).getHours();
            const index = Math.floor((hour - 6) / 2);
            if (index >= 0 && index < labels.length) {
              incomeData[index] += t.paid || 0;
            }
          });
          
          expenses.forEach(e => {
            const hour = new Date(e.date).getHours?.() || 12;
            const index = Math.floor((hour - 6) / 2);
            if (index >= 0 && index < labels.length) {
              expenseData[index] += e.amount || 0;
            }
          });
          break;
          
        case 'week':
          // Daily breakdown for week
          for (let i = 6; i >= 0; i--) {
            const d = new Date(now - i * 24 * 60 * 60 * 1000);
            labels.push(d.toLocaleDateString('id-ID', { weekday: 'short' }));
            incomeData.push(0);
            expenseData.push(0);
          }
          
          transactions.forEach(t => {
            const tDate = new Date(t.endTime);
            const daysAgo = Math.floor((now - tDate) / (24 * 60 * 60 * 1000));
            if (daysAgo >= 0 && daysAgo < 7) {
              incomeData[6 - daysAgo] += t.paid || 0;
            }
          });
          
          expenses.forEach(e => {
            const eDate = new Date(e.date);
            const daysAgo = Math.floor((now - eDate) / (24 * 60 * 60 * 1000));
            if (daysAgo >= 0 && daysAgo < 7) {
              expenseData[6 - daysAgo] += e.amount || 0;
            }
          });
          break;
          
        case 'month':
          // Weekly breakdown for month
          labels = ['Minggu 1', 'Minggu 2', 'Minggu 3', 'Minggu 4'];
          incomeData = [0, 0, 0, 0];
          expenseData = [0, 0, 0, 0];
          
          transactions.forEach(t => {
            const day = new Date(t.endTime).getDate();
            const week = Math.min(Math.floor((day - 1) / 7), 3);
            incomeData[week] += t.paid || 0;
          });
          
          expenses.forEach(e => {
            const day = new Date(e.date).getDate();
            const week = Math.min(Math.floor((day - 1) / 7), 3);
            expenseData[week] += e.amount || 0;
          });
          break;
          
        case 'year':
          // Monthly breakdown for year
          labels = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
          incomeData = new Array(12).fill(0);
          expenseData = new Array(12).fill(0);
          
          transactions.forEach(t => {
            const month = new Date(t.endTime).getMonth();
            if (new Date(t.endTime).getFullYear() === now.getFullYear()) {
              incomeData[month] += t.paid || 0;
            }
          });
          
          expenses.forEach(e => {
            const month = new Date(e.date).getMonth();
            if (new Date(e.date).getFullYear() === now.getFullYear()) {
              expenseData[month] += e.amount || 0;
            }
          });
          break;
          
        default:
          // Yearly breakdown for all time
          const years = [...new Set(transactions.map(t => new Date(t.endTime).getFullYear()))].sort();
          if (years.length === 0) years.push(now.getFullYear());
          labels = years.map(y => y.toString());
          incomeData = new Array(years.length).fill(0);
          expenseData = new Array(years.length).fill(0);
          
          transactions.forEach(t => {
            const year = new Date(t.endTime).getFullYear();
            const idx = years.indexOf(year);
            if (idx >= 0) incomeData[idx] += t.paid || 0;
          });
          
          expenses.forEach(e => {
            const year = new Date(e.date).getFullYear();
            const idx = years.indexOf(year);
            if (idx >= 0) expenseData[idx] += e.amount || 0;
          });
      }
      
      // Create chart
      financeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Pendapatan',
              data: incomeData,
              backgroundColor: 'rgba(0, 170, 0, 0.8)',
              borderColor: '#00aa00',
              borderWidth: 1,
              borderRadius: 4
            },
            {
              label: 'Pengeluaran',
              data: expenseData,
              backgroundColor: 'rgba(230, 0, 18, 0.8)',
              borderColor: '#e60012',
              borderWidth: 1,
              borderRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: {
              labels: {
                color: '#ffffff',
                font: { family: 'Rajdhani', size: 12 }
              }
            }
          },
          scales: {
            x: {
              ticks: {
                color: '#666666',
                font: { family: 'Rajdhani', size: 11 }
              },
              grid: {
                color: 'rgba(42, 42, 42, 0.5)'
              }
            },
            y: {
              ticks: {
                color: '#666666',
                font: { family: 'Rajdhani', size: 11 },
                callback: function(value) {
                  return 'Rp' + (value / 1000).toFixed(0) + 'k';
                }
              },
              grid: {
                color: 'rgba(42, 42, 42, 0.5)'
              }
            }
          }
        }
      });
    }

    // ═════════════════ Session Actions ═════════════════
    function handleDurationChange() {
      const preset = document.getElementById('startDurationPreset').value;
      const customContainer = document.getElementById('customDurationContainer');
      const hiddenInput = document.getElementById('startDuration');
      const customInput = document.getElementById('startDurationCustom');
      
      if (preset === 'custom') {
        customContainer.style.display = 'block';
        hiddenInput.value = customInput.value || '';
      } else if (preset === 'unlimited') {
        customContainer.style.display = 'none';
        hiddenInput.value = '0';
      } else {
        customContainer.style.display = 'none';
        hiddenInput.value = preset;
      }
    }
    
    // Update hidden input when custom value changes
    document.getElementById('startDurationCustom')?.addEventListener('input', function() {
      document.getElementById('startDuration').value = this.value;
    });

    function startSession(unitId, unitName) {
      currentUnitId = unitId;
      document.getElementById('startUnitName').textContent = unitName;
      document.getElementById('startCustomer').value = '';
      document.getElementById('startDurationPreset').value = '';
      document.getElementById('startDurationCustom').value = '';
      document.getElementById('startDuration').value = '';
      document.getElementById('customDurationContainer').style.display = 'none';
      document.getElementById('startNote').value = '';
      openModal('modalStart');
    }

    // ═════════════════ Activation Conflict Handling ═════════════════
    let pendingActivationData = null; // Menyimpan data aktivasi yang akan dilanjutkan setelah pembatalan
    let pendingConflictSchedule = null; // Menyimpan data schedule yang perlu dibatalkan

    async function confirmStartSession() {
      const customer = document.getElementById('startCustomer').value;
      const preset = document.getElementById('startDurationPreset').value;
      let duration = 0;
      
      if (preset === 'custom') {
        duration = parseInt(document.getElementById('startDurationCustom').value) || 0;
      } else if (preset !== 'unlimited' && preset !== '') {
        duration = parseInt(preset) || 0;
      }
      
      const note = document.getElementById('startNote').value;
      
      if (!customer.trim()) {
        showToast('Nama pelanggan wajib diisi', 'error');
        return;
      }
      
      if (preset === '') {
        showToast('Pilih durasi sewa terlebih dahulu', 'error');
        return;
      }
      
      if (preset === 'custom' && duration <= 0) {
        showToast('Masukkan durasi valid dalam menit', 'error');
        return;
      }
      
      try {
        await api('POST', `/units/${currentUnitId}/start`, { customer, duration, note });
        closeModal('modalStart');
        await loadData();
        renderAll();
        showToast('Sewa dimulai!', 'success');
      } catch (error) {
        // Cek apakah error mengandung konflik booking yang bisa dibatalkan
        // Error dari api() sekarang menyimpan data lengkap di error.data
        const errorData = error.data || {};
        if (errorData.requiresCancellation && errorData.schedule) {
          // Simpan data untuk digunakan setelah konfirmasi
          pendingActivationData = { customer, duration, note };
          pendingConflictSchedule = errorData.schedule;
          
          // Tampilkan modal konfirmasi
          showActivationConflictModal(errorData.schedule, errorData.message || error.message);
        } else {
          // Error biasa - tampilkan toast
          showToast(error.message || errorData.error || 'Terjadi kesalahan', 'error');
        }
      }
    }

    // Tampilkan modal konfirmasi konflik aktivasi
    function showActivationConflictModal(schedule, message) {
      // Update pesan (gunakan innerHTML untuk render bold)
      document.getElementById('activationConflictMessage').innerHTML = message;
      
      // Render card overview booking
      const cardHtml = renderActivationConflictCard(schedule);
      document.getElementById('activationConflictCard').innerHTML = cardHtml;
      
      // Reset checkbox
      document.getElementById('confirmCancelBookingCheckbox').checked = false;
      document.getElementById('confirmCancelBookingError').style.display = 'none';
      
      // Buka modal
      closeModal('modalStart');
      openModal('modalConfirmActivationWithCancel');
    }

    // Render card untuk booking yang konflik (sama persis dengan card daftar jadwal)
    function renderActivationConflictCard(s) {
      // Normalize data format untuk konsistensi dengan daftar jadwal
      // Data dari server mungkin punya format berbeda, jadi kita normalisasi dulu
      const normalizedSchedule = {
        ...s,
        scheduledDate: s.scheduledDate || s.date,
        scheduledTime: s.scheduledTime || s.startTime,
        scheduledEndDate: s.scheduledEndDate || s.endDate || s.date,
        scheduledEndTime: s.scheduledEndTime || s.endTime,
        status: s.status || 'pending'
      };
      
      // Gunakan fungsi yang sama dengan daftar jadwal untuk konsistensi
      const highlight = getScheduleHighlight(normalizedSchedule);
      const badge = getScheduleStatusBadge(normalizedSchedule);
      
      return `
        <div style="background: ${highlight.bg}; border: 2px solid ${highlight.border}; border-radius: 10px; padding: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div>
              <div class="info-row">
                <span class="fw-700 text-primary">${escapeHtml(s.customer)}</span>
                ${s.scheduleId ? `
                  <span class="tx-id-label">TX ID:</span>
                  <span onclick="copyToClipboard('${s.scheduleId}')" class="tx-id-badge" title="Klik untuk copy ID" style="font-size: 0.75rem; cursor: pointer;">${s.scheduleId}</span>
                ` : ''}
              </div>
              ${s.phone ? `<div class="fs-8 text-muted mt-2">📞 ${escapeHtml(s.phone)}</div>` : ''}
            </div>
            <span style="font-size: 0.75rem; padding: 5px 10px; border-radius: 6px; background: ${badge.bg}; color: ${badge.color}; font-weight: 600; white-space: nowrap;">${badge.text}</span>
          </div>
          <div class="label-xs-muted" style="margin-bottom: 2px;">
            ${formatScheduleDate(normalizedSchedule)}
          </div>
          <div class="fs-85 text-primary fw-600 mb-6">
            ${formatScheduleTime(normalizedSchedule)}
          </div>
          ${s.unitName ? `<div class="label-xs-muted" class="mb-4">🎮 ${escapeHtml(s.unitName)}</div>` : ''}
          ${s.note ? `<div class="fs-8 text-muted italic mt-4">💬 ${escapeHtml(s.note)}</div>` : ''}
        </div>
      `;
    }

    // Format tanggal WIB
    function formatWIBDate(dateStr) {
      const date = new Date(dateStr + 'T00:00:00+07:00');
      const options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' };
      return date.toLocaleDateString('id-ID', options);
    }

    // Lanjutkan ke modal pembatalan booking
    function proceedToCancelBooking() {
      // Cek checkbox konfirmasi
      const confirmed = document.getElementById('confirmCancelBookingCheckbox').checked;
      if (!confirmed) {
        document.getElementById('confirmCancelBookingError').style.display = 'block';
        return;
      }
      
      // Tutup modal konfirmasi
      closeModal('modalConfirmActivationWithCancel');
      
      // Buka modal pembatalan dengan schedule yang akan dibatalkan
      if (pendingConflictSchedule) {
        openCancelScheduleModalForActivation(pendingConflictSchedule);
      }
    }

    // Buka modal pembatalan khusus untuk aktivasi (tanpa perlu cari schedule lagi)
    function openCancelScheduleModalForActivation(schedule) {
      // Set current schedule ID
      currentCancelScheduleId = schedule.id;
      
      // Clear input
      document.getElementById('cancelScheduleReason').value = '';
      document.getElementById('cancelScheduleReasonError').style.display = 'none';
      
      // Update info text
      document.getElementById('cancelScheduleOverview').innerHTML = `
        <div style="background: rgba(230, 0, 18, 0.1); border: 1px solid var(--ps3-red); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
          <div style="color: var(--ps3-red); font-weight: 700; font-size: 0.9rem;">
            ⚠️ Booking akan dibatalkan untuk mengaktifkan unit
          </div>
        </div>
        ${renderCancelScheduleCard(schedule)}
      `;
      
      // Buka modal
      openModal('modalCancelSchedule');
    }

    // Override fungsi confirmCancelSchedule asli untuk melanjutkan aktivasi setelah pembatalan
    const originalConfirmCancelSchedule = confirmCancelSchedule;
    confirmCancelSchedule = async function() {
      if (!currentCancelScheduleId) return;
      
      const reason = document.getElementById('cancelScheduleReason').value.trim();
      if (!reason) {
        document.getElementById('cancelScheduleReasonError').style.display = 'block';
        document.getElementById('cancelScheduleReason').focus();
        return;
      }
      
      try {
        await api('DELETE', `/schedules/${currentCancelScheduleId}`, { reason });
        closeModal('modalCancelSchedule');
        showToast('Jadwal dibatalkan', 'success');
        
        // Cek apakah ada aktivasi pending yang harus dilanjutkan
        if (pendingActivationData && pendingConflictSchedule && 
            currentCancelScheduleId === pendingConflictSchedule.id) {
          // Lanjutkan aktivasi unit
          continueActivationAfterCancellation();
        } else {
          // Refresh data biasa
          await loadSchedules();
          await loadDeletedSchedules();
          renderSchedules();
          filterCalendarSchedules();
        }
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    // Lanjutkan aktivasi setelah pembatalan berhasil
    async function continueActivationAfterCancellation() {
      if (!pendingActivationData || !currentUnitId) return;
      
      const { customer, duration, note } = pendingActivationData;
      
      try {
        showToast('Menaktifkan unit...', 'info');
        await api('POST', `/units/${currentUnitId}/start`, { customer, duration, note });
        
        // Clear pending data
        pendingActivationData = null;
        pendingConflictSchedule = null;
        
        await loadData();
        renderAll();
        showToast('Unit berhasil diaktifkan!', 'success');
      } catch (error) {
        showToast(error.message || 'Gagal mengaktifkan unit', 'error');
        pendingActivationData = null;
        pendingConflictSchedule = null;
      }
    }

    function stopSession(unitId) {
      const unit = units.find(u => u.id === unitId);
      if (!unit || !unit.active) return;
      
      currentUnitId = unitId;
      document.getElementById('stopUnitName').textContent = unit.name;
      
      const elapsed = Math.floor((Date.now() - unit.startTime) / 60000);
      const cost = Math.round((elapsed / 60) * settings.ratePerHour);
      
      document.getElementById('stopDuration').textContent = `${elapsed} menit`;
      document.getElementById('stopCost').value = cost;
      document.getElementById('stopPaid').value = cost;
      document.getElementById('stopPayment').value = 'cash';
      
      openModal('modalStop');
    }

    async function confirmStopSession() {
      const paid = parseInt(document.getElementById('stopPaid').value) || 0;
      const payment = document.getElementById('stopPayment').value;
      
      try {
        await api('POST', `/units/${currentUnitId}/stop`, { paid, payment });
        // Clear warning flag for this unit
        warnedUnits.delete(currentUnitId);
        closeModal('modalStop');
        await loadData();
        renderAll();
        showToast('Sewa selesai!', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    // ═════════════════ Station Operations (Dashboard Integration) ═════════════════
    let currentStationId = null;

    // Open modal to start a station session
    function openStartStationModal(stationId) {
      const station = stations.find(s => s.id === stationId);
      if (!station) return;
      if (station.active) {
        showToast('Stasiun sudah aktif', 'error');
        return;
      }
      
      currentStationId = stationId;
      document.getElementById('startStationName').textContent = station.name;
      document.getElementById('startStationCustomer').value = '';
      document.getElementById('startStationDuration').value = '';
      document.getElementById('startStationNote').value = '';
      openModal('modalStartStation');
    }

    // Confirm start station session
    async function confirmStartStation() {
      const customer = document.getElementById('startStationCustomer').value;
      const duration = parseInt(document.getElementById('startStationDuration').value) || 0;
      const note = document.getElementById('startStationNote').value;
      
      if (!customer.trim()) {
        showToast('Nama pelanggan wajib diisi', 'error');
        return;
      }
      
      try {
        await api('POST', `/stations/${currentStationId}/start`, { customer, duration, note });
        closeModal('modalStartStation');
        await loadStations();
        renderDashboard();
        showToast('Stasiun aktif!', 'success');
      } catch (error) {
        // Handle conflict with booking (similar to unit flow)
        const errorData = error.data || {};
        if (errorData.requiresCancellation && errorData.schedule) {
          pendingStationActivationData = { customer, duration, note };
          pendingStationConflictSchedule = errorData.schedule;
          showStationActivationConflictModal(errorData.schedule, errorData.message || error.message);
        } else {
          showToast(error.message || errorData.error || 'Terjadi kesalahan', 'error');
        }
      }
    }

    // Show conflict modal for station activation
    let pendingStationActivationData = null;
    let pendingStationConflictSchedule = null;

    function showStationActivationConflictModal(schedule, message) {
      document.getElementById('stationActivationConflictMessage').innerHTML = message;
      document.getElementById('stationActivationConflictCard').innerHTML = renderActivationConflictCard(schedule);
      document.getElementById('confirmCancelStationBookingCheckbox').checked = false;
      document.getElementById('confirmCancelStationBookingError').style.display = 'none';
      closeModal('modalStartStation');
      openModal('modalConfirmStationActivationWithCancel');
    }

    // Proceed to cancel booking for station activation
    function proceedToCancelStationBooking() {
      const confirmed = document.getElementById('confirmCancelStationBookingCheckbox').checked;
      if (!confirmed) {
        document.getElementById('confirmCancelStationBookingError').style.display = 'block';
        return;
      }
      closeModal('modalConfirmStationActivationWithCancel');
      if (pendingStationConflictSchedule) {
        openCancelScheduleModalForStationActivation(pendingStationConflictSchedule);
      }
    }

    // Cancel schedule for station activation
    function openCancelScheduleModalForStationActivation(schedule) {
      currentCancelScheduleId = schedule.id;
      document.getElementById('cancelScheduleReason').value = '';
      document.getElementById('cancelScheduleReasonError').style.display = 'none';
      document.getElementById('cancelScheduleOverview').innerHTML = `
        <div style="background: rgba(230, 0, 18, 0.1); border: 1px solid var(--ps3-red); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
          <div style="color: var(--ps3-red); font-weight: 700; font-size: 0.9rem;">
            ⚠️ Booking akan dibatalkan untuk mengaktifkan stasiun
          </div>
        </div>
        ${renderCancelScheduleCard(schedule)}
      `;
      openModal('modalCancelSchedule');
    }

    // Override confirmCancelSchedule to handle station activation continuation
    const originalConfirmCancelScheduleStation = confirmCancelSchedule;
    confirmCancelSchedule = async function() {
      if (!currentCancelScheduleId) return;
      
      const reason = document.getElementById('cancelScheduleReason').value.trim();
      if (!reason) {
        document.getElementById('cancelScheduleReasonError').style.display = 'block';
        document.getElementById('cancelScheduleReason').focus();
        return;
      }
      
      try {
        await api('DELETE', `/schedules/${currentCancelScheduleId}`, { reason });
        closeModal('modalCancelSchedule');
        showToast('Jadwal dibatalkan', 'success');
        
        // Check if there's a pending station activation to continue
        if (pendingStationActivationData && pendingStationConflictSchedule && 
            currentCancelScheduleId === pendingStationConflictSchedule.id) {
          continueStationActivationAfterCancellation();
        } else {
          await loadSchedules();
          await loadDeletedSchedules();
          renderSchedules();
          filterCalendarSchedules();
        }
      } catch (error) {
        showToast(error.message, 'error');
      }
    };

    // Continue station activation after cancellation
    async function continueStationActivationAfterCancellation() {
      if (!pendingStationActivationData || !currentStationId) return;
      
      const { customer, duration, note } = pendingStationActivationData;
      
      try {
        showToast('Mengaktifkan stasiun...', 'info');
        await api('POST', `/stations/${currentStationId}/start`, { customer, duration, note });
        
        pendingStationActivationData = null;
        pendingStationConflictSchedule = null;
        
        await loadStations();
        renderDashboard();
        showToast('Stasiun berhasil diaktifkan!', 'success');
      } catch (error) {
        showToast(error.message || 'Gagal mengaktifkan stasiun', 'error');
        pendingStationActivationData = null;
        pendingStationConflictSchedule = null;
      }
    }

    // Stop station session
    async function stopStation(stationId) {
      const station = stations.find(s => s.id === stationId);
      if (!station || !station.active) {
        showToast('Stasiun tidak aktif', 'error');
        return;
      }
      
      currentStationId = stationId;
      document.getElementById('stopStationName').textContent = station.name;
      
      const elapsed = Math.floor((Date.now() - station.startTime) / 60000);
      const cost = Math.round((elapsed / 60) * settings.ratePerHour);
      
      document.getElementById('stopStationDuration').textContent = `${elapsed} menit`;
      document.getElementById('stopStationCost').value = cost;
      document.getElementById('stopStationPaid').value = cost;
      document.getElementById('stopStationPayment').value = 'cash';
      
      openModal('modalStopStation');
    }

    // Confirm stop station
    async function confirmStopStation() {
      const paid = parseInt(document.getElementById('stopStationPaid').value) || 0;
      const payment = document.getElementById('stopStationPayment').value;
      
      try {
        await api('POST', `/stations/${currentStationId}/stop`, { paid, payment });
        warnedUnits.delete('station-' + currentStationId);
        closeModal('modalStopStation');
        await loadStations();
        renderDashboard();
        await loadTransactions();
        renderReports();
        showToast('Sewa selesai!', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    // ═════════════════ Expense Category Management ═════════════════
    const EXPENSE_SUB_CATEGORIES = {
      'Servis/Perawatan': [
        { value: 'Unit PS', label: '🎮 Unit PS' },
        { value: 'TV/Monitor', label: '📺 TV/Monitor' },
        { value: 'Stik', label: '🎮 Stik' },
        { value: 'Kabel Charger', label: '🔌 Kabel Charger' },
        { value: 'Game', label: '💿 Game' },
        { value: 'Furnitur', label: '🪑 Furnitur' },
        { value: 'Lainnya', label: '📦 Lainnya' }
      ],
      'Aksesoris': [
        { value: 'Stik', label: '🎮 Stik' },
        { value: 'Kabel Charger', label: '🔌 Kabel Charger' },
        { value: 'Game', label: '💿 Game' },
        { value: 'Furnitur', label: '🪑 Furnitur' },
        { value: 'Lainnya', label: '📦 Lainnya' }
      ]
    };

    // Category mapping for legacy records and item-to-category inference
    const EXPENSE_CATEGORY_MAP = {
      // Simple categories (no sub-categories)
      'Listrik': { category: 'Operasional', icon: '⚡', hasSub: false },
      'Prive': { category: 'Pengambilan Pribadi', icon: '💰', hasSub: false },
      'Unit PS Baru': { category: 'Investasi - Unit PS', icon: '🎮', hasSub: false },
      'TV/Monitor Baru': { category: 'Investasi - TV/Monitor', icon: '📺', hasSub: false },
      
      // Categories with sub-categories (format: "Category - SubCategory")
      'Servis/Perawatan': { category: 'Servis/Perawatan', icon: '🔧', hasSub: true },
      'Aksesoris': { category: 'Aksesoris', icon: '🎧', hasSub: true }
    };

    // Infer category details from item name for legacy records or display purposes
    function getExpenseCategoryInfo(item, storedCategory) {
      if (!item) return { category: storedCategory || 'Uncategorized', subCategory: null, icon: '', fullDisplay: storedCategory || 'Uncategorized' };
      
      // If we have a stored category, use it as base
      if (storedCategory && storedCategory.trim() !== '') {
        // Check if it's a category with sub-categories (contains " - ")
        if (item.includes(' - ')) {
          const parts = item.split(' - ');
          const mainCat = parts[0];
          const subCat = parts[1];
          const catInfo = EXPENSE_CATEGORY_MAP[mainCat] || { icon: '📦' };
          return {
            category: mainCat,
            subCategory: subCat,
            icon: catInfo.icon,
            fullDisplay: `${catInfo.icon || '📦'} ${mainCat} › ${subCat}`
          };
        }
        
        // Simple category
        const catInfo = EXPENSE_CATEGORY_MAP[storedCategory] || { icon: '📦' };
        return {
          category: storedCategory,
          subCategory: null,
          icon: catInfo.icon,
          fullDisplay: `${catInfo.icon || '📦'} ${storedCategory}`
        };
      }
      
      // Try to infer from item name (for legacy records)
      // Check for "Category - SubCategory" format first
      if (item.includes(' - ')) {
        const parts = item.split(' - ');
        const mainCat = parts[0];
        const subCat = parts[1];
        const catInfo = EXPENSE_CATEGORY_MAP[mainCat] || { category: mainCat, icon: '📦' };
        return {
          category: mainCat,
          subCategory: subCat,
          icon: catInfo.icon,
          fullDisplay: `${catInfo.icon || '📦'} ${mainCat} › ${subCat}`
        };
      }
      
      // Check if item matches a known simple category
      for (const [key, info] of Object.entries(EXPENSE_CATEGORY_MAP)) {
        if (item === key || item.startsWith(key)) {
          return {
            category: info.category,
            subCategory: null,
            icon: info.icon,
            fullDisplay: `${info.icon} ${info.category}`
          };
        }
      }
      
      // Fallback: use item as category
      return {
        category: item,
        subCategory: null,
        icon: '📝',
        fullDisplay: `📝 ${item}`
      };
    }

    // Get sub-category emoji from EXPENSE_SUB_CATEGORIES
    function getSubCategoryEmoji(category, subCategory) {
      if (!category || !subCategory) return '';

      // Normalize inputs
      const catNorm = category.toLowerCase().trim();
      const subNorm = subCategory.toLowerCase().trim();

      // Direct lookup first
      let catKey = EXPENSE_SUB_CATEGORIES[category] ? category : null;

      // Case-insensitive fallback
      if (!catKey) {
        catKey = Object.keys(EXPENSE_SUB_CATEGORIES).find(k => k.toLowerCase() === catNorm);
      }

      if (!catKey) {
        console.log('[Emoji] Category not found:', category, 'normalized:', catNorm);
        return '';
      }

      // Find matching sub-category
      const subCats = EXPENSE_SUB_CATEGORIES[catKey];
      if (!subCats || !Array.isArray(subCats)) {
        console.log('[Emoji] No sub-categories for:', catKey);
        return '';
      }

      const sub = subCats.find(s => {
        const val = (s.value || '').toLowerCase().trim();
        return val === subNorm;
      });

      // Return emoji from label (format: "💿 Game")
      if (sub && sub.label) {
        // Extract emoji - it's the first character before the space
        const match = sub.label.match(/^([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|.)/u);
        const emoji = match ? match[0] : sub.label.charAt(0);
        console.log('[Emoji] Found:', category, '->', subCategory, '=', emoji, 'from label:', sub.label);
        return emoji;
      }

      console.log('[Emoji] Sub-category not found:', subCategory, 'in', catKey, 'available:', subCats.map(s => s.value));
      return '';
    }

    function onExpenseCategoryChange() {
      const category = document.getElementById('expenseCategory').value;
      const subGroup = document.getElementById('expenseSubCategoryGroup');
      const subSelect = document.getElementById('expenseSubCategory');
      const customGroup = document.getElementById('expenseCustomGroup');

      // Reset sub-dropdown
      subSelect.innerHTML = '<option value="">-- Pilih Sub --</option>';

      // Check if this category has sub-categories
      if (EXPENSE_SUB_CATEGORIES[category]) {
        subGroup.style.display = 'block';
        customGroup.style.display = 'none';
        
        // Populate sub-categories
        EXPENSE_SUB_CATEGORIES[category].forEach(sub => {
          const option = document.createElement('option');
          option.value = sub.value;
          option.textContent = sub.label;
          subSelect.appendChild(option);
        });
      } else if (category === 'Custom') {
        subGroup.style.display = 'none';
        customGroup.style.display = 'block';
      } else {
        subGroup.style.display = 'none';
        customGroup.style.display = 'none';
      }
    }

    function getExpenseDisplayName() {
      const category = document.getElementById('expenseCategory').value;
      const subCategory = document.getElementById('expenseSubCategory').value;
      const customName = document.getElementById('expenseCustomName').value.trim();

      if (!category) return null;

      // For categories with sub-categories
      if (EXPENSE_SUB_CATEGORIES[category] && subCategory) {
        return `${category} - ${subCategory}`;
      }

      // For Custom
      if (category === 'Custom') {
        return customName || 'Custom';
      }

      // For simple categories (Listrik, Prive, etc.)
      return category;
    }

    // ═════════════════ Data Management ═════════════════
    async function addExpense() {
      const category = document.getElementById('expenseCategory').value;
      const amount = parseInt(document.getElementById('expenseAmount').value);
      const note = document.getElementById('expenseNote').value;

      // Validate category selection
      if (!category) {
        showToast('Pilih tipe biaya pengeluaran terlebih dahulu', 'error');
        return;
      }

      // Get the display name based on category/sub-category/custom
      const item = getExpenseDisplayName();

      // Validate sub-category if required
      if (EXPENSE_SUB_CATEGORIES[category] && !document.getElementById('expenseSubCategory').value) {
        showToast('Pilih sub-kategori untuk ' + category, 'error');
        return;
      }

      // Validate custom name if Custom selected
      if (category === 'Custom' && !document.getElementById('expenseCustomName').value.trim()) {
        showToast('Masukkan nama pengeluaran custom', 'error');
        return;
      }

      if (!amount) {
        showToast('Jumlah pengeluaran wajib diisi', 'error');
        return;
      }

      // Date auto-set by backend in WIB timezone - no user input needed
      try {
        await api('POST', '/expenses', { item, amount, note, category });

        // Reset form
        document.getElementById('expenseCategory').value = '';
        document.getElementById('expenseSubCategory').value = '';
        document.getElementById('expenseCustomName').value = '';
        document.getElementById('expenseAmount').value = '';
        document.getElementById('expenseNote').value = '';
        document.getElementById('expenseSubCategoryGroup').style.display = 'none';
        document.getElementById('expenseCustomGroup').style.display = 'none';

        await loadData();
        renderExpenses();
        updateReportStats();
        showToast('Pengeluaran ditambahkan: ' + item, 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    async function saveSettings() {
      const rate = parseInt(document.getElementById('settingRate').value);
      const warn = parseInt(document.getElementById('settingWarn').value);
      const business = document.getElementById('settingBusiness').value;
      
      try {
        await api('PUT', '/settings', { ratePerHour: rate, warnBefore: warn, businessName: business });
        await loadData();
        
        // Update page title immediately
        document.getElementById('pageTitle').textContent = business + ' - Manager';
        document.querySelector('.header-title').innerHTML = business.replace(/(.+?)\s*(\S+)$/, '$1 <span>$2</span>') || business;
        
        showToast('Pengaturan disimpan', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    // ═════════════════ Import / Export ═════════════════
    let pendingImportFile = null;
    
    function showImportConfirm() {
      pendingImportFile = null;
      document.getElementById('importConfirmText').value = '';
      openModal('modalImportConfirm');
    }
    
    function confirmImport() {
      const input = document.getElementById('importConfirmText').value.trim().toUpperCase();
      if (input !== 'SAYA SETUJU') {
        showToast('Konfirmasi tidak valid. Ketik "SAYA SETUJU" untuk melanjutkan.', 'error');
        return;
      }
      closeModal('modalImportConfirm');
      // Trigger file picker
      document.getElementById('importFile').click();
    }
    
    async function importData(event) {
      const file = event.target.files[0];
      if (!file) return;
      
      showLoading(true);
      
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result);
          
          // Validate structure
          if (!data.units || !Array.isArray(data.units)) throw new Error('Invalid: units array missing');
          if (!data.transactions || !Array.isArray(data.transactions)) throw new Error('Invalid: transactions array missing');
          if (!data.settings || typeof data.settings !== 'object') throw new Error('Invalid: settings object missing');
          
          await api('PUT', '/db', data);
          await loadData();
          renderAll();
          showLoading(false);
          showToast(`Import berhasil! ${data.units.length} unit, ${data.transactions.length} transaksi`, 'success');
        } catch (error) {
          showLoading(false);
          showToast('Import gagal: ' + error.message, 'error');
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    }

    // Store pending export options
    let pendingExportOptions = null;
    let pendingExportPeriod = null;
    let pendingExportType = null; // 'json' or 'csv'

    // New Export Flow: Start with Modal 1 (Data Type Selection)
    async function exportFullBackup() {
      // Load latest data first to ensure complete export
      await loadData();

      // Show Modal 1: Data Type Selection
      pendingExportType = 'json';
      pendingExportPeriod = 'all';

      // Reset checkboxes
      document.getElementById('exportIncludeIncome').checked = true;
      document.getElementById('exportIncludeExpense').checked = true;
      document.getElementById('exportDataTypeError').style.display = 'none';

      // Show modal
      document.getElementById('modalExportDataType').classList.add('active');
    }

    // CSV Export with Modal Flow for all periods
    async function exportCSV(period) {
      // Load latest data first to ensure complete export
      await loadData();

      // Use modal flow for ALL periods (today, week, month, year, all)
      pendingExportType = 'csv';
      pendingExportPeriod = period; // 'today', 'week', 'month', 'year', 'all'
      
      // Reset checkboxes for Modal 1
      document.getElementById('exportIncludeIncome').checked = true;
      document.getElementById('exportIncludeExpense').checked = true;
      document.getElementById('exportDataTypeError').style.display = 'none';
      
      // Show Modal 1
      document.getElementById('modalExportDataType').classList.add('active');
    }

    // Modal 1: Confirm Data Type Selection
    function confirmExportDataType() {
      const includeIncome = document.getElementById('exportIncludeIncome').checked;
      const includeExpense = document.getElementById('exportIncludeExpense').checked;
      
      // Validate: at least one must be selected
      if (!includeIncome && !includeExpense) {
        document.getElementById('exportDataTypeError').style.display = 'block';
        return;
      }
      
      document.getElementById('exportDataTypeError').style.display = 'none';
      
      // Store options from Modal 1 (data type selection)
      pendingExportOptions = {
        includeIncomeType: includeIncome,      // From Modal 1: Income data type selected
        includeExpenseType: includeExpense     // From Modal 1: Expense data type selected
      };
      
      // Close Modal 1
      document.getElementById('modalExportDataType').classList.remove('active');
      
      // Configure Modal 2 based on export period
      const isAllPeriod = pendingExportPeriod === 'all';
      
      // Show/hide Ghost Records option based on period
      document.getElementById('ghostRecordsOption').style.display = isAllPeriod ? 'flex' : 'none';
      document.getElementById('ghostRecordsInfoBox').style.display = isAllPeriod ? 'block' : 'none';
      
      // Update Modal 2 title and description based on period
      if (isAllPeriod) {
        document.getElementById('modalExportHistoryTitle').textContent = '📜 Pilih Data untuk Diekspor (Semua)';
        document.getElementById('modalExportHistoryDesc').textContent = 'Pilih data yang ingin disertakan dalam ekspor lengkap (minimal pilih satu):';
      } else {
        const periodLabel = {
          'today': 'Harian',
          'week': 'Mingguan',
          'month': 'Bulanan',
          'year': 'Tahunan'
        }[pendingExportPeriod] || pendingExportPeriod;
        document.getElementById('modalExportHistoryTitle').textContent = `📜 Pilih Data untuk Diekspor (${periodLabel})`;
        document.getElementById('modalExportHistoryDesc').textContent = `Pilih data ${periodLabel.toLowerCase()} yang ingin disertakan dalam ekspor (minimal pilih satu):`;
      }
      
      // Set all checkboxes for Modal 2 (ALL checked by default)
      document.getElementById('exportIncludeTransactionHistory').checked = true;
      document.getElementById('exportIncludeEditHistory').checked = true;
      // Ghost Records only checked and visible for 'all' period
      document.getElementById('exportIncludeDeleteHistory').checked = isAllPeriod;
      
      document.getElementById('modalExportHistory').classList.add('active');
    }

    // Modal 2: Execute Export with Selected Options
    async function executeExportWithOptions() {
      const includeTransactionHistory = document.getElementById('exportIncludeTransactionHistory').checked;
      const includeEditHistory = document.getElementById('exportIncludeEditHistory').checked;
      const includeDeleteHistory = document.getElementById('exportIncludeDeleteHistory').checked;
      
      // Validate: at least one option must be selected
      // For periodic exports, Ghost Records option is hidden so only check first two
      const isAllPeriod = pendingExportPeriod === 'all';
      const hasSelection = includeTransactionHistory || includeEditHistory || (isAllPeriod && includeDeleteHistory);
      
      if (!hasSelection) {
        showToast('Pilih minimal satu data untuk diekspor', 'error');
        return;
      }
      
      // Close modal
      document.getElementById('modalExportHistory').classList.remove('active');
      
      try {
        if (pendingExportType === 'json') {
          // Build query params for backup export (always 'all' for JSON)
          // Edit history dan ghost records SELALU di-include di server
          const params = new URLSearchParams();
          params.set('transactionData', includeTransactionHistory);
          params.set('transactions', pendingExportOptions.includeIncomeType);
          params.set('expenses', pendingExportOptions.includeExpenseType);
          
          // Fetch data with options
          const data = await api('GET', `/db?${params.toString()}`);
          
          // Add ghost records explanation to metadata
          // Ghost records SELALU include: TX ID, waktu dihapus/dibatalkan, alasan
          data.exportMetadata.ghostRecordsInfo = {
            description: 'Data yang sudah dihapus/dibatalkan (auto clean-up)',
            fields: ['txId', 'waktuDihapus', 'alasan'],
            note: 'transaction/expense = dihapus | schedule = dibatalkan',
            retentionDays: 7
          };
          
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `ps3-rental-backup-${new Date().toISOString().split('T')[0]}.json`;
          a.click();
          URL.revokeObjectURL(url);
          
          // Build summary message
          const parts = [];
          if (includeTransactionHistory) parts.push('riwayat transaksi');
          if (pendingExportOptions.includeIncomeType) parts.push('pendapatan');
          if (pendingExportOptions.includeExpenseType) parts.push('pengeluaran');
          parts.push('riwayat edit (auto)');
          parts.push('data dihapus/dibatalkan (auto)');
          
          showToast(`Backup tersimpan: ${parts.join(', ')}`, 'success');
          
        } else if (pendingExportType === 'csv') {
          if (pendingExportPeriod === 'all') {
            // Export CSV All (edit history dan ghost records selalu include di server)
            await exportCSVAllWithOptions(pendingExportOptions, includeTransactionHistory);
          } else {
            // Export CSV for specific period (today/week/month/year)
            await exportCSVPeriodicWithOptions(pendingExportPeriod, pendingExportOptions, includeTransactionHistory, includeEditHistory);
          }
        }
      } catch (error) {
        showToast('Ekspor gagal: ' + error.message, 'error');
      }
      
      // Reset pending options
      pendingExportOptions = null;
      pendingExportPeriod = null;
      pendingExportType = null;
    }

    // Export CSV All (edit history dan ghost records selalu include di server)
    async function exportCSVAllWithOptions(options, includeTransactionHistory) {
      const params = new URLSearchParams();
      params.set('transactionData', includeTransactionHistory);
      params.set('transactions', options.includeIncomeType);
      params.set('expenses', options.includeExpenseType);
      // Edit history dan ghost records SELALU di-include dari server
      
      // Fetch data from API
      const data = await api('GET', `/db?${params.toString()}`);
      const now = new Date();
      
      let csv = '\ufeff';
      
      // Add header info
      csv += 'PS3 RENTAL MANAGER - LAPORAN LENGKAP\n';
      csv += `Diekspor pada: ${now.toLocaleDateString('id-ID')} ${now.toLocaleTimeString('id-ID')} WIB\n`;
      csv += `Timezone: WIB (UTC+7)\n\n`;
      
      // SECTION 1: Income Transactions
      if (includeTransactionHistory && data.transactions && data.transactions.length > 0) {
        csv += '═══════════════════════════════════════════════════════════════\n';
        csv += 'TRANSAKSI PENDAPATAN\n';
        csv += '═══════════════════════════════════════════════════════════════\n';
        csv += 'TX ID,Tanggal,Waktu,Unit,Pelanggan,Durasi (menit),Biaya,Pembayaran,Catatan,Jumlah Edit\n';
        
        data.transactions.forEach(t => {
          const date = new Date(t.endTime);
          const dateStr = date.toLocaleDateString('id-ID');
          const timeStr = date.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false}) + ' WIB';
          csv += `"${t.id}","${dateStr}","${timeStr}","${t.unitName}","${t.customer || '-'}",${t.durationMin},${t.paid},"${t.payment || 'cash'}","${(t.note || '').replace(/"/g, '""')}",${t.editCount || 0}\n`;
        });
        
        const totalIncome = data.transactions.reduce((sum, t) => sum + (t.paid || 0), 0);
        csv += `"TOTAL","","","","",${data.transactions.length} transaksi,${totalIncome},"","",""\n\n`;
      }
      
      // SECTION 2: Expense Transactions
      if (includeTransactionHistory && data.expenses && data.expenses.length > 0) {
        csv += '═══════════════════════════════════════════════════════════════\n';
        csv += 'TRANSAKSI PENGELUARAN\n';
        csv += '═══════════════════════════════════════════════════════════════\n';
        csv += 'TX ID,Tanggal,Waktu,Item,Kategori,Jumlah,Catatan,Jumlah Edit\n';

        data.expenses.forEach(e => {
          const date = new Date(e.created_at);
          const dateStr = date.toLocaleDateString('id-ID');
          const timeStr = date.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false}) + ' WIB';
          csv += `"${e.id}","${dateStr}","${timeStr}","${e.item}","${e.category || '-'}",${e.amount},"${(e.note || '').replace(/"/g, '""')}",${e.editCount || 0}\n`;
        });

        const totalExpense = data.expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        csv += `"TOTAL","","","","",${data.expenses.length} transaksi,${totalExpense},"",""\n\n`;
      }
      
      // SECTION 3: Ghost Records (Deleted Transactions)
      if (includeDeleteHistory && data.deletedRecords && data.deletedRecords.length > 0) {
        csv += '═══════════════════════════════════════════════════════════════\n';
        csv += 'RIWAYAT HAPUS (GHOST RECORDS)\n';
        csv += 'Catatan: TX ID berikut sudah dihapus permanen dari database\n';
        csv += '═══════════════════════════════════════════════════════════════\n';
        csv += 'TX ID,Tipe Data,Status,Tanggal Hapus,Waktu Hapus,Alasan\n';
        
        data.deletedRecords.forEach(r => {
          const deletedDate = new Date(r.deletedAt);
          const dateStr = deletedDate.toLocaleDateString('id-ID');
          const timeStr = deletedDate.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false}) + ' WIB';
          const typeLabel = r.recordType === 'transaction' ? 'Pendapatan' : 'Pengeluaran';
          csv += `"${r.recordId}","${typeLabel}","${r.status}","${dateStr}","${timeStr}","${(r.deleteReason || '-').replace(/"/g, '""')}"\n`;
        });
        
        csv += `"TOTAL","","",${data.deletedRecords.length} data dihapus,"",""\n\n`;
      }
      
      // SECTION 4: Edit History (if requested)
      if (includeEditHistory) {
        const hasEditHistory = (data.transactionsEditHistory && data.transactionsEditHistory.length > 0) ||
                               (data.expensesEditHistory && data.expensesEditHistory.length > 0);
        
        if (hasEditHistory) {
          csv += '═══════════════════════════════════════════════════════════════\n';
          csv += 'RIWAYAT EDIT\n';
          csv += '═══════════════════════════════════════════════════════════════\n';
          csv += 'TX ID,Tipe Data,Field,Yang Diubah,Jadi,Alasan Edit,Tanggal Edit\n';
          
          // Income edit history
          if (data.transactionsEditHistory) {
            data.transactionsEditHistory.forEach(log => {
              const editDate = new Date(log.editedAt);
              const dateStr = editDate.toLocaleDateString('id-ID') + ' ' + editDate.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false});
              csv += `"${log.transactionId}","Pendapatan","${log.fieldName}","${(log.oldValue || '-').replace(/"/g, '""')}","${(log.newValue || '-').replace(/"/g, '""')}","${(log.editReason || '-').replace(/"/g, '""')}","${dateStr}"\n`;
            });
          }
          
          // Expense edit history
          if (data.expensesEditHistory) {
            data.expensesEditHistory.forEach(log => {
              const editDate = new Date(log.editedAt);
              const dateStr = editDate.toLocaleDateString('id-ID') + ' ' + editDate.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false});
              csv += `"${log.expenseId}","Pengeluaran","${log.fieldName}","${(log.oldValue || '-').replace(/"/g, '""')}","${(log.newValue || '-').replace(/"/g, '""')}","${(log.editReason || '-').replace(/"/g, '""')}","${dateStr}"\n`;
            });
          }
          
          csv += `\n`;
        }
      }
      
      // Summary Section
      csv += '═══════════════════════════════════════════════════════════════\n';
      csv += 'RINGKASAN\n';
      csv += '═══════════════════════════════════════════════════════════════\n';
      if (options.includeTransactions) {
        const count = data.transactions ? data.transactions.length : 0;
        const total = data.transactions ? data.transactions.reduce((s, t) => s + (t.paid || 0), 0) : 0;
        csv += `Total Transaksi Pendapatan: ${count} (Rp ${total.toLocaleString('id-ID')})\n`;
      }
      if (options.includeExpenses) {
        const count = data.expenses ? data.expenses.length : 0;
        const total = data.expenses ? data.expenses.reduce((s, e) => s + (e.amount || 0), 0) : 0;
        csv += `Total Transaksi Pengeluaran: ${count} (Rp ${total.toLocaleString('id-ID')})\n`;
      }
      if (includeDeleteHistory && data.deletedRecords) {
        csv += `Total Data Dihapus (Ghost Records): ${data.deletedRecords.length}\n`;
      }
      csv += '═══════════════════════════════════════════════════════════════\n';
      csv += 'Catatan: TX ID dengan status "Dihapus" menunjukkan transaksi yang sudah\n';
      csv += 'dihapus permanen dari database dan hanya menyisakan ID serta info penghapusan.\n';
      csv += 'Data dihapus otomatis setelah 7 hari di tempat sampah.\n';
      
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ps3-laporan-lengkap-${now.toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      
      showToast('Laporan lengkap dengan riwayat diunduh', 'success');
    }

    // Export CSV for periodic range with options (today/week/month/year)
    async function exportCSVPeriodicWithOptions(period, options, includeTransactionHistory, includeEditHistory) {
      // Get current WIB time
      const now = new Date();
      const wibOffset = 7 * 60 * 60 * 1000; // 7 hours in milliseconds
      const wibTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + wibOffset);
      
      let startTime, endTime, periodLabel;
      
      switch(period) {
        case 'today':
          // Harian: 00:00 - 23:59 hari ini (WIB)
          const todayYear = wibTime.getFullYear();
          const todayMonth = wibTime.getMonth();
          const todayDate = wibTime.getDate();
          startTime = new Date(Date.UTC(todayYear, todayMonth, todayDate, 0, 0, 0) - wibOffset).getTime();
          endTime = new Date(Date.UTC(todayYear, todayMonth, todayDate, 23, 59, 59, 999) - wibOffset).getTime();
          periodLabel = 'Harian';
          break;
          
        case 'week':
          // Mingguan: Senin 00:00 - Minggu 23:59 minggu ini (WIB)
          const currentDay = wibTime.getDay(); // 0 = Minggu, 1 = Senin, ..., 6 = Sabtu
          const daysSinceMonday = currentDay === 0 ? 6 : currentDay - 1;
          const mondayDate = new Date(wibTime);
          mondayDate.setDate(wibTime.getDate() - daysSinceMonday);
          const sundayDate = new Date(mondayDate);
          sundayDate.setDate(mondayDate.getDate() + 6);
          
          startTime = new Date(Date.UTC(mondayDate.getFullYear(), mondayDate.getMonth(), mondayDate.getDate(), 0, 0, 0) - wibOffset).getTime();
          endTime = new Date(Date.UTC(sundayDate.getFullYear(), sundayDate.getMonth(), sundayDate.getDate(), 23, 59, 59, 999) - wibOffset).getTime();
          periodLabel = 'Mingguan';
          break;
          
        case 'month':
          // Bulanan: Tanggal 1 00:00 - akhir bulan 23:59 (WIB)
          const monthYear = wibTime.getFullYear();
          const month = wibTime.getMonth();
          const lastDayOfMonth = new Date(Date.UTC(monthYear, month + 1, 0)).getDate(); // Last day of month (1-31)

          // WIB timezone: UTC+7, so we subtract 7 hours from UTC to get WIB
          startTime = Date.UTC(monthYear, month, 1, 0, 0, 0) - wibOffset;
          endTime = Date.UTC(monthYear, month, lastDayOfMonth, 23, 59, 59, 999) - wibOffset;
          periodLabel = 'Bulanan';
          break;
          
        case 'year':
          // Tahunan: 1 Januari 00:00 - 31 Desember 23:59 (WIB)
          const year = wibTime.getFullYear();
          startTime = new Date(Date.UTC(year, 0, 1, 0, 0, 0) - wibOffset).getTime();
          endTime = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999) - wibOffset).getTime();
          periodLabel = 'Tahunan';
          break;
      }
      
      // Filter transactions and expenses by time range
      let filteredTransactions = [];
      let filteredExpenses = [];
      
      if (options.includeIncomeType) {
        filteredTransactions = transactions.filter(t => {
          const tTime = t.endTime || t.timestamp || 0;
          return tTime >= startTime && tTime <= endTime;
        });
      }
      
      if (options.includeExpenseType) {
        filteredExpenses = expenses.filter(e => {
          const eTime = e.timestamp || e.created_at || 0;
          return eTime >= startTime && eTime <= endTime;
        });
      }
      
      // Format date for filename
      const fileDate = wibTime.toISOString().split('T')[0];
      
      let csv = '\ufeff';
      
      // Add header info
      csv += 'PS3 RENTAL MANAGER - LAPORAN ' + periodLabel.toUpperCase() + '\n';
      // Format dates in WIB timezone for display
      const formatWIBDate = (timestamp) => {
        const d = new Date(timestamp);
        return d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
      };
      csv += `Periode: ${formatWIBDate(startTime)} - ${formatWIBDate(endTime)}\n`;
      csv += `Diekspor pada: ${wibTime.toLocaleDateString('id-ID')} ${wibTime.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false})} WIB\n`;
      csv += `Timezone: WIB (UTC+7)\n\n`;
      
      // SECTION 1: Income Transactions
      if (includeTransactionHistory && options.includeIncomeType && filteredTransactions.length > 0) {
        csv += '═══════════════════════════════════════════════════════════════\n';
        csv += 'TRANSAKSI PENDAPATAN\n';
        csv += '═══════════════════════════════════════════════════════════════\n';
        csv += 'TX ID,Tanggal,Waktu,Unit,Pelanggan,Durasi (menit),Biaya,Pembayaran,Catatan,Jumlah Edit\n';
        
        filteredTransactions.forEach(t => {
          const date = new Date(t.endTime || t.timestamp);
          const dateStr = date.toLocaleDateString('id-ID');
          const timeStr = date.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false}) + ' WIB';
          csv += `"${t.id}","${dateStr}","${timeStr}","${t.unitName}","${t.customer || '-'}",${t.durationMin || 0},${t.paid || 0},"${t.payment || 'cash'}","${(t.note || '').replace(/"/g, '""')}",${t.editCount || 0}\n`;
        });
        
        const totalIncome = filteredTransactions.reduce((sum, t) => sum + (t.paid || 0), 0);
        csv += `"TOTAL","","","","",${filteredTransactions.length} transaksi,${totalIncome},"","",""\n\n`;
      }
      
      // SECTION 2: Expense Transactions
      if (includeTransactionHistory && options.includeExpenseType && filteredExpenses.length > 0) {
        csv += '═══════════════════════════════════════════════════════════════\n';
        csv += 'TRANSAKSI PENGELUARAN\n';
        csv += '═══════════════════════════════════════════════════════════════\n';
        csv += 'TX ID,Tanggal,Waktu,Item,Kategori,Jumlah,Catatan,Jumlah Edit\n';

        filteredExpenses.forEach(e => {
          const date = new Date(e.timestamp || e.created_at);
          const dateStr = date.toLocaleDateString('id-ID');
          const timeStr = date.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false}) + ' WIB';
          csv += `"${e.id}","${dateStr}","${timeStr}","${e.item}","${e.category || '-'}",${e.amount || 0},"${(e.note || '').replace(/"/g, '""')}",${e.editCount || 0}\n`;
        });
        
        const totalExpense = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        csv += `"TOTAL","","","","",${filteredExpenses.length} transaksi,${totalExpense},"",""\n\n`;
      }
      
      // SECTION 3: Edit History (if requested)
      if (includeEditHistory) {
        // Filter edit history to only include edits within the time range
        const incomeEditHistory = [];
        const expenseEditHistory = [];
        
        // Collect edit history from filtered transactions
        filteredTransactions.forEach(t => {
          if (t.editHistory && Array.isArray(t.editHistory)) {
            t.editHistory.forEach(edit => {
              incomeEditHistory.push({
                transactionId: t.id,
                fieldName: edit.field,
                oldValue: edit.oldValue,
                newValue: edit.newValue,
                editReason: edit.reason,
                editedAt: edit.timestamp
              });
            });
          }
        });
        
        // Collect edit history from filtered expenses
        filteredExpenses.forEach(e => {
          if (e.editHistory && Array.isArray(e.editHistory)) {
            e.editHistory.forEach(edit => {
              expenseEditHistory.push({
                expenseId: e.id,
                fieldName: edit.field,
                oldValue: edit.oldValue,
                newValue: edit.newValue,
                editReason: edit.reason,
                editedAt: edit.timestamp
              });
            });
          }
        });
        
        const hasEditHistory = incomeEditHistory.length > 0 || expenseEditHistory.length > 0;
        
        if (hasEditHistory) {
          csv += '═══════════════════════════════════════════════════════════════\n';
          csv += 'RIWAYAT EDIT\n';
          csv += '═══════════════════════════════════════════════════════════════\n';
          csv += 'TX ID,Tipe Data,Field,Yang Diubah,Jadi,Alasan Edit,Tanggal Edit\n';
          
          // Income edit history
          incomeEditHistory.forEach(log => {
            const editDate = new Date(log.editedAt);
            const dateStr = editDate.toLocaleDateString('id-ID') + ' ' + editDate.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false});
            csv += `"${log.transactionId}","Pendapatan","${log.fieldName}","${(log.oldValue || '-').replace(/"/g, '""')}","${(log.newValue || '-').replace(/"/g, '""')}","${(log.editReason || '-').replace(/"/g, '""')}","${dateStr}"\n`;
          });
          
          // Expense edit history
          expenseEditHistory.forEach(log => {
            const editDate = new Date(log.editedAt);
            const dateStr = editDate.toLocaleDateString('id-ID') + ' ' + editDate.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false});
            csv += `"${log.expenseId}","Pengeluaran","${log.fieldName}","${(log.oldValue || '-').replace(/"/g, '""')}","${(log.newValue || '-').replace(/"/g, '""')}","${(log.editReason || '-').replace(/"/g, '""')}","${dateStr}"\n`;
          });
          
          csv += `\n`;
        }
      }
      
      // Summary Section
      csv += '═══════════════════════════════════════════════════════════════\n';
      csv += 'RINGKASAN\n';
      csv += '═══════════════════════════════════════════════════════════════\n';
      
      if (options.includeIncomeType) {
        const totalIncome = filteredTransactions.reduce((sum, t) => sum + (t.paid || 0), 0);
        csv += `Total Transaksi Pendapatan,${filteredTransactions.length},Total Pendapatan,${totalIncome}\n`;
      }
      
      if (options.includeExpenseType) {
        const totalExpense = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        csv += `Total Transaksi Pengeluaran,${filteredExpenses.length},Total Pengeluaran,${totalExpense}\n`;
      }
      
      if (options.includeIncomeType && options.includeExpenseType) {
        const totalIncome = filteredTransactions.reduce((sum, t) => sum + (t.paid || 0), 0);
        const totalExpense = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        csv += `NET PROFIT,,,${totalIncome - totalExpense}\n`;
      }
      
      csv += '\nDibuat oleh PS3 Rental Manager\n';
      
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ps3-laporan-${period}-${fileDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      
      showToast(`Laporan ${periodLabel.toLowerCase()} diunduh`, 'success');
    }

    // Simple CSV export for other periods (today, week, month, year) - DEPRECATED, use modal flow
    function exportCSVSimple(period) {
      let filtered = transactions;
      const now = new Date();
      
      switch(period) {
        case 'today':
          const todayKey = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`;
          filtered = transactions.filter(t => t.date === todayKey);
          break;
        case 'week':
          const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
          filtered = transactions.filter(t => t.endTime >= weekAgo);
          break;
        case 'month':
          filtered = transactions.filter(t => {
            const d = new Date(t.endTime);
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
          });
          break;
        case 'year':
          filtered = transactions.filter(t => new Date(t.endTime).getFullYear() === now.getFullYear());
          break;
      }
      
      // CSV Header
      let csv = '\ufeffTanggal,Waktu,Unit,Pelanggan,Durasi (menit),Biaya,Pembayaran,Catatan\n';
      
      filtered.forEach(t => {
        const date = new Date(t.endTime);
        const dateStr = date.toLocaleDateString('id-ID');
        const timeStr = date.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false}) + ' WIB';
        csv += `"${dateStr}","${timeStr}","${t.unitName}","${t.customer || '-'}",${t.durationMin},${t.paid},"${t.payment || 'cash'}","${t.note || ''}"\n`;
      });
      
      // Add totals
      const total = filtered.reduce((sum, t) => sum + t.paid, 0);
      csv += `"","","","TOTAL",${filtered.length} transaksi,${total},"",""\n`;
      
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ps3-laporan-${period}-${now.toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Laporan ${period} diunduh`, 'success');
    }

    // ═════════════════ CUSTOM EXPORT FUNCTIONS ═════════════════
    // Global variables for custom export state
    let pendingCustomExportOptions = {};

    // Step 1: Open Custom Export Modal (load data and show modal)
    async function exportCustomRange() {
      // Load latest data first
      await loadData();

      // Reset modal fields
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('customExportStartDate').value = today;
      document.getElementById('customExportEndDate').value = today;
      document.getElementById('customExportCSV').checked = true;
      document.getElementById('customExportJSON').checked = true;
      document.getElementById('customExportIncome').checked = true;
      document.getElementById('customExportExpense').checked = true;
      document.getElementById('customExportRangeError').style.display = 'none';

      // Show Modal 1
      document.getElementById('modalCustomExportRange').classList.add('active');
    }

    // Step 2: Confirm Custom Export Range (validate and go to Modal 2)
    function confirmCustomExportRange() {
      const startDate = document.getElementById('customExportStartDate').value;
      const endDate = document.getElementById('customExportEndDate').value;
      const includeCSV = document.getElementById('customExportCSV').checked;
      const includeJSON = document.getElementById('customExportJSON').checked;
      const includeIncome = document.getElementById('customExportIncome').checked;
      const includeExpense = document.getElementById('customExportExpense').checked;

      // Validate: must select at least one file format
      if (!includeCSV && !includeJSON) {
        document.getElementById('customExportRangeError').style.display = 'block';
        return;
      }

      // Validate: must select at least one data type
      if (!includeIncome && !includeExpense) {
        document.getElementById('customExportRangeError').style.display = 'block';
        return;
      }

      // Validate: dates must be selected
      if (!startDate || !endDate) {
        document.getElementById('customExportRangeError').style.display = 'block';
        document.getElementById('customExportRangeError').querySelector('p').textContent = '⚠️ Pilih range tanggal yang valid';
        return;
      }

      // Validate: start date must be before or equal to end date
      if (new Date(startDate) > new Date(endDate)) {
        document.getElementById('customExportRangeError').style.display = 'block';
        document.getElementById('customExportRangeError').querySelector('p').textContent = '⚠️ Tanggal mulai harus sebelum atau sama dengan tanggal akhir';
        return;
      }

      document.getElementById('customExportRangeError').style.display = 'none';

      // Store options
      pendingCustomExportOptions = {
        startDate: startDate,
        endDate: endDate,
        includeCSV: includeCSV,
        includeJSON: includeJSON,
        includeIncomeType: includeIncome,
        includeExpenseType: includeExpense
      };

      // Close Modal 1
      document.getElementById('modalCustomExportRange').classList.remove('active');

      // Reset and show Modal 2 (all checked by default)
      document.getElementById('customExportTransactionHistory').checked = true;
      document.getElementById('customExportEditHistory').checked = true;
      document.getElementById('customExportDeleteHistory').checked = true;

      document.getElementById('modalCustomExportOptions').classList.add('active');
    }

    // Step 3: Execute Custom Export
    async function executeCustomExport() {
      const includeTransactionHistory = document.getElementById('customExportTransactionHistory').checked;
      const includeEditHistory = document.getElementById('customExportEditHistory').checked;
      const includeDeleteHistory = document.getElementById('customExportDeleteHistory').checked;

      // Validate: at least one option must be selected
      if (!includeTransactionHistory && !includeEditHistory && !includeDeleteHistory) {
        showToast('Pilih minimal satu jenis data untuk diekspor', 'error');
        return;
      }

      // Close Modal 2
      document.getElementById('modalCustomExportOptions').classList.remove('active');

      try {
        // Convert dates to timestamps (WIB timezone)
        const wibOffset = 7 * 60 * 60 * 1000;
        const startDate = new Date(pendingCustomExportOptions.startDate);
        const endDate = new Date(pendingCustomExportOptions.endDate);

        // Set start time to 00:00:00 and end time to 23:59:59
        const startTime = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0) - wibOffset;
        const endTime = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999) - wibOffset;

        const formatWIBDate = (timestamp) => {
          const d = new Date(timestamp);
          return d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
        };

        // Export CSV if selected
        if (pendingCustomExportOptions.includeCSV) {
          await exportCustomCSV(startTime, endTime, formatWIBDate, includeTransactionHistory, includeEditHistory);
        }

        // Export JSON if selected
        if (pendingCustomExportOptions.includeJSON) {
          await exportCustomJSON(startTime, endTime, formatWIBDate, includeTransactionHistory, includeEditHistory, includeDeleteHistory);
        }

        showToast('Ekspor kustom berhasil', 'success');
      } catch (err) {
        console.error('Custom export error:', err);
        showToast('Ekspor gagal: ' + err.message, 'error');
      }
    }

    // Export Custom Range CSV
    async function exportCustomCSV(startTime, endTime, formatWIBDate, includeTransactionHistory, includeEditHistory) {
      // Filter data by time range
      let filteredTransactions = [];
      let filteredExpenses = [];

      if (pendingCustomExportOptions.includeIncomeType) {
        filteredTransactions = transactions.filter(t => {
          const tTime = t.endTime || t.timestamp || 0;
          return tTime >= startTime && tTime <= endTime;
        });
      }

      if (pendingCustomExportOptions.includeExpenseType) {
        filteredExpenses = expenses.filter(e => {
          const eTime = e.timestamp || e.created_at || 0;
          return eTime >= startTime && eTime <= endTime;
        });
      }

      const wibTime = new Date();
      const fileDate = wibTime.toISOString().split('T')[0];

      let csv = '\ufeff';
      csv += 'PS3 RENTAL MANAGER - LAPORAN KUSTOM\n';
      csv += `Periode: ${formatWIBDate(startTime)} - ${formatWIBDate(endTime)}\n`;
      csv += `Diekspor pada: ${wibTime.toLocaleDateString('id-ID')} ${wibTime.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false})} WIB\n`;
      csv += `Timezone: WIB (UTC+7)\n\n`;

      // Income Transactions
      if (includeTransactionHistory && filteredTransactions.length > 0) {
        csv += '═══════════════════════════════════════════════════════════════\n';
        csv += 'TRANSAKSI PENDAPATAN\n';
        csv += '═══════════════════════════════════════════════════════════════\n';
        csv += 'TX ID,Tanggal,Waktu,Unit,Pelanggan,Durasi (menit),Biaya,Pembayaran,Catatan,Jumlah Edit\n';

        filteredTransactions.forEach(t => {
          const date = new Date(t.endTime || t.timestamp);
          const dateStr = date.toLocaleDateString('id-ID');
          const timeStr = date.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false}) + ' WIB';
          csv += `"${t.id}","${dateStr}","${timeStr}","${t.unitName}","${t.customer || '-'}",${t.durationMin || 0},${t.paid || 0},"${t.payment || 'cash'}","${(t.note || '').replace(/"/g, '""')}",${t.editCount || 0}\n`;
        });

        const totalIncome = filteredTransactions.reduce((sum, t) => sum + (t.paid || 0), 0);
        csv += `"TOTAL","","","","",${filteredTransactions.length} transaksi,${totalIncome},"","",""\n\n`;
      }

      // Expense Transactions
      if (includeTransactionHistory && filteredExpenses.length > 0) {
        csv += '═══════════════════════════════════════════════════════════════\n';
        csv += 'TRANSAKSI PENGELUARAN\n';
        csv += '═══════════════════════════════════════════════════════════════\n';
        csv += 'TX ID,Tanggal,Waktu,Item,Kategori,Jumlah,Catatan,Jumlah Edit\n';

        filteredExpenses.forEach(e => {
          const date = new Date(e.timestamp || e.created_at);
          const dateStr = date.toLocaleDateString('id-ID');
          const timeStr = date.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false}) + ' WIB';
          csv += `"${e.id}","${dateStr}","${timeStr}","${e.item}","${e.category || '-'}",${e.amount || 0},"${(e.note || '').replace(/"/g, '""')}",${e.editCount || 0}\n`;
        });

        const totalExpense = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        csv += `"TOTAL","","","","",${filteredExpenses.length} transaksi,${totalExpense},"",""\n\n`;
      }

      // Edit History
      if (includeEditHistory) {
        const incomeEditHistory = [];
        const expenseEditHistory = [];

        filteredTransactions.forEach(t => {
          if (t.editHistory && Array.isArray(t.editHistory)) {
            t.editHistory.forEach(edit => {
              incomeEditHistory.push({
                transactionId: t.id,
                fieldName: edit.field,
                oldValue: edit.oldValue,
                newValue: edit.newValue,
                editReason: edit.reason,
                editedAt: edit.timestamp
              });
            });
          }
        });

        filteredExpenses.forEach(e => {
          if (e.editHistory && Array.isArray(e.editHistory)) {
            e.editHistory.forEach(edit => {
              expenseEditHistory.push({
                expenseId: e.id,
                fieldName: edit.field,
                oldValue: edit.oldValue,
                newValue: edit.newValue,
                editReason: edit.reason,
                editedAt: edit.timestamp
              });
            });
          }
        });

        const hasEditHistory = incomeEditHistory.length > 0 || expenseEditHistory.length > 0;

        if (hasEditHistory) {
          csv += '═══════════════════════════════════════════════════════════════\n';
          csv += 'RIWAYAT EDIT\n';
          csv += '═══════════════════════════════════════════════════════════════\n';
          csv += 'TX ID,Tipe Data,Field,Yang Diubah,Jadi,Alasan Edit,Tanggal Edit\n';

          incomeEditHistory.forEach(log => {
            const editDate = new Date(log.editedAt);
            const dateStr = editDate.toLocaleDateString('id-ID') + ' ' + editDate.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false});
            csv += `"${log.transactionId}","Pendapatan","${log.fieldName}","${(log.oldValue || '-').replace(/"/g, '""')}","${(log.newValue || '-').replace(/"/g, '""')}","${(log.editReason || '-').replace(/"/g, '""')}","${dateStr}"\n`;
          });

          expenseEditHistory.forEach(log => {
            const editDate = new Date(log.editedAt);
            const dateStr = editDate.toLocaleDateString('id-ID') + ' ' + editDate.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit', hour12: false});
            csv += `"${log.expenseId}","Pengeluaran","${log.fieldName}","${(log.oldValue || '-').replace(/"/g, '""')}","${(log.newValue || '-').replace(/"/g, '""')}","${(log.editReason || '-').replace(/"/g, '""')}","${dateStr}"\n`;
          });

          csv += `\n`;
        }
      }

      // Download CSV
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const startStr = pendingCustomExportOptions.startDate;
      const endStr = pendingCustomExportOptions.endDate;
      a.download = `ps3-laporan-kustom-${startStr}_sampai_${endStr}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }

    // Export Custom Range JSON
    async function exportCustomJSON(startTime, endTime, formatWIBDate, includeTransactionHistory, includeEditHistory, includeDeleteHistory) {
      const params = new URLSearchParams();
      params.set('transactionData', includeTransactionHistory);
      params.set('transactions', pendingCustomExportOptions.includeIncomeType);
      params.set('expenses', pendingCustomExportOptions.includeExpenseType);
      params.set('editHistory', includeEditHistory);
      params.set('deleteHistory', includeDeleteHistory);

      // Fetch data from API
      const data = await api('GET', `/db?${params.toString()}`);

      // Filter by date range
      if (data.transactions && pendingCustomExportOptions.includeIncomeType) {
        data.transactions = data.transactions.filter(t => {
          const tTime = t.endTime || t.timestamp || 0;
          return tTime >= startTime && tTime <= endTime;
        });
      } else {
        data.transactions = [];
      }

      if (data.expenses && pendingCustomExportOptions.includeExpenseType) {
        data.expenses = data.expenses.filter(e => {
          const eTime = e.timestamp || e.created_at || 0;
          return eTime >= startTime && eTime <= endTime;
        });
      } else {
        data.expenses = [];
      }

      // Add export metadata
      data.exportMetadata = {
        type: 'custom',
        startDate: pendingCustomExportOptions.startDate,
        endDate: pendingCustomExportOptions.endDate,
        exportedAt: new Date().toISOString(),
        timezone: 'WIB (UTC+7)',
        includeTransactionHistory: includeTransactionHistory,
        includeEditHistory: includeEditHistory,
        includeDeleteHistory: includeDeleteHistory
      };

      // Download JSON
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const startStr = pendingCustomExportOptions.startDate;
      const endStr = pendingCustomExportOptions.endDate;
      a.download = `ps3-backup-kustom-${startStr}_sampai_${endStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }

    // ═════════════════ UI Helpers ═════════════════
    function showPage(pageId) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById(pageId).classList.add('active');
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      event.target.closest('.nav-btn').classList.add('active');
      
      if (pageId === 'pageSettings') {
        // Populate settings
        document.getElementById('settingRate').value = settings.ratePerHour || 4000;
        document.getElementById('settingWarn').value = settings.warnBefore || 1;
        document.getElementById('settingBusiness').value = settings.businessName || 'PS3 Rental';
        
        // Update page title with business name
        const businessName = settings.businessName || 'PS3 Rental';
        document.getElementById('pageTitle').textContent = businessName + ' - Manager';
        document.querySelector('.header-title').innerHTML = businessName.replace(/(.+?)\s*(\S+)$/, '$1 <span>$2</span>');
      }
      
      if (pageId === 'pageManagement') {
        // Load management page data
        renderSchedules();
        renderInventory();
        renderCapitalSummary();
        renderCapitalHistory();
        populateScheduleStationSelect();
        
        // Set default dates
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('scheduleDate').value = today;
        document.getElementById('capitalDate').value = today;
        document.getElementById('capitalExpenseDate').value = today;
        document.getElementById('inventoryPurchaseDate').value = today;
      }
    }

    async function openAddScheduleModal() {
      // Get current time in WIB (UTC+7)
      const now = new Date();
      const wibOffset = 7 * 60 * 60 * 1000; // 7 hours in milliseconds
      const wibTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + wibOffset);

      // Format date as YYYY-MM-DD in WIB
      const today = wibTime.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      document.getElementById('scheduleDate').value = today;
      document.getElementById('scheduleEndDate').value = today;

      // Format time as HH:MM in WIB
      const startTime = wibTime.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit' });
      const endWibTime = new Date(wibTime.getTime() + 60 * 60000);
      const endTime = endWibTime.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit' });
      document.getElementById('scheduleTime').value = startTime;
      document.getElementById('scheduleEndTime').value = endTime;

      // Set default duration to 60 minutes
      document.getElementById('scheduleDuration').value = '60';
      document.getElementById('scheduleDurationCustom').style.display = 'none';
      document.getElementById('customDurationLabel').style.color = 'var(--ps3-muted)';

      // Ensure station select is populated with only "SIAP" stations
      await populateScheduleStationSelect();
      // Open modal
      openModal('modalAddSchedule');
    }

    // Populate station dropdown for Add Schedule modal - only show "SIAP" stations
    async function populateScheduleStationSelect() {
      const stationSelect = document.getElementById('scheduleUnit');

      // ALWAYS load fresh stations data from API (not cache)
      try {
        showLoading(true);
        stations = await api('GET', '/pairings');
        showLoading(false);
      } catch (error) {
        showLoading(false);
        console.error('Failed to load stations:', error);
        showToast('Gagal memuat data stasiun', 'error');
        return;
      }

      // Filter only "SIAP" stations (is_valid = true)
      const readyStations = stations.filter(s => s.is_valid === true || s.is_valid === 1);

      // Populate dropdown
      let options = '<option value="">Pilih stasiun...</option>';
      readyStations.forEach(s => {
        options += `<option value="${s.id}">${s.name}</option>`;
      });

      // If no ready stations, show warning option
      if (readyStations.length === 0) {
        options = '<option value="">Tidak ada stasiun SIAP</option>';
      }

      stationSelect.innerHTML = options;
    }

    function openModal(id, front = false) {
      const modal = document.getElementById(id);
      modal.classList.add('active');
      if (front) {
        modal.classList.add('modal-front');
      }
    }

    function closeModal(id) {
      const modal = document.getElementById(id);
      modal.classList.remove('active');
      modal.classList.remove('modal-front');

      // Reset edit modal title when closing
      if (id === 'modalEditTransaction') {
        document.querySelector('#modalEditTransaction .modal-title').textContent = '✏️ Edit Transaksi';
      }
      if (id === 'modalEditSchedule') {
        document.querySelector('#modalEditSchedule .modal-title').textContent = '✏️ Edit Jadwal';
      }
    }

    // ═════════════════ Schedule History & Trash Search/Filter State ═════════════════
    let historySearchState = {
      search: '',
      customer: '',
      unit: '',
      startDateFrom: '',
      startDateTo: '',
      endDateFrom: '',
      endDateTo: '',
      startTimeFrom: '',
      startTimeTo: '',
      durationMin: '',
      durationMax: '',
      note: ''
    };
    let historySearchDebounceTimer = null;
    let cachedHistoryData = [];

    let trashScheduleSearchState = {
      search: '',
      customer: '',
      unit: '',
      startDateFrom: '',
      startDateTo: '',
      endDateFrom: '',
      endDateTo: '',
      startTimeFrom: '',
      startTimeTo: '',
      durationMin: '',
      durationMax: '',
      note: '',
      reason: ''
    };
    let trashScheduleSearchDebounceTimer = null;
    let cachedTrashScheduleData = [];

    // ═════════════════ AUTOCOMPLETE SUGGESTIONS ═════════════════
    // ─── History Autocomplete Functions ───
    function getHistoryIdSuggestions(query) {
      if (!query || !cachedHistoryData.length) return [];
      const q = query.toLowerCase();
      const ids = [...new Set(cachedHistoryData.map(s => s.scheduleId).filter(Boolean))];
      return ids.filter(id => id.toLowerCase().includes(q)).slice(0, 10);
    }

    function getHistoryCustomerSuggestions(query) {
      if (!query || !cachedHistoryData.length) return [];
      const q = query.toLowerCase();
      const names = [...new Set(cachedHistoryData.map(s => s.customer).filter(Boolean))];
      return names.filter(name => name.toLowerCase().includes(q)).slice(0, 10);
    }

    function getHistoryNoteSuggestions(query) {
      if (!query || !cachedHistoryData.length) return [];
      const q = query.toLowerCase();
      const notes = [...new Set(cachedHistoryData.map(s => s.note).filter(Boolean))];
      return notes.filter(note => note.toLowerCase().includes(q)).slice(0, 10);
    }

    function showHistorySuggestions(inputId, suggestionsId, suggestions, onSelect, query = '') {
      const input = document.getElementById(inputId);
      const dropdown = document.getElementById(suggestionsId);
      if (!dropdown || !input) return;

      if (!suggestions || suggestions.length === 0) {
        dropdown.style.display = 'none';
        return;
      }

      dropdown.innerHTML = suggestions.map(s => `
        <div class="suggestion-item" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--ps3-border);" onmousedown="event.preventDefault(); ${onSelect}('${s.replace(/'/g, "\\'")}')">${highlightMatch(s, query)}</div>
      `).join('');
      dropdown.style.display = 'block';
    }

    function hideHistorySuggestions(suggestionsId) {
      const dropdown = document.getElementById(suggestionsId);
      if (dropdown) dropdown.style.display = 'none';
    }

    function onHistorySearchInput() {
      const query = document.getElementById('historySearchInput').value;
      const suggestions = getHistoryIdSuggestions(query);
      showHistorySuggestions('historySearchInput', 'historyIdSuggestions', suggestions, 'selectHistoryId', query);
      debouncedSearchHistory();
    }

    function selectHistoryId(value) {
      document.getElementById('historySearchInput').value = value;
      hideHistorySuggestions('historyIdSuggestions');
      searchHistory();
    }

    function showHistoryIdSuggestions() {
      const query = document.getElementById('historySearchInput').value;
      if (query.length >= 2) {
        const suggestions = getHistoryIdSuggestions(query);
        showHistorySuggestions('historySearchInput', 'historyIdSuggestions', suggestions, 'selectHistoryId', query);
      }
    }

    function onHistoryCustomerInput() {
      const query = document.getElementById('historyFilterCustomer').value;
      const suggestions = getHistoryCustomerSuggestions(query);
      showHistorySuggestions('historyFilterCustomer', 'historyCustomerSuggestions', suggestions, 'selectHistoryCustomer', query);
      debouncedSearchHistory();
    }

    function selectHistoryCustomer(value) {
      document.getElementById('historyFilterCustomer').value = value;
      hideHistorySuggestions('historyCustomerSuggestions');
      searchHistory();
    }

    function showHistoryCustomerSuggestions() {
      const query = document.getElementById('historyFilterCustomer').value;
      if (query.length >= 2) {
        const suggestions = getHistoryCustomerSuggestions(query);
        showHistorySuggestions('historyFilterCustomer', 'historyCustomerSuggestions', suggestions, 'selectHistoryCustomer', query);
      }
    }

    function onHistoryNoteInput() {
      const query = document.getElementById('historyFilterNote').value;
      const suggestions = getHistoryNoteSuggestions(query);
      showHistorySuggestions('historyFilterNote', 'historyNoteSuggestions', suggestions, 'selectHistoryNote', query);
      debouncedSearchHistory();
    }

    function selectHistoryNote(value) {
      document.getElementById('historyFilterNote').value = value;
      hideHistorySuggestions('historyNoteSuggestions');
      searchHistory();
    }

    function showHistoryNoteSuggestions() {
      const query = document.getElementById('historyFilterNote').value;
      if (query.length >= 2) {
        const suggestions = getHistoryNoteSuggestions(query);
        showHistorySuggestions('historyFilterNote', 'historyNoteSuggestions', suggestions, 'selectHistoryNote', query);
      }
    }

    // ─── Trash Schedule Autocomplete Functions ───
    function getTrashScheduleIdSuggestions(query) {
      if (!query || !cachedTrashScheduleData.length) return [];
      const q = query.toLowerCase();
      const ids = [...new Set(cachedTrashScheduleData.map(s => s.scheduleId).filter(Boolean))];
      return ids.filter(id => id.toLowerCase().includes(q)).slice(0, 10);
    }

    function getTrashScheduleCustomerSuggestions(query) {
      if (!query || !cachedTrashScheduleData.length) return [];
      const q = query.toLowerCase();
      const names = [...new Set(cachedTrashScheduleData.map(s => s.customer).filter(Boolean))];
      return names.filter(name => name.toLowerCase().includes(q)).slice(0, 10);
    }

    function getTrashScheduleNoteSuggestions(query) {
      if (!query || !cachedTrashScheduleData.length) return [];
      const q = query.toLowerCase();
      const notes = [...new Set(cachedTrashScheduleData.map(s => s.note).filter(Boolean))];
      return notes.filter(note => note.toLowerCase().includes(q)).slice(0, 10);
    }

    function getTrashScheduleReasonSuggestions(query) {
      if (!query || !cachedTrashScheduleData.length) return [];
      const q = query.toLowerCase();
      const reasons = [...new Set(cachedTrashScheduleData.map(s => s.deleteReason).filter(Boolean))];
      return reasons.filter(reason => reason.toLowerCase().includes(q)).slice(0, 10);
    }

    function showTrashScheduleSuggestions(inputId, suggestionsId, suggestions, onSelect, query = '') {
      const input = document.getElementById(inputId);
      const dropdown = document.getElementById(suggestionsId);
      if (!dropdown || !input) return;

      if (!suggestions || suggestions.length === 0) {
        dropdown.style.display = 'none';
        return;
      }

      dropdown.innerHTML = suggestions.map(s => `
        <div class="suggestion-item" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--ps3-border);" onmousedown="event.preventDefault(); ${onSelect}('${s.replace(/'/g, "\\'")}')">${highlightMatch(s, query)}</div>
      `).join('');
      dropdown.style.display = 'block';
    }

    function hideTrashScheduleSuggestions(suggestionsId) {
      const dropdown = document.getElementById(suggestionsId);
      if (dropdown) dropdown.style.display = 'none';
    }

    function onTrashScheduleSearchInput() {
      const query = document.getElementById('trashScheduleSearchInput').value;
      const suggestions = getTrashScheduleIdSuggestions(query);
      showTrashScheduleSuggestions('trashScheduleSearchInput', 'trashScheduleIdSuggestions', suggestions, 'selectTrashScheduleId', query);
      debouncedSearchTrashSchedule();
    }

    function selectTrashScheduleId(value) {
      document.getElementById('trashScheduleSearchInput').value = value;
      hideTrashScheduleSuggestions('trashScheduleIdSuggestions');
      searchTrashSchedule();
    }

    function showTrashScheduleIdSuggestions() {
      const query = document.getElementById('trashScheduleSearchInput').value;
      if (query.length >= 2) {
        const suggestions = getTrashScheduleIdSuggestions(query);
        showTrashScheduleSuggestions('trashScheduleSearchInput', 'trashScheduleIdSuggestions', suggestions, 'selectTrashScheduleId', query);
      }
    }

    function onTrashScheduleCustomerInput() {
      const query = document.getElementById('trashScheduleFilterCustomer').value;
      const suggestions = getTrashScheduleCustomerSuggestions(query);
      showTrashScheduleSuggestions('trashScheduleFilterCustomer', 'trashScheduleCustomerSuggestions', suggestions, 'selectTrashScheduleCustomer', query);
      debouncedSearchTrashSchedule();
    }

    function selectTrashScheduleCustomer(value) {
      document.getElementById('trashScheduleFilterCustomer').value = value;
      hideTrashScheduleSuggestions('trashScheduleCustomerSuggestions');
      searchTrashSchedule();
    }

    function showTrashScheduleCustomerSuggestions() {
      const query = document.getElementById('trashScheduleFilterCustomer').value;
      if (query.length >= 2) {
        const suggestions = getTrashScheduleCustomerSuggestions(query);
        showTrashScheduleSuggestions('trashScheduleFilterCustomer', 'trashScheduleCustomerSuggestions', suggestions, 'selectTrashScheduleCustomer', query);
      }
    }

    function onTrashScheduleNoteInput() {
      const query = document.getElementById('trashScheduleFilterNote').value;
      const suggestions = getTrashScheduleNoteSuggestions(query);
      showTrashScheduleSuggestions('trashScheduleFilterNote', 'trashScheduleNoteSuggestions', suggestions, 'selectTrashScheduleNote', query);
      debouncedSearchTrashSchedule();
    }

    function selectTrashScheduleNote(value) {
      document.getElementById('trashScheduleFilterNote').value = value;
      hideTrashScheduleSuggestions('trashScheduleNoteSuggestions');
      searchTrashSchedule();
    }

    function showTrashScheduleNoteSuggestions() {
      const query = document.getElementById('trashScheduleFilterNote').value;
      if (query.length >= 2) {
        const suggestions = getTrashScheduleNoteSuggestions(query);
        showTrashScheduleSuggestions('trashScheduleFilterNote', 'trashScheduleNoteSuggestions', suggestions, 'selectTrashScheduleNote', query);
      }
    }

    function onTrashScheduleReasonInput() {
      const query = document.getElementById('trashScheduleFilterReason').value;
      const suggestions = getTrashScheduleReasonSuggestions(query);
      showTrashScheduleSuggestions('trashScheduleFilterReason', 'trashScheduleReasonSuggestions', suggestions, 'selectTrashScheduleReason', query);
      debouncedSearchTrashSchedule();
    }

    function selectTrashScheduleReason(value) {
      document.getElementById('trashScheduleFilterReason').value = value;
      hideTrashScheduleSuggestions('trashScheduleReasonSuggestions');
      searchTrashSchedule();
    }

    function showTrashScheduleReasonSuggestions() {
      const query = document.getElementById('trashScheduleFilterReason').value;
      if (query.length >= 2) {
        const suggestions = getTrashScheduleReasonSuggestions(query);
        showTrashScheduleSuggestions('trashScheduleFilterReason', 'trashScheduleReasonSuggestions', suggestions, 'selectTrashScheduleReason', query);
      }
    }

    // ─── History (Completed Schedules) Filter Functions ───
    function toggleHistoryFilters() {
      const panel = document.getElementById('historyFilterPanel');
      const isVisible = panel.style.display === 'block';
      panel.style.display = isVisible ? 'none' : 'block';
    }

    function debouncedSearchHistory() {
      if (historySearchDebounceTimer) {
        clearTimeout(historySearchDebounceTimer);
      }
      historySearchDebounceTimer = setTimeout(() => {
        searchHistory();
      }, 300);
    }

    function updateHistorySearchStateFromUI() {
      historySearchState.search = document.getElementById('historySearchInput').value.trim();
      historySearchState.customer = document.getElementById('historyFilterCustomer').value.trim();
      historySearchState.unit = document.getElementById('historyFilterUnit').value.trim();
      historySearchState.startDateFrom = document.getElementById('historyFilterStartDateFrom').value;
      historySearchState.startDateTo = document.getElementById('historyFilterStartDateTo').value;
      historySearchState.endDateFrom = document.getElementById('historyFilterEndDateFrom').value;
      historySearchState.endDateTo = document.getElementById('historyFilterEndDateTo').value;
      historySearchState.startTimeFrom = document.getElementById('historyFilterStartTimeFrom').value;
      historySearchState.startTimeTo = document.getElementById('historyFilterStartTimeTo').value;
      historySearchState.durationMin = document.getElementById('historyFilterDurationMin').value;
      historySearchState.durationMax = document.getElementById('historyFilterDurationMax').value;
      historySearchState.note = document.getElementById('historyFilterNote').value.trim();
    }

    function countActiveHistoryFilters() {
      let count = 0;
      if (historySearchState.customer) count++;
      if (historySearchState.unit) count++;
      if (historySearchState.startDateFrom || historySearchState.startDateTo) count++;
      if (historySearchState.endDateFrom || historySearchState.endDateTo) count++;
      if (historySearchState.startTimeFrom || historySearchState.startTimeTo) count++;
      if (historySearchState.durationMin || historySearchState.durationMax) count++;
      if (historySearchState.note) count++;
      return count;
    }

    function updateHistoryFilterBadge() {
      const count = countActiveHistoryFilters();
      const badge = document.getElementById('historyActiveFilterCount');
      if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
      }
    }

    function clearAllHistoryFilters() {
      historySearchState = {
        search: '',
        customer: '',
        unit: '',
        startDateFrom: '',
        startDateTo: '',
        endDateFrom: '',
        endDateTo: '',
        startTimeFrom: '',
        startTimeTo: '',
        durationMin: '',
        durationMax: '',
        note: ''
      };
      // Clear UI
      document.getElementById('historySearchInput').value = '';
      document.getElementById('historyFilterCustomer').value = '';
      document.getElementById('historyFilterUnit').value = '';
      document.getElementById('historyFilterStartDateFrom').value = '';
      document.getElementById('historyFilterStartDateTo').value = '';
      document.getElementById('historyFilterEndDateFrom').value = '';
      document.getElementById('historyFilterEndDateTo').value = '';
      document.getElementById('historyFilterStartTimeFrom').value = '';
      document.getElementById('historyFilterStartTimeTo').value = '';
      document.getElementById('historyFilterDurationMin').value = '';
      document.getElementById('historyFilterDurationMax').value = '';
      document.getElementById('historyFilterNote').value = '';
      document.getElementById('historyFilterPanel').style.display = 'none';
      updateHistoryFilterBadge();
      searchHistory();
    }

    function filterHistoryData(data) {
      return data.filter(item => {
        // Search by TX ID
        if (historySearchState.search) {
          const searchLower = historySearchState.search.toLowerCase();
          const idMatch = (item.scheduleId || '').toLowerCase().includes(searchLower);
          if (!idMatch) return false;
        }

        // Customer filter
        if (historySearchState.customer) {
          const customerLower = historySearchState.customer.toLowerCase();
          if (!(item.customer || '').toLowerCase().includes(customerLower)) return false;
        }

        // Unit filter
        if (historySearchState.unit) {
          const unitLower = historySearchState.unit.toLowerCase();
          const unitName = (item.unitName || '').toLowerCase();
          if (!unitName.includes(unitLower)) return false;
        }

        // Start Date range
        if (historySearchState.startDateFrom && item.scheduledDate < historySearchState.startDateFrom) return false;
        if (historySearchState.startDateTo && item.scheduledDate > historySearchState.startDateTo) return false;

        // End Date range
        if (historySearchState.endDateFrom && item.scheduledEndDate && item.scheduledEndDate < historySearchState.endDateFrom) return false;
        if (historySearchState.endDateTo && item.scheduledEndDate && item.scheduledEndDate > historySearchState.endDateTo) return false;

        // Start Time range
        if (historySearchState.startTimeFrom && item.scheduledTime < historySearchState.startTimeFrom) return false;
        if (historySearchState.startTimeTo && item.scheduledTime > historySearchState.startTimeTo) return false;

        // Duration range
        const duration = parseInt(item.duration) || 0;
        if (historySearchState.durationMin && duration < parseInt(historySearchState.durationMin)) return false;
        if (historySearchState.durationMax && duration > parseInt(historySearchState.durationMax)) return false;

        // Note filter
        if (historySearchState.note) {
          const noteLower = historySearchState.note.toLowerCase();
          if (!(item.note || '').toLowerCase().includes(noteLower)) return false;
        }

        return true;
      });
    }

    function searchHistory() {
      updateHistorySearchStateFromUI();
      updateHistoryFilterBadge();

      const filtered = filterHistoryData(cachedHistoryData);

      // Sort by TX ID descending
      filtered.sort((a, b) => {
        const idA = a.scheduleId || '';
        const idB = b.scheduleId || '';
        return idB.localeCompare(idA);
      });

      renderHistoryList(filtered);

      // Update results text
      const resultsText = document.getElementById('historySearchResults');
      if (resultsText) {
        if (historySearchState.search || countActiveHistoryFilters() > 0) {
          resultsText.textContent = `${filtered.length} hasil`;
        } else {
          resultsText.textContent = `${filtered.length} jadwal`;
        }
      }
    }

    function renderHistoryList(data) {
      const historyList = document.getElementById('historyList');

      if (!data || data.length === 0) {
        historyList.innerHTML = '<p class="empty-state-p30">📜 Tidak ada jadwal yang cocok dengan filter</p>';
        return;
      }

      const html = data.map((item, index) => {
        const badge = getHistoryScheduleStatusBadge(item.status);
        const nomor = index + 1;

        const fakeSchedule = {
          scheduledDate: item.scheduledDate,
          scheduledTime: item.scheduledTime,
          duration: item.duration,
          scheduledEndDate: item.scheduledEndDate,
          scheduledEndTime: item.scheduledEndTime
        };

        const formattedDate = formatScheduleDate(fakeSchedule);
        const formattedTime = formatScheduleTime(fakeSchedule);

        return `
          <div style="background: ${badge.bg}; border: 2px solid ${badge.border}; border-radius: 10px; padding: 12px; margin-bottom: 10px; position: relative;">
            <div style="position: absolute; top: -8px; left: 10px; background: var(--ps3-green-dark); color: #fff; font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; z-index: 1;">${nomor}</div>
            <div class="card-row-between-start">
              <div>
                <div class="info-row">
                  <span class="fw-700 text-primary">${escapeHtml(item.customer || 'Tanpa Nama')}</span>
                  ${item.scheduleId ? `
                    <span class="tx-id-label">TX ID:</span>
                    <span onclick="copyToClipboard('${item.scheduleId}')" class="tx-id-badge" title="Klik untuk copy ID" class="fs-75">${item.scheduleId}</span>
                  ` : ''}
                </div>
                ${item.phone ? `<div class="fs-8 text-muted mt-2">📞 ${item.phone}</div>` : ''}
              </div>
              <span style="font-size: 0.75rem; padding: 5px 10px; border-radius: 6px; background: ${badge.badgeBg}; color: ${badge.color}; font-weight: 600; white-space: nowrap; border: 1px solid ${badge.badgeBg};">${badge.text}</span>
            </div>
            <div class="text-85 text-muted mb-2px">
              ${formattedDate}
            </div>
            <div class="fs-85 text-primary fw-600 mb-6">
              ${formattedTime}
            </div>
            ${item.unitName ? `<div class="label-xs-muted" class="mb-4">🎮 ${escapeHtml(item.unitName)}</div>` : ''}
            ${item.note ? `<div class="fs-8 text-muted italic mt-4">💬 ${escapeHtml(item.note)}</div>` : ''}
            <div style="font-size: 0.75rem; color: var(--ps3-green-dark); margin-top: 6px; padding: 4px 8px; background: rgba(34, 197, 94, 0.1); border-radius: 4px; border: 1px solid rgba(34, 197, 94, 0.3);">
              ✅ Diselesaikan: Transaksi tercatat otomatis
            </div>
          </div>
        `;
      }).join('');

      historyList.innerHTML = html;
    }

    // ─── Trash Schedule Filter Functions ───
    function toggleTrashScheduleFilters() {
      const panel = document.getElementById('trashScheduleFilterPanel');
      const isVisible = panel.style.display === 'block';
      panel.style.display = isVisible ? 'none' : 'block';
    }

    function debouncedSearchTrashSchedule() {
      if (trashScheduleSearchDebounceTimer) {
        clearTimeout(trashScheduleSearchDebounceTimer);
      }
      trashScheduleSearchDebounceTimer = setTimeout(() => {
        searchTrashSchedule();
      }, 300);
    }

    function updateTrashScheduleSearchStateFromUI() {
      trashScheduleSearchState.search = document.getElementById('trashScheduleSearchInput').value.trim();
      trashScheduleSearchState.customer = document.getElementById('trashScheduleFilterCustomer').value.trim();
      trashScheduleSearchState.unit = document.getElementById('trashScheduleFilterUnit').value.trim();
      trashScheduleSearchState.startDateFrom = document.getElementById('trashScheduleFilterStartDateFrom').value;
      trashScheduleSearchState.startDateTo = document.getElementById('trashScheduleFilterStartDateTo').value;
      trashScheduleSearchState.endDateFrom = document.getElementById('trashScheduleFilterEndDateFrom').value;
      trashScheduleSearchState.endDateTo = document.getElementById('trashScheduleFilterEndDateTo').value;
      trashScheduleSearchState.startTimeFrom = document.getElementById('trashScheduleFilterStartTimeFrom').value;
      trashScheduleSearchState.startTimeTo = document.getElementById('trashScheduleFilterStartTimeTo').value;
      trashScheduleSearchState.durationMin = document.getElementById('trashScheduleFilterDurationMin').value;
      trashScheduleSearchState.durationMax = document.getElementById('trashScheduleFilterDurationMax').value;
      trashScheduleSearchState.note = document.getElementById('trashScheduleFilterNote').value.trim();
      trashScheduleSearchState.reason = document.getElementById('trashScheduleFilterReason').value.trim();
    }

    function countActiveTrashScheduleFilters() {
      let count = 0;
      if (trashScheduleSearchState.customer) count++;
      if (trashScheduleSearchState.unit) count++;
      if (trashScheduleSearchState.startDateFrom || trashScheduleSearchState.startDateTo) count++;
      if (trashScheduleSearchState.endDateFrom || trashScheduleSearchState.endDateTo) count++;
      if (trashScheduleSearchState.startTimeFrom || trashScheduleSearchState.startTimeTo) count++;
      if (trashScheduleSearchState.durationMin || trashScheduleSearchState.durationMax) count++;
      if (trashScheduleSearchState.note) count++;
      if (trashScheduleSearchState.reason) count++;
      return count;
    }

    function updateTrashScheduleFilterBadge() {
      const count = countActiveTrashScheduleFilters();
      const badge = document.getElementById('trashScheduleActiveFilterCount');
      if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
      }
    }

    function clearAllTrashScheduleFilters() {
      trashScheduleSearchState = {
        search: '',
        customer: '',
        unit: '',
        startDateFrom: '',
        startDateTo: '',
        endDateFrom: '',
        endDateTo: '',
        startTimeFrom: '',
        startTimeTo: '',
        durationMin: '',
        durationMax: '',
        note: '',
        reason: ''
      };
      // Clear UI
      document.getElementById('trashScheduleSearchInput').value = '';
      document.getElementById('trashScheduleFilterCustomer').value = '';
      document.getElementById('trashScheduleFilterUnit').value = '';
      document.getElementById('trashScheduleFilterStartDateFrom').value = '';
      document.getElementById('trashScheduleFilterStartDateTo').value = '';
      document.getElementById('trashScheduleFilterEndDateFrom').value = '';
      document.getElementById('trashScheduleFilterEndDateTo').value = '';
      document.getElementById('trashScheduleFilterStartTimeFrom').value = '';
      document.getElementById('trashScheduleFilterStartTimeTo').value = '';
      document.getElementById('trashScheduleFilterDurationMin').value = '';
      document.getElementById('trashScheduleFilterDurationMax').value = '';
      document.getElementById('trashScheduleFilterNote').value = '';
      document.getElementById('trashScheduleFilterReason').value = '';
      document.getElementById('trashScheduleFilterPanel').style.display = 'none';
      updateTrashScheduleFilterBadge();
      searchTrashSchedule();
    }

    function filterTrashScheduleData(data) {
      return data.filter(item => {
        // Search by TX ID
        if (trashScheduleSearchState.search) {
          const searchLower = trashScheduleSearchState.search.toLowerCase();
          const idMatch = (item.scheduleId || '').toLowerCase().includes(searchLower);
          if (!idMatch) return false;
        }

        // Customer filter
        if (trashScheduleSearchState.customer) {
          const customerLower = trashScheduleSearchState.customer.toLowerCase();
          if (!(item.customer || '').toLowerCase().includes(customerLower)) return false;
        }

        // Unit filter
        if (trashScheduleSearchState.unit) {
          const unitLower = trashScheduleSearchState.unit.toLowerCase();
          const unitName = (item.unitName || '').toLowerCase();
          if (!unitName.includes(unitLower)) return false;
        }

        // Start Date range
        if (trashScheduleSearchState.startDateFrom && item.scheduledDate < trashScheduleSearchState.startDateFrom) return false;
        if (trashScheduleSearchState.startDateTo && item.scheduledDate > trashScheduleSearchState.startDateTo) return false;

        // End Date range
        if (trashScheduleSearchState.endDateFrom && item.scheduledEndDate && item.scheduledEndDate < trashScheduleSearchState.endDateFrom) return false;
        if (trashScheduleSearchState.endDateTo && item.scheduledEndDate && item.scheduledEndDate > trashScheduleSearchState.endDateTo) return false;

        // Start Time range
        if (trashScheduleSearchState.startTimeFrom && item.scheduledTime < trashScheduleSearchState.startTimeFrom) return false;
        if (trashScheduleSearchState.startTimeTo && item.scheduledTime > trashScheduleSearchState.startTimeTo) return false;

        // Duration range
        const duration = parseInt(item.duration) || 0;
        if (trashScheduleSearchState.durationMin && duration < parseInt(trashScheduleSearchState.durationMin)) return false;
        if (trashScheduleSearchState.durationMax && duration > parseInt(trashScheduleSearchState.durationMax)) return false;

        // Note filter
        if (trashScheduleSearchState.note) {
          const noteLower = trashScheduleSearchState.note.toLowerCase();
          if (!(item.note || '').toLowerCase().includes(noteLower)) return false;
        }

        // Reason filter
        if (trashScheduleSearchState.reason) {
          const reasonLower = trashScheduleSearchState.reason.toLowerCase();
          if (!(item.deleteReason || '').toLowerCase().includes(reasonLower)) return false;
        }

        return true;
      });
    }

    function searchTrashSchedule() {
      updateTrashScheduleSearchStateFromUI();
      updateTrashScheduleFilterBadge();

      const filtered = filterTrashScheduleData(cachedTrashScheduleData);

      // Sort by deletedAt descending
      filtered.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

      renderTrashScheduleList(filtered);

      // Update results text
      const resultsText = document.getElementById('trashScheduleSearchResults');
      if (resultsText) {
        if (trashScheduleSearchState.search || countActiveTrashScheduleFilters() > 0) {
          resultsText.textContent = `${filtered.length} hasil`;
        } else {
          resultsText.textContent = `${filtered.length} jadwal`;
        }
      }
    }

    function renderTrashScheduleList(data) {
      const trashList = document.getElementById('trashList');

      if (!data || data.length === 0) {
        trashList.innerHTML = '<p class="empty-state-p30">🗑️ Tidak ada jadwal yang cocok dengan filter</p>';
        return;
      }

      const html = data.map((item, index) => {
        const nomor = index + 1;
        const deletedDate = item.deletedAt ? new Date(item.deletedAt).toLocaleDateString('id-ID') : '-';

        const fakeSchedule = {
          scheduledDate: item.scheduledDate,
          scheduledTime: item.scheduledTime,
          duration: item.duration,
          scheduledEndDate: item.scheduledEndDate,
          scheduledEndTime: item.scheduledEndTime
        };

        const formattedDate = formatScheduleDate(fakeSchedule);
        const formattedTime = formatScheduleTime(fakeSchedule);

        return `
          <div style="background: rgba(139, 0, 0, 0.1); border: 2px solid #8B0000; border-radius: 10px; padding: 12px; margin-bottom: 10px; position: relative;">
            <div style="position: absolute; top: -8px; left: 10px; background: #8B0000; color: #fff; font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; z-index: 1;">${nomor}</div>
            <div class="card-row-between-start">
              <div>
                <div class="info-row">
                  <span class="fw-700 text-primary">${escapeHtml(item.customer || 'Tanpa Nama')}</span>
                  ${item.scheduleId ? `
                    <span class="tx-id-label">TX ID:</span>
                    <span onclick="copyToClipboard('${item.scheduleId}')" class="tx-id-badge" title="Klik untuk copy ID" class="fs-75">${item.scheduleId}</span>
                  ` : ''}
                </div>
                ${item.phone ? `<div class="fs-8 text-muted mt-2">📞 ${item.phone}</div>` : ''}
              </div>
              <span style="font-size: 0.75rem; padding: 5px 10px; border-radius: 6px; background: #8B0000; color: #fff; font-weight: 600; white-space: nowrap;">🗑️ Dibatalkan</span>
            </div>
            <div class="text-85 text-muted mb-2px">
              ${formattedDate}
            </div>
            <div class="fs-85 text-primary fw-600 mb-6">
              ${formattedTime}
            </div>
            ${item.unitName ? `<div class="label-xs-muted" class="mb-4">🎮 ${escapeHtml(item.unitName)}</div>` : ''}
            ${item.note ? `<div class="fs-8 text-muted italic mt-4">💬 ${escapeHtml(item.note)}</div>` : ''}
            <div style="font-size: 0.75rem; color: var(--ps3-red); margin-top: 6px; padding: 4px 8px; background: rgba(230, 0, 18, 0.1); border-radius: 4px; border: 1px solid rgba(230, 0, 18, 0.3);">
              🗑️ Dibatalkan: ${deletedDate}${item.deleteReason ? ` - ${escapeHtml(item.deleteReason)}` : ''}
            </div>
          </div>
        `;
      }).join('');

      trashList.innerHTML = html;
    }

    // Tempat Sampah (Trash) Modal Functions
    function openTrashModal() {
      loadDeletedSchedules();
      openModal('modalTrash');
    }

    // Riwayat (History) Modal Functions - Completed Schedules
    function openHistoryModal() {
      loadCompletedSchedules();
      openModal('modalHistory');
    }

    async function loadCompletedSchedules() {
      const historyList = document.getElementById('historyList');
      historyList.innerHTML = '<p class="empty-state-p30">⏳ Memuat data...</p>';

      try {
        const data = await api('GET', '/schedules/completed');

        if (!data.completed || data.completed.length === 0) {
          cachedHistoryData = [];
          historyList.innerHTML = '<p class="empty-state-p30">📜 Belum ada jadwal yang selesai</p>';
          return;
        }

        // Cache data and apply client-side filtering
        cachedHistoryData = data.completed;
        searchHistory();
      } catch (error) {
        console.error('Error loading completed schedules:', error);
        historyList.innerHTML = `<p style="text-align: center; color: var(--ps3-red); padding: 30px;">❌ Error: ${escapeHtml(error.message)}</p>`;
      }
    }

    function getHistoryScheduleStatusBadge(status) {
      // Warna hijau untuk semua completed schedules di riwayat
      return {
        text: '✅ Selesai',
        // Card highlight: hijau transparan
        bg: 'rgba(34, 197, 94, 0.15)',
        border: 'var(--ps3-green)',
        // Badge: hijau tua
        badgeBg: 'var(--ps3-green-dark)',
        color: '#fff'
      };
    }

    async function loadDeletedSchedules() {
      const trashList = document.getElementById('trashList');
      trashList.innerHTML = '<p class="empty-state-p30">⏳ Memuat data...</p>';

      try {
        const data = await api('GET', '/schedules/deleted');

        if (!data.deleted || data.deleted.length === 0) {
          cachedTrashScheduleData = [];
          trashList.innerHTML = '<p class="empty-state-p30">🗑️ Belum ada data yang dihapus</p>';
          return;
        }

        // Map API data to consistent format
        cachedTrashScheduleData = data.deleted.map(item => ({
          ...item,
          scheduleId: item.originalId || item.scheduleId
        }));

        // Apply client-side filtering
        searchTrashSchedule();
      } catch (error) {
        console.error('Error loading deleted schedules:', error);
        trashList.innerHTML = `<p style="text-align: center; color: var(--ps3-red); padding: 30px;">❌ Error: ${escapeHtml(error.message)}</p>`;
      }
    }

    function getDeletedScheduleStatusBadge(status) {
      // Konsisten dengan getScheduleStatusBadge di daftar jadwal - pakai bahasa Indonesia
      // Warna card (highlight) mengikuti getScheduleHighlight, warna badge mengikuti getScheduleStatusBadge
      const styles = {
        'pending': {
          text: '⏳ Menunggu',
          // Card highlight: putih/transparan seperti daftar jadwal
          cardBg: 'var(--ps3-surface)',
          cardBorder: 'var(--ps3-border)',
          // Badge: kuning
          badgeBg: 'var(--ps3-yellow)',
          badgeColor: '#000'
        },
        'running': {
          text: '🔥 Berjalan',
          // Card highlight: hijau transparan
          cardBg: 'rgba(74, 222, 128, 0.15)',
          cardBorder: 'var(--ps3-green)',
          // Badge: hijau
          badgeBg: 'var(--ps3-green)',
          badgeColor: '#000'
        },
        'completed': {
          text: '✅ Selesai',
          // Card highlight: abu-abu transparan
          cardBg: 'rgba(128, 128, 128, 0.2)',
          cardBorder: '#888',
          // Badge: hijau tua
          badgeBg: 'var(--ps3-green-dark)',
          badgeColor: '#fff'
        },
        'cancelled': {
          text: '❌ Dibatalkan',
          // Card highlight: merah transparan
          cardBg: 'rgba(220, 38, 38, 0.15)',
          cardBorder: 'var(--ps3-red-badge)',
          // Badge: merah
          badgeBg: 'var(--ps3-red-badge)',
          badgeColor: '#fff'
        },
        'deleted': {
          text: '🗑️ Dihapus',
          // Card highlight: merah transparan
          cardBg: 'rgba(220, 38, 38, 0.15)',
          cardBorder: 'var(--ps3-red-badge)',
          // Badge: merah
          badgeBg: 'var(--ps3-red-badge)',
          badgeColor: '#fff'
        }
      };

      const style = styles[status] || {
        cardBg: 'var(--ps3-surface)',
        cardBorder: 'var(--ps3-border)',
        badgeBg: 'var(--ps3-surface)',
        badgeColor: 'var(--ps3-muted)'
      };

      return {
        text: style.text || status,
        // Untuk card background/border (highlight)
        bg: style.cardBg,
        border: style.cardBorder,
        // Untuk badge background/color
        color: style.badgeColor,
        badgeBg: style.badgeBg
      };
    }

    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function formatDateTimeWIB(timestamp) {
      if (!timestamp) return '-';
      const date = new Date(parseInt(timestamp));
      return date.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) + ' WIB';
    }

    // Format ISO string date (for trash items with deletedAt)
    function formatTrashDateTime(isoString) {
      if (!isoString) return '-';
      const date = new Date(isoString); // ISO string can be parsed directly
      if (isNaN(date.getTime())) return '-';
      return date.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) + ' WIB';
    }

    // ═════════════════ Transaction Edit Functions ═════════════════
    let currentEditTransactionId = null;

    async function openEditModal(transactionId) {
      // Mobile-friendly debug - show toast immediately
      showToast('Membuka edit... ID: ' + transactionId, 'info');

      currentEditTransactionId = transactionId;

      // Check if transactions array is loaded
      if (!transactions || transactions.length === 0) {
        showToast('Data transaksi belum dimuat. Tunggu sebentar...', 'error');
        return;
      }

      // Use loose equality to handle string/number type mismatch
      const transaction = transactions.find(t => t.id == transactionId);
      if (!transaction) {
        showToast('Transaksi tidak ditemukan (ID: ' + transactionId + '). Total transaksi: ' + transactions.length, 'error');
        return;
      }

      // Reset steps
      document.getElementById('editStep1').style.display = 'block';
      document.getElementById('editStep2').style.display = 'none';
      document.getElementById('editStep3').style.display = 'none';

      // Reset checkboxes
      document.getElementById('editCheckCustomer').checked = false;
      document.getElementById('editCheckPhone').checked = false;
      document.getElementById('editCheckDateTime').checked = false;
      document.getElementById('editCheckDuration').checked = false;
      document.getElementById('editCheckUnit').checked = false;
      document.getElementById('editCheckPaid').checked = false;
      document.getElementById('editCheckPayment').checked = false;
      document.getElementById('editCheckNote').checked = false;

      // Pre-fill current values (hidden until step 2)
      document.getElementById('editCustomer').value = transaction.customer || '';
      document.getElementById('editPhone').value = transaction.phone || '';
      document.getElementById('editPaid').value = transaction.paid || transaction.total || 0;
      document.getElementById('editDuration').value = transaction.duration || 0;
      document.getElementById('editPayment').value = transaction.payment || 'cash';
      document.getElementById('editNote').value = transaction.note || '';
      document.getElementById('editReason').value = '';

      // Pre-fill date/time fields from timestamp
      const txDate = transaction.timestamp ? new Date(transaction.timestamp) : new Date();
      const dateStr = txDate.toISOString().split('T')[0];
      const timeStr = txDate.toTimeString().slice(0, 5);

      document.getElementById('editStartDate').value = dateStr;
      document.getElementById('editStartTime').value = timeStr;
      document.getElementById('editDurationTime').value = transaction.duration || 60;

      // Calculate and set end time
      editTxUpdateEndTime();

      // Populate station dropdown
      const stationSelect = document.getElementById('editUnitId');
      stationSelect.innerHTML = '<option value="">Pilih Stasiun</option>';
      
      // Load stations if not loaded
      if (stations.length === 0) {
        try {
          stations = await api('GET', '/pairings');
        } catch (error) {
          console.error('Failed to load stations:', error);
        }
      }
      
      if (stations && stations.length > 0) {
        stations.forEach(station => {
          const option = document.createElement('option');
          option.value = station.id;
          option.textContent = station.name;
          if (station.id == transaction.unitId) {
            option.selected = true;
          }
          stationSelect.appendChild(option);
        });
      }

      // Load edit history
      loadEditHistory(transactionId);

      openModal('modalEditTransaction', true);
    }

    function proceedToEditStep2() {
      const fields = [
        'editCheckCustomer',
        'editCheckPhone',
        'editCheckDateTime',
        'editCheckDuration',
        'editCheckUnit',
        'editCheckPaid',
        'editCheckPayment',
        'editCheckNote'
      ];

      const anySelected = fields.some(id => document.getElementById(id).checked);
      if (!anySelected) {
        showToast('Pilih minimal 1 data yang ingin diedit', 'error');
        return;
      }

      // Hide/show fields based on selection
      document.getElementById('editFieldCustomer').style.display =
        document.getElementById('editCheckCustomer').checked ? 'block' : 'none';
      document.getElementById('editFieldPhone').style.display =
        document.getElementById('editCheckPhone').checked ? 'block' : 'none';
      document.getElementById('editFieldDateTime').style.display =
        document.getElementById('editCheckDateTime').checked ? 'block' : 'none';
      document.getElementById('editFieldDuration').style.display =
        document.getElementById('editCheckDuration').checked ? 'block' : 'none';
      document.getElementById('editFieldUnit').style.display =
        document.getElementById('editCheckUnit').checked ? 'block' : 'none';
      document.getElementById('editFieldPaid').style.display =
        document.getElementById('editCheckPaid').checked ? 'block' : 'none';
      document.getElementById('editFieldPayment').style.display =
        document.getElementById('editCheckPayment').checked ? 'block' : 'none';
      document.getElementById('editFieldNote').style.display =
        document.getElementById('editCheckNote').checked ? 'block' : 'none';

      document.getElementById('editStep1').style.display = 'none';
      document.getElementById('editStep2').style.display = 'block';
    }

    function backToEditStep1() {
      document.getElementById('editStep1').style.display = 'block';
      document.getElementById('editStep2').style.display = 'none';
    }

    // ═════════════════ Transaction Edit Date/Time Helpers ═════════════════

    function editTxInitDefaultEndDate() {
      // Set default end date to match start date when start date changes
      const startDate = document.getElementById('editStartDate').value;
      if (startDate) {
        editTxUpdateEndTime();
      }
    }

    function editTxUpdateEndTime() {
      const startDate = document.getElementById('editStartDate').value;
      const startTime = document.getElementById('editStartTime').value;
      const duration = parseInt(document.getElementById('editDurationTime').value) || 60;

      if (!startDate || !startTime) return;

      // Calculate end time
      const startDateTime = new Date(`${startDate}T${startTime}:00`);
      const endDateTime = new Date(startDateTime.getTime() + duration * 60000);

      // Format end time for input (HH:MM)
      const endHours = String(endDateTime.getHours()).padStart(2, '0');
      const endMinutes = String(endDateTime.getMinutes()).padStart(2, '0');
      document.getElementById('editEndTime').value = `${endHours}:${endMinutes}`;
    }

    function editTxSetDuration(minutes) {
      document.getElementById('editDurationTime').value = minutes;
      editTxUpdateEndTime();
    }

    async function saveTransactionEdit() {
      const reason = document.getElementById('editReason').value.trim();
      if (!reason) {
        showToast('Alasan edit wajib diisi', 'error');
        return;
      }

      const updates = {};

      if (document.getElementById('editCheckCustomer').checked) {
        updates.customer = document.getElementById('editCustomer').value.trim();
      }
      if (document.getElementById('editCheckPhone').checked) {
        updates.phone = document.getElementById('editPhone').value.trim();
      }
      if (document.getElementById('editCheckDateTime').checked) {
        const startDate = document.getElementById('editStartDate').value;
        const startTime = document.getElementById('editStartTime').value;
        const duration = parseInt(document.getElementById('editDurationTime').value) || 60;

        // Convert to timestamp (milliseconds)
        const dateTimeStr = `${startDate}T${startTime}:00`;
        const timestamp = new Date(dateTimeStr).getTime();

        updates.timestamp = timestamp;
        updates.duration = duration;

        // Calculate startTime and endTime
        const startDateTime = new Date(dateTimeStr);
        const endDateTime = new Date(startDateTime.getTime() + duration * 60000);

        updates.startTime = startDateTime.getTime();
        updates.endTime = endDateTime.getTime();
      }
      if (document.getElementById('editCheckDuration').checked) {
        updates.duration = parseInt(document.getElementById('editDuration').value) || 0;
      }
      if (document.getElementById('editCheckUnit').checked) {
        const stationId = document.getElementById('editUnitId').value;
        if (stationId) {
          updates.unitId = stationId;
        }
      }
      if (document.getElementById('editCheckPaid').checked) {
        updates.paid = parseInt(document.getElementById('editPaid').value) || 0;
      }
      if (document.getElementById('editCheckPayment').checked) {
        updates.payment = document.getElementById('editPayment').value;
      }
      if (document.getElementById('editCheckNote').checked) {
        updates.note = document.getElementById('editNote').value.trim();
      }

      if (Object.keys(updates).length === 0) {
        showToast('Tidak ada perubahan untuk disimpan', 'error');
        return;
      }

      try {
        const response = await api('PUT', `/transactions/${currentEditTransactionId}`, {
          updates,
          reason,
          editedBy: 'admin'
        });

        if (response.ok) {
          showToast(`Transaksi diperbarui (${response.changes} perubahan)`, 'success');

          // Show history after successful edit
          document.getElementById('editStep2').style.display = 'none';
          document.getElementById('editStep3').style.display = 'block';
          await loadEditHistory(currentEditTransactionId);

          // Refresh data
          await loadData();
          renderReports();
        } else {
          showToast(response.error || 'Gagal mengupdate transaksi', 'error');
        }
      } catch (error) {
        showToast(error.message || 'Terjadi kesalahan', 'error');
      }
    }

    async function loadEditHistory(transactionId) {
      try {
        const response = await api('GET', `/transactions/${transactionId}/edits`);
        const container = document.getElementById('editHistoryList');

        if (!response.ok || !response.logs || response.logs.length === 0) {
          container.innerHTML = `
            <div class="empty-state-p20">
              <div class="fs-2 mb-10">📝</div>
              <div>Belum ada riwayat edit untuk transaksi ini</div>
            </div>
          `;
          return;
        }

        const fieldLabels = {
          'customer': 'Nama Penyewa',
          'phone': 'Nomor Telepon',
          'timestamp': 'Waktu Transaksi',
          'startTime': 'Waktu Mulai',
          'endTime': 'Waktu Selesai',
          'paid': 'Jumlah Pendapatan',
          'duration': 'Durasi',
          'unitId': 'Unit ID',
          'unitName': 'Nama Unit',
          'payment': 'Metode Pembayaran',
          'note': 'Catatan'
        };

        container.innerHTML = response.logs.map(log => {
          const fieldName = fieldLabels[log.fieldName] || log.fieldName;
          const editedAtWIB = new Date(log.editedAt + (7 * 60 * 60 * 1000));
          const dateStr = editedAtWIB.toLocaleString('id-ID', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'UTC'
          });

          let oldValue = log.oldValue;
          let newValue = log.newValue;

          // Format currency for paid field
          if (log.fieldName === 'paid') {
            oldValue = formatMoney(parseInt(oldValue) || 0);
            newValue = formatMoney(parseInt(newValue) || 0);
          }
          // Format duration with minutes
          else if (log.fieldName === 'duration') {
            oldValue = oldValue + ' menit';
            newValue = newValue + ' menit';
          }
          // Format timestamp fields as readable dates
          else if (['timestamp', 'startTime', 'endTime'].includes(log.fieldName)) {
            const tsOld = parseInt(oldValue);
            const tsNew = parseInt(newValue);
            if (!isNaN(tsOld) && tsOld > 0) {
              const dOld = new Date(tsOld);
              oldValue = `${dOld.toLocaleDateString('id-ID')} ${String(dOld.getHours()).padStart(2,'0')}:${String(dOld.getMinutes()).padStart(2,'0')}`;
            }
            if (!isNaN(tsNew) && tsNew > 0) {
              const dNew = new Date(tsNew);
              newValue = `${dNew.toLocaleDateString('id-ID')} ${String(dNew.getHours()).padStart(2,'0')}:${String(dNew.getMinutes()).padStart(2,'0')}`;
            }
          }

          return `
            <div style="border-left: 3px solid var(--ps3-red); padding: 12px; margin-bottom: 12px; background: rgba(255,255,255,0.05); border-radius: 0 10px 10px 0;">
              <div class="text-8 text-muted mb-6">
                ${dateStr} • oleh ${log.editedBy || 'admin'}
              </div>
              <div class="fw-600 mb-4 text-primary">
                ${fieldName}
              </div>
              <div style="display: flex; align-items: center; gap: 8px; font-size: 0.9rem;">
                <span class="strike text-red">${oldValue || '(kosong)'}</span>
                <span class="text-muted">→</span>
                <span style="color: var(--ps3-green); font-weight: 500;">${newValue || '(kosong)'}</span>
              </div>
              ${log.editReason ? `<div style="font-size: 0.8rem; color: var(--ps3-muted); margin-top: 6px; font-style: italic;">💬 ${log.editReason}</div>` : ''}
            </div>
          `;
        }).join('');
      } catch (error) {
        document.getElementById('editHistoryList').innerHTML = `
          <div class="empty-state-p20">
            Gagal memuat riwayat edit
          </div>
        `;
      }
    }

    // View edit history from transaction list
    async function viewEditHistory(transactionId, customerName, unitName) {
      if (!transactionId) {
        showToast('ID transaksi tidak valid', 'error');
        return;
      }

      currentEditTransactionId = transactionId;

      // Show history modal
      document.querySelector('#modalEditTransaction .modal-title').textContent = `📋 Riwayat: ${unitName} - ${customerName}`;
      document.getElementById('editStep1').style.display = 'none';
      document.getElementById('editStep2').style.display = 'none';
      document.getElementById('editStep3').style.display = 'block';

      // Reset to edit logs tab by default
      document.getElementById('btnShowEditLogs').style.background = 'var(--ps3-red)';
      document.getElementById('btnShowEditLogs').style.opacity = '1';

      openModal('modalEditTransaction', true);

      // Load history
      await loadEditHistory(transactionId);
    }

    // ═════════════════ Transaction Delete Functions ═════════════════
    let currentDeleteTxId = null;

    function openDeleteTransactionModal(txId, customerName, unitName) {
      if (!txId) {
        showToast('ID transaksi tidak valid', 'error');
        return;
      }

      currentDeleteTxId = txId;
      const tx = transactions.find(t => t.id === txId);

      // Populate transaction info
      document.getElementById('deleteTxInfo').innerHTML = `
        <div class="flex-between-mb8">
          <span class="text-muted">Unit:</span>
          <span class="fw-600">${unitName || 'Unknown'}</span>
        </div>
        <div class="flex-between-mb8">
          <span class="text-muted">Penyewa:</span>
          <span class="fw-600">${customerName || 'Unknown'}</span>
        </div>
        <div class="flex-between-mb8">
          <span class="text-muted">Jumlah:</span>
          <span class="fw-600 text-green">${tx ? formatMoney(tx.paid) : '-'}</span>
        </div>
        <div class="flex-between">
          <span class="text-muted">TX ID:</span>
          <span style="font-family: monospace; font-size: 0.8rem;">${txId}</span>
        </div>
      `;

      // Reset form
      document.getElementById('deleteConfirmCheckbox').checked = false;
      document.getElementById('deleteReason').value = '';
      updateDeleteButtonState();

      // Add listeners
      document.getElementById('deleteConfirmCheckbox').addEventListener('change', updateDeleteButtonState);
      document.getElementById('deleteReason').addEventListener('input', updateDeleteButtonState);

      openModal('modalDeleteTransaction', true);
    }

    function updateDeleteButtonState() {
      const checkbox = document.getElementById('deleteConfirmCheckbox');
      const reason = document.getElementById('deleteReason').value.trim();
      const btn = document.getElementById('deleteTxBtn');

      if (checkbox.checked && reason.length >= 3) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
      } else {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
      }
    }

    async function confirmDeleteTransaction() {
      if (!currentDeleteTxId) {
        showToast('ID transaksi tidak valid', 'error');
        return;
      }

      const reason = document.getElementById('deleteReason').value.trim();
      if (!reason || reason.length < 3) {
        showToast('Alasan penghapusan wajib diisi (min. 3 karakter)', 'error');
        return;
      }

      try {
        // Cari transaksi yang akan dihapus
        const txIndex = transactions.findIndex(t => t.id === currentDeleteTxId);
        if (txIndex === -1) {
          throw new Error('Transaksi tidak ditemukan');
        }

        const deletedTx = transactions[txIndex];

        // Simpan ke tempat sampah dengan metadata penghapusan
        const trashItem = {
          ...deletedTx,
          deletedAt: new Date().toISOString(),
          deleteReason: reason,
          deletedBy: 'admin'
        };

        // Tambahkan ke awal array deletedTransactions
        deletedTransactions.unshift(trashItem);

        // Hapus dari array transactions
        transactions.splice(txIndex, 1);

        // Panggil API untuk persistensi ke server
        const res = await api('DELETE', `/transactions/${currentDeleteTxId}`, { reason, deletedBy: 'admin' });

        if (!res.ok) {
          // Jika API gagal, rollback perubahan lokal
          deletedTransactions.shift();
          transactions.splice(txIndex, 0, deletedTx);
          throw new Error(res.error || 'Gagal menghapus transaksi');
        }

        showToast('Transaksi berhasil dipindahkan ke tempat sampah', 'success');
        closeModal('modalDeleteTransaction');

        // Clear trash cache so it will be re-fetched with the new item
        cachedTrashTransactions = [];

        // Refresh tampilan laporan
        renderReports();
      } catch (error) {
        showToast('Gagal menghapus: ' + error.message, 'error');
      }
    }

    // ═════════════════ Trash Income Functions ═════════════════
    // Search state for trash income
    let trashSearchState = {
      search: '',
      customer: '',
      unit: '',
      payment: '',
      amountMin: '',
      amountMax: '',
      dateFrom: '',
      dateTo: '',
      note: '',
      sortBy: 'date',
      sortOrder: 'desc'
    };
    let trashSearchDebounceTimer = null;
    let cachedTrashTransactions = [];
    let uniqueTrashCustomers = [];
    let uniqueTrashUnits = [];

    function openTrashIncomeModal() {
      // Reset search state
      trashSearchState = {
        search: '',
        customer: '',
        unit: '',
        payment: '',
        amountMin: '',
        amountMax: '',
        dateFrom: '',
        dateTo: '',
        note: '',
        sortBy: 'date',
        sortOrder: 'desc'
      };

      // Setup autocomplete data
      setupTrashAutocomplete();

      // Sync UI
      syncTrashSearchUI();

      // Load and render data
      renderTrashIncomeList();
      openModal('modalTrashIncome');
    }

    // Setup autocomplete data from cached trash transactions
    function setupTrashAutocomplete() {
      uniqueTrashCustomers = [...new Set(cachedTrashTransactions.map(log => log.recordData?.customer).filter(Boolean))].sort();
      uniqueTrashUnits = [...new Set(cachedTrashTransactions.map(log => log.recordData?.unitName || log.recordData?.station_name).filter(Boolean))].sort();
    }

    // Sync UI with search state
    function syncTrashSearchUI() {
      document.getElementById('trashSearchInput').value = trashSearchState.search;
      document.getElementById('trashFilterCustomer').value = trashSearchState.customer;
      document.getElementById('trashFilterUnit').value = trashSearchState.unit;
      document.getElementById('trashFilterPayment').value = trashSearchState.payment;
      document.getElementById('trashFilterAmountMin').value = trashSearchState.amountMin;
      document.getElementById('trashFilterAmountMax').value = trashSearchState.amountMax;
      document.getElementById('trashFilterDateFrom').value = trashSearchState.dateFrom;
      document.getElementById('trashFilterDateTo').value = trashSearchState.dateTo;
      document.getElementById('trashFilterNote').value = trashSearchState.note;
      document.getElementById('trashSortBy').value = trashSearchState.sortBy;
      document.getElementById('trashSortOrder').value = trashSearchState.sortOrder;
    }

    // Update state from UI
    function updateTrashSearchStateFromUI() {
      trashSearchState.search = document.getElementById('trashSearchInput').value.trim();
      trashSearchState.customer = document.getElementById('trashFilterCustomer').value.trim();
      trashSearchState.unit = document.getElementById('trashFilterUnit').value.trim();
      trashSearchState.payment = document.getElementById('trashFilterPayment').value;
      trashSearchState.amountMin = document.getElementById('trashFilterAmountMin').value;
      trashSearchState.amountMax = document.getElementById('trashFilterAmountMax').value;
      trashSearchState.dateFrom = document.getElementById('trashFilterDateFrom').value;
      trashSearchState.dateTo = document.getElementById('trashFilterDateTo').value;
      trashSearchState.note = document.getElementById('trashFilterNote').value.trim();
      trashSearchState.sortBy = document.getElementById('trashSortBy').value;
      trashSearchState.sortOrder = document.getElementById('trashSortOrder').value;
    }

    // Toggle filter panel
    function toggleTrashFilters() {
      const panel = document.getElementById('trashFilterPanel');
      const isVisible = panel.style.display === 'block';
      panel.style.display = isVisible ? 'none' : 'block';
    }

    // Update active filter badge
    function updateTrashFilterBadge() {
      const activeFilters = [
        trashSearchState.customer,
        trashSearchState.unit,
        trashSearchState.payment,
        trashSearchState.amountMin,
        trashSearchState.amountMax,
        trashSearchState.dateFrom,
        trashSearchState.dateTo,
        trashSearchState.note
      ].filter(v => v !== '' && v !== null && v !== undefined).length;

      const badge = document.getElementById('trashActiveFilterCount');
      if (activeFilters > 0) {
        badge.textContent = activeFilters;
        badge.style.display = 'inline';
      } else {
        badge.style.display = 'none';
      }
    }

    // Clear all filters
    function clearAllTrashFilters() {
      trashSearchState = {
        search: '',
        customer: '',
        unit: '',
        payment: '',
        amountMin: '',
        amountMax: '',
        dateFrom: '',
        dateTo: '',
        note: '',
        sortBy: 'date',
        sortOrder: 'desc'
      };
      syncTrashSearchUI();
      updateTrashFilterBadge();
      renderTrashIncomeList();
    }

    // Debounced search
    function debouncedSearchTrashIncome() {
      if (trashSearchDebounceTimer) {
        clearTimeout(trashSearchDebounceTimer);
      }
      trashSearchDebounceTimer = setTimeout(() => {
        updateTrashSearchStateFromUI();
        updateTrashFilterBadge();
        renderTrashIncomeList();
      }, 300);
    }

    // Main search function - filters cached data
    function searchTrashIncome() {
      updateTrashSearchStateFromUI();
      updateTrashFilterBadge();
      renderTrashIncomeList();
    }

    // Filter and render trash income list
    async function renderTrashIncomeList() {
      const container = document.getElementById('trashIncomeList');
      const emptyState = document.getElementById('trashIncomeEmpty');
      const countEl = document.getElementById('trashIncomeCount');
      const resultsText = document.getElementById('trashSearchResults');

      // Loading state
      container.innerHTML = '<p class="empty-state-p20">⏳ Memuat...</p>';

      try {
        // Ambil data dari server (deletion_logs) jika belum ada cached data
        if (cachedTrashTransactions.length === 0) {
          const res = await api('GET', '/deletion-logs?recordType=transaction&limit=200');
          if (!res.ok) {
            throw new Error(res.error || 'Gagal memuat data sampah');
          }
          cachedTrashTransactions = res.logs || [];
          setupTrashAutocomplete();
        }

        // Apply filters
        let filtered = [...cachedTrashTransactions];
        const t = trashSearchState;

        // Search by TX ID
        if (t.search) {
          const searchLower = t.search.toLowerCase();
          filtered = filtered.filter(log => {
            const data = log.recordData || {};
            return (data.id && data.id.toLowerCase().includes(searchLower));
          });
        }

        // Filter by customer
        if (t.customer) {
          const custLower = t.customer.toLowerCase();
          filtered = filtered.filter(log => {
            const customer = log.recordData?.customer || '';
            return customer.toLowerCase().includes(custLower);
          });
        }

        // Filter by unit
        if (t.unit) {
          const unitLower = t.unit.toLowerCase();
          filtered = filtered.filter(log => {
            const unitName = log.recordData?.unitName || log.recordData?.station_name || '';
            return unitName.toLowerCase().includes(unitLower);
          });
        }

        // Filter by payment method
        if (t.payment) {
          filtered = filtered.filter(log => (log.recordData?.payment || 'cash') === t.payment);
        }

        // Filter by amount range
        if (t.amountMin) {
          const min = parseFloat(t.amountMin);
          filtered = filtered.filter(log => (log.recordData?.paid || 0) >= min);
        }
        if (t.amountMax) {
          const max = parseFloat(t.amountMax);
          filtered = filtered.filter(log => (log.recordData?.paid || 0) <= max);
        }

        // Filter by original transaction date range
        if (t.dateFrom) {
          const fromDate = new Date(t.dateFrom);
          filtered = filtered.filter(log => {
            const txDate = new Date(log.recordData?.endTime || 0);
            return txDate >= fromDate;
          });
        }
        if (t.dateTo) {
          const toDate = new Date(t.dateTo);
          toDate.setHours(23, 59, 59, 999);
          filtered = filtered.filter(log => {
            const txDate = new Date(log.recordData?.endTime || 0);
            return txDate <= toDate;
          });
        }

        // Filter by note
        if (t.note) {
          const noteLower = t.note.toLowerCase();
          filtered = filtered.filter(log => {
            const note = log.recordData?.note || '';
            return note.toLowerCase().includes(noteLower);
          });
        }

        // Sort results
        filtered.sort((a, b) => {
          let valA, valB;
          const order = t.sortOrder === 'asc' ? 1 : -1;

          switch (t.sortBy) {
            case 'date':
              valA = new Date(a.deletedAt || 0).getTime();
              valB = new Date(b.deletedAt || 0).getTime();
              break;
            case 'originalDate':
              valA = new Date(a.recordData?.endTime || 0).getTime();
              valB = new Date(b.recordData?.endTime || 0).getTime();
              break;
            case 'amount':
              valA = a.recordData?.paid || 0;
              valB = b.recordData?.paid || 0;
              break;
            case 'customer':
              valA = (a.recordData?.customer || '').toLowerCase();
              valB = (b.recordData?.customer || '').toLowerCase();
              break;
            case 'unit':
              valA = (a.recordData?.unitName || a.recordData?.station_name || '').toLowerCase();
              valB = (b.recordData?.unitName || b.recordData?.station_name || '').toLowerCase();
              break;
            default:
              valA = new Date(a.deletedAt || 0).getTime();
              valB = new Date(b.deletedAt || 0).getTime();
          }

          if (valA < valB) return -1 * order;
          if (valA > valB) return 1 * order;
          return 0;
        });

        countEl.textContent = filtered.length;

        // Update results text
        if (resultsText) {
          const totalCached = cachedTrashTransactions.length;
          if (filtered.length !== totalCached) {
            resultsText.textContent = `${filtered.length} dari ${totalCached} transaksi`;
          } else {
            resultsText.textContent = `${filtered.length} transaksi`;
          }
        }

        if (filtered.length === 0) {
          container.innerHTML = '';
          emptyState.style.display = 'block';
          return;
        }

        emptyState.style.display = 'none';

        container.innerHTML = filtered.map((log, index) => {
          const t = log.recordData;
          const nomor = index + 1;
          return `
          <div style="background: rgba(230, 0, 18, 0.1); border: 2px solid var(--ps3-red); border-radius: 10px; padding: 14px; margin-bottom: 10px; position: relative;" data-log-id="${log.id}">
            <!-- Number Badge -->
            <div style="position: absolute; top: -8px; left: 10px; background: var(--ps3-red-dark, #8B0000); color: #fff; font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; z-index: 1;">${nomor}</div>

            <!-- Row 1: Date (left) + Amount (right) -->
            <div class="card-row-between">
              <div class="fs-9 text-muted fw-500">
                ${formatDateOnlyWIB(t.endTime)}
              </div>
              <div class="text-red fs-115 fw-600">
                ${formatMoney(t.paid)}
              </div>
            </div>

            <!-- Row 2: Unit Name -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: ${t.customer ? '6px' : '10px'};">
              <div class="fs-105 lh-14 flex-1 min-w-0 pr-10 text-primary">
                🎮 ${t.unitName || t.station_name || 'Unknown'}
              </div>
            </div>

            <!-- Row 3: Customer (left) + Note (right, if exists) -->
            ${t.customer || t.note ? `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.95rem; color: var(--ps3-text); margin-bottom: 10px; padding-left: 2px;">
              <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                ${t.customer ? `<span class="fs-1">👤</span><span>${t.customer}</span>` : ''}
              </div>
              ${t.note ? `<div style="text-align: right; font-style: italic; opacity: 0.8; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50%;">💬 ${t.note}</div>` : ''}
            </div>
            ` : ''}

            <!-- Row 4: Time | TX ID (centered) | Payment -->
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: var(--ps3-muted); padding-top: 8px; border-top: 1px solid var(--ps3-red); opacity: 0.85; margin-bottom: 12px;">
              <div class="info-row-compact">
                <span>🕐</span>
                <span>${formatTimeOnlyWIB(t.endTime)}</span>
              </div>
              <div class="tab-btn-group">
                <span class="tx-id-label">TX ID:</span>
                <span onclick="copyToClipboard('${t.id || ''}')" class="tx-id-badge" title="Klik untuk copy ID" class="fs-75">${t.id || ''}</span>
              </div>
              <div class="text-right flex-1">
                💳 ${t.payment || 'cash'}
              </div>
            </div>

            <!-- Deleted Info -->
            <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; margin-bottom: 12px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span class="text-75 text-muted">Dihapus:</span>
                <span style="font-size: 0.75rem; color: var(--ps3-red);">${formatTrashDateTime(log.deletedAt)}</span>
              </div>
              <div class="flex-between">
                <span class="text-75 text-muted">Alasan:</span>
                <span style="font-size: 0.75rem; color: var(--ps3-text);">${log.deleteReason || '-'}</span>
              </div>
            </div>

            <!-- Action Buttons: Kembalikan & Hapus Permanen -->
            <div class="flex-gap-8">
              <button onclick="restoreIncomeFromTrash(${log.id})" style="flex: 1; padding: 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; background: var(--ps3-green-dark); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                ♻️ Kembalikan
              </button>
              <button onclick="deleteIncomePermanently(${log.id}, '${log.recordId}')" style="flex: 1; padding: 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; background: var(--ps3-red); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                🗑️ Hapus
              </button>
            </div>
          </div>
          `;
        }).join('');
      } catch (error) {
        container.innerHTML = `<p style="text-align: center; color: var(--ps3-red); padding: 20px;">❌ Error: ${escapeHtml(error.message)}</p>`;
      }
    }

    // ═════════════════ Trash Customer Autocomplete ═════════════════
    let trashCustomerAutocompleteTimer = null;

    function onTrashCustomerInput() {
      showTrashCustomerSuggestions();
      if (trashCustomerAutocompleteTimer) {
        clearTimeout(trashCustomerAutocompleteTimer);
      }
      trashCustomerAutocompleteTimer = setTimeout(() => {
        updateTrashSearchStateFromUI();
        updateTrashFilterBadge();
        renderTrashIncomeList();
      }, 300);
    }

    function showTrashCustomerSuggestions() {
      const input = document.getElementById('trashFilterCustomer');
      const dropdown = document.getElementById('trashCustomerSuggestions');
      const value = input.value.trim().toLowerCase();

      const matches = value
        ? uniqueTrashCustomers.filter(c => c.toLowerCase().includes(value))
        : uniqueTrashCustomers.slice(0, 10);

      if (matches.length === 0) {
        dropdown.innerHTML = '<div class="suggestion-empty">Tidak ditemukan</div>';
      } else {
        dropdown.innerHTML = matches.map(customer => {
          const highlighted = value
            ? customer.replace(new RegExp(`(${escapeRegex(value)})`, 'gi'), '<mark>$1</mark>')
            : customer;
          return `<div class="suggestion-item" onclick="selectTrashCustomer('${escapeHtml(customer)}')">${highlighted}</div>`;
        }).join('');
      }

      dropdown.style.display = 'block';

      setTimeout(() => {
        document.addEventListener('click', hideTrashCustomerSuggestionsOnClickOutside, { once: true, capture: true });
      }, 0);
    }

    function hideTrashCustomerSuggestionsOnClickOutside(e) {
      const wrapper = document.querySelector('#trashFilterCustomer')?.closest('.autocomplete-wrapper');
      const dropdown = document.getElementById('trashCustomerSuggestions');

      if (wrapper && !wrapper.contains(e.target)) {
        dropdown.style.display = 'none';
      } else {
        document.addEventListener('click', hideTrashCustomerSuggestionsOnClickOutside, { once: true, capture: true });
      }
    }

    function selectTrashCustomer(customer) {
      document.getElementById('trashFilterCustomer').value = customer;
      document.getElementById('trashCustomerSuggestions').style.display = 'none';
      updateTrashSearchStateFromUI();
      updateTrashFilterBadge();
      renderTrashIncomeList();
    }

    // ═════════════════ Trash Unit Autocomplete ═════════════════
    let trashUnitAutocompleteTimer = null;

    function onTrashUnitInput() {
      showTrashUnitSuggestions();
      if (trashUnitAutocompleteTimer) {
        clearTimeout(trashUnitAutocompleteTimer);
      }
      trashUnitAutocompleteTimer = setTimeout(() => {
        updateTrashSearchStateFromUI();
        updateTrashFilterBadge();
        renderTrashIncomeList();
      }, 300);
    }

    function showTrashUnitSuggestions() {
      const input = document.getElementById('trashFilterUnit');
      const dropdown = document.getElementById('trashUnitSuggestions');
      const value = input.value.trim().toLowerCase();

      const matches = value
        ? uniqueTrashUnits.filter(u => u.toLowerCase().includes(value))
        : uniqueTrashUnits.slice(0, 10);

      if (matches.length === 0) {
        dropdown.innerHTML = '<div class="suggestion-empty">Tidak ditemukan</div>';
      } else {
        dropdown.innerHTML = matches.map(unit => {
          const highlighted = value
            ? unit.replace(new RegExp(`(${escapeRegex(value)})`, 'gi'), '<mark>$1</mark>')
            : unit;
          return `<div class="suggestion-item" onclick="selectTrashUnit('${escapeHtml(unit)}')">${highlighted}</div>`;
        }).join('');
      }

      dropdown.style.display = 'block';

      setTimeout(() => {
        document.addEventListener('click', hideTrashUnitSuggestionsOnClickOutside, { once: true, capture: true });
      }, 0);
    }

    function hideTrashUnitSuggestionsOnClickOutside(e) {
      const wrapper = document.querySelector('#trashFilterUnit')?.closest('.autocomplete-wrapper');
      const dropdown = document.getElementById('trashUnitSuggestions');

      if (wrapper && !wrapper.contains(e.target)) {
        dropdown.style.display = 'none';
      } else {
        document.addEventListener('click', hideTrashUnitSuggestionsOnClickOutside, { once: true, capture: true });
      }
    }

    function selectTrashUnit(unit) {
      document.getElementById('trashFilterUnit').value = unit;
      document.getElementById('trashUnitSuggestions').style.display = 'none';
      updateTrashSearchStateFromUI();
      updateTrashFilterBadge();
      renderTrashIncomeList();
    }

    async function restoreIncomeFromTrash(logId) {
      if (!logId) {
        showToast('ID log tidak valid', 'error');
        return;
      }

      try {
        const res = await api('POST', `/deletion-logs/${logId}/restore`, {});

        if (!res.ok) {
          throw new Error(res.error || 'Gagal mengembalikan transaksi');
        }

        // Refresh data dari server
        await loadData();

        // Remove restored item from cache and re-render
        cachedTrashTransactions = cachedTrashTransactions.filter(log => log.id !== logId);
        setupTrashAutocomplete();

        showToast(`Transaksi ${res.restoredId} berhasil dikembalikan dengan ID yang sama`, 'success');
        renderTrashIncomeList();
        renderReports();
      } catch (error) {
        showToast('Gagal mengembalikan transaksi: ' + error.message, 'error');
      }
    }

    // Permanent delete function for income
    async function deleteIncomePermanently(logId, recordId) {
      if (!logId) {
        showToast('ID log tidak valid', 'error');
        return;
      }

      // Show confirmation dialog
      if (!confirm(`⚠️ PERINGATAN:\n\nTransaksi ${recordId} akan dihapus PERMANEN dan tidak bisa dikembalikan.\n\nYakin ingin melanjutkan?`)) {
        return;
      }

      try {
        const res = await api('POST', `/deletion-logs/${logId}/permanent-delete`, {});

        if (!res.ok) {
          throw new Error(res.error || 'Gagal menghapus permanen');
        }

        // Remove deleted item from cache and re-render
        cachedTrashTransactions = cachedTrashTransactions.filter(log => log.id !== logId);
        setupTrashAutocomplete();

        showToast(`Transaksi ${res.deletedId} dihapus permanen`, 'success');
        renderTrashIncomeList();
        renderReports();
      } catch (error) {
        showToast('Gagal menghapus permanen: ' + error.message, 'error');
      }
    }

    // ═════════════════ Trash Expense Functions ═════════════════
    // Search state for trash expense
    let trashExpenseSearchState = {
      search: '',
      category: '',
      subCategory: '',
      item: '',
      amountMin: '',
      amountMax: '',
      dateFrom: '',
      dateTo: '',
      note: '',
      sortBy: 'date',
      sortOrder: 'desc'
    };
    let trashExpenseSearchDebounceTimer = null;
    let cachedTrashExpenses = [];
    let uniqueTrashExpenseCategories = [];
    let uniqueTrashExpenseSubCategories = [];
    let uniqueTrashExpenseItems = [];

    function openTrashExpenseModal() {
      // Reset search state
      trashExpenseSearchState = {
        search: '',
        category: '',
        subCategory: '',
        item: '',
        amountMin: '',
        amountMax: '',
        dateFrom: '',
        dateTo: '',
        note: '',
        sortBy: 'date',
        sortOrder: 'desc'
      };

      // Setup autocomplete data
      setupTrashExpenseAutocomplete();

      // Sync UI
      syncTrashExpenseSearchUI();

      // Load and render data
      renderTrashExpenseList();
      openModal('modalTrashExpense');
    }

    // Setup autocomplete data from cached trash expenses
    function setupTrashExpenseAutocomplete() {
      uniqueTrashExpenseCategories = [...new Set(cachedTrashExpenses.map(log => log.recordData?.category).filter(Boolean))].sort();
      uniqueTrashExpenseSubCategories = [...new Set(cachedTrashExpenses.map(log => log.recordData?.subCategory).filter(Boolean))].sort();
      uniqueTrashExpenseItems = [...new Set(cachedTrashExpenses.map(log => log.recordData?.item).filter(Boolean))].sort();
    }

    // Sync UI with search state
    function syncTrashExpenseSearchUI() {
      document.getElementById('trashExpenseSearchInput').value = trashExpenseSearchState.search;
      document.getElementById('trashExpenseFilterCategory').value = trashExpenseSearchState.category;
      document.getElementById('trashExpenseFilterSubCategory').value = trashExpenseSearchState.subCategory;
      document.getElementById('trashExpenseFilterItem').value = trashExpenseSearchState.item;
      document.getElementById('trashExpenseFilterAmountMin').value = trashExpenseSearchState.amountMin;
      document.getElementById('trashExpenseFilterAmountMax').value = trashExpenseSearchState.amountMax;
      document.getElementById('trashExpenseFilterDateFrom').value = trashExpenseSearchState.dateFrom;
      document.getElementById('trashExpenseFilterDateTo').value = trashExpenseSearchState.dateTo;
      document.getElementById('trashExpenseFilterNote').value = trashExpenseSearchState.note;
      document.getElementById('trashExpenseSortBy').value = trashExpenseSearchState.sortBy;
      document.getElementById('trashExpenseSortOrder').value = trashExpenseSearchState.sortOrder;
    }

    // Update state from UI
    function updateTrashExpenseSearchStateFromUI() {
      trashExpenseSearchState.search = document.getElementById('trashExpenseSearchInput').value.trim();
      trashExpenseSearchState.category = document.getElementById('trashExpenseFilterCategory').value.trim();
      trashExpenseSearchState.subCategory = document.getElementById('trashExpenseFilterSubCategory').value.trim();
      trashExpenseSearchState.item = document.getElementById('trashExpenseFilterItem').value.trim();
      trashExpenseSearchState.amountMin = document.getElementById('trashExpenseFilterAmountMin').value;
      trashExpenseSearchState.amountMax = document.getElementById('trashExpenseFilterAmountMax').value;
      trashExpenseSearchState.dateFrom = document.getElementById('trashExpenseFilterDateFrom').value;
      trashExpenseSearchState.dateTo = document.getElementById('trashExpenseFilterDateTo').value;
      trashExpenseSearchState.note = document.getElementById('trashExpenseFilterNote').value.trim();
      trashExpenseSearchState.sortBy = document.getElementById('trashExpenseSortBy').value;
      trashExpenseSearchState.sortOrder = document.getElementById('trashExpenseSortOrder').value;
    }

    // Toggle filter panel
    function toggleTrashExpenseFilters() {
      const panel = document.getElementById('trashExpenseFilterPanel');
      const isVisible = panel.style.display === 'block';
      panel.style.display = isVisible ? 'none' : 'block';
    }

    // Update active filter badge
    function updateTrashExpenseFilterBadge() {
      const activeFilters = [
        trashExpenseSearchState.category,
        trashExpenseSearchState.subCategory,
        trashExpenseSearchState.item,
        trashExpenseSearchState.amountMin,
        trashExpenseSearchState.amountMax,
        trashExpenseSearchState.dateFrom,
        trashExpenseSearchState.dateTo,
        trashExpenseSearchState.note
      ].filter(v => v !== '' && v !== null && v !== undefined).length;

      const badge = document.getElementById('trashExpenseActiveFilterCount');
      if (activeFilters > 0) {
        badge.textContent = activeFilters;
        badge.style.display = 'inline';
      } else {
        badge.style.display = 'none';
      }
    }

    // Clear all filters
    function clearAllTrashExpenseFilters() {
      trashExpenseSearchState = {
        search: '',
        category: '',
        subCategory: '',
        item: '',
        amountMin: '',
        amountMax: '',
        dateFrom: '',
        dateTo: '',
        note: '',
        sortBy: 'date',
        sortOrder: 'desc'
      };
      syncTrashExpenseSearchUI();
      updateTrashExpenseFilterBadge();
      renderTrashExpenseList();
    }

    // Debounced search
    function debouncedSearchTrashExpense() {
      if (trashExpenseSearchDebounceTimer) {
        clearTimeout(trashExpenseSearchDebounceTimer);
      }
      trashExpenseSearchDebounceTimer = setTimeout(() => {
        updateTrashExpenseSearchStateFromUI();
        updateTrashExpenseFilterBadge();
        renderTrashExpenseList();
      }, 300);
    }

    // Main search function - filters cached data
    function searchTrashExpense() {
      updateTrashExpenseSearchStateFromUI();
      updateTrashExpenseFilterBadge();
      renderTrashExpenseList();
    }

    // Get expense category info helper (reuse existing function if available, or inline)
    function getTrashExpenseCategoryInfo(category, subCategory) {
      const catInfo = getExpenseCategoryInfo(category, subCategory);
      return catInfo;
    }

    // Filter and render trash expense list
    async function renderTrashExpenseList() {
      const container = document.getElementById('trashExpenseList');
      const emptyState = document.getElementById('trashExpenseEmpty');
      const countEl = document.getElementById('trashExpenseCount');
      const resultsText = document.getElementById('trashExpenseSearchResults');

      // Loading state
      container.innerHTML = '<p class="empty-state-p20">⏳ Memuat...</p>';

      try {
        // Ambil data dari server (deletion_logs) jika belum ada cached data
        if (cachedTrashExpenses.length === 0) {
          const res = await api('GET', '/deletion-logs?recordType=expense&limit=200');
          if (!res.ok) {
            throw new Error(res.error || 'Gagal memuat data sampah');
          }
          cachedTrashExpenses = res.logs || [];
          setupTrashExpenseAutocomplete();
        }

        // Apply filters
        let filtered = [...cachedTrashExpenses];
        const t = trashExpenseSearchState;

        // Search by TX ID
        if (t.search) {
          const searchLower = t.search.toLowerCase();
          filtered = filtered.filter(log => {
            const data = log.recordData || {};
            return (data.id && data.id.toLowerCase().includes(searchLower));
          });
        }

        // Filter by category
        if (t.category) {
          const catLower = t.category.toLowerCase();
          filtered = filtered.filter(log => {
            const category = log.recordData?.category || '';
            return category.toLowerCase().includes(catLower);
          });
        }

        // Filter by sub-category
        if (t.subCategory) {
          const subLower = t.subCategory.toLowerCase();
          filtered = filtered.filter(log => {
            const subCat = log.recordData?.subCategory || '';
            return subCat.toLowerCase().includes(subLower);
          });
        }

        // Filter by item name
        if (t.item) {
          const itemLower = t.item.toLowerCase();
          filtered = filtered.filter(log => {
            const item = log.recordData?.item || '';
            return item.toLowerCase().includes(itemLower);
          });
        }

        // Filter by amount range
        if (t.amountMin) {
          const min = parseFloat(t.amountMin);
          filtered = filtered.filter(log => (log.recordData?.amount || 0) >= min);
        }
        if (t.amountMax) {
          const max = parseFloat(t.amountMax);
          filtered = filtered.filter(log => (log.recordData?.amount || 0) <= max);
        }

        // Filter by original expense date range
        if (t.dateFrom) {
          const fromDate = new Date(t.dateFrom);
          filtered = filtered.filter(log => {
            const expDate = new Date(log.recordData?.date || 0);
            return expDate >= fromDate;
          });
        }
        if (t.dateTo) {
          const toDate = new Date(t.dateTo);
          toDate.setHours(23, 59, 59, 999);
          filtered = filtered.filter(log => {
            const expDate = new Date(log.recordData?.date || 0);
            return expDate <= toDate;
          });
        }

        // Filter by note
        if (t.note) {
          const noteLower = t.note.toLowerCase();
          filtered = filtered.filter(log => {
            const note = log.recordData?.note || '';
            return note.toLowerCase().includes(noteLower);
          });
        }

        // Sort results
        filtered.sort((a, b) => {
          let valA, valB;
          const order = t.sortOrder === 'asc' ? 1 : -1;

          switch (t.sortBy) {
            case 'date':
              valA = new Date(a.deletedAt || 0).getTime();
              valB = new Date(b.deletedAt || 0).getTime();
              break;
            case 'originalDate':
              valA = new Date(a.recordData?.date || 0).getTime();
              valB = new Date(b.recordData?.date || 0).getTime();
              break;
            case 'amount':
              valA = a.recordData?.amount || 0;
              valB = b.recordData?.amount || 0;
              break;
            case 'category':
              valA = (a.recordData?.category || '').toLowerCase();
              valB = (b.recordData?.category || '').toLowerCase();
              break;
            case 'item':
              valA = (a.recordData?.item || '').toLowerCase();
              valB = (b.recordData?.item || '').toLowerCase();
              break;
            default:
              valA = new Date(a.deletedAt || 0).getTime();
              valB = new Date(b.deletedAt || 0).getTime();
          }

          if (valA < valB) return -1 * order;
          if (valA > valB) return 1 * order;
          return 0;
        });

        countEl.textContent = filtered.length;

        // Update results text
        if (resultsText) {
          const totalCached = cachedTrashExpenses.length;
          if (filtered.length !== totalCached) {
            resultsText.textContent = `${filtered.length} dari ${totalCached} pengeluaran`;
          } else {
            resultsText.textContent = `${filtered.length} pengeluaran`;
          }
        }

        if (filtered.length === 0) {
          container.innerHTML = '';
          emptyState.style.display = 'block';
          return;
        }

        emptyState.style.display = 'none';

        container.innerHTML = filtered.map((log, index) => {
          const e = log.recordData;
          const nomor = index + 1;
          const catInfo = getTrashExpenseCategoryInfo(e.category, e.subCategory);
          const subCatEmoji = catInfo.subCategory ? getSubCategoryEmoji(catInfo.category, catInfo.subCategory) : '';

          return `
          <div style="background: rgba(220, 38, 38, 0.15); border: 2px solid var(--ps3-red-badge); border-radius: 10px; padding: 14px; margin-bottom: 10px; position: relative;" data-log-id="${log.id}">
            <!-- Number Badge -->
            <div class="badge-abs-top">${nomor}</div>

            <!-- Row 1: Date (left) + Amount (right) -->
            <div class="card-row-between">
              <div class="fs-9 text-muted fw-500">
                ${formatDateOnlyWIB(e.created_at || e.date)}
              </div>
              <div class="text-red fs-115 fw-600">
                ${formatMoney(e.amount)}
              </div>
            </div>

            <!-- Row 2: Category -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: ${catInfo.subCategory ? '6px' : '10px'};">
              <div class="fs-105 lh-14 flex-1 min-w-0 pr-10 text-primary">
                ${catInfo.icon} ${catInfo.category}
              </div>
            </div>

            <!-- Row 3: Sub-category (if exists) -->
            ${catInfo.subCategory ? `
            <div style="font-size: 0.95rem; color: var(--ps3-text); margin-bottom: 10px; padding-left: 2px; display: flex; align-items: center; gap: 6px;">
              <span class="fs-1">${subCatEmoji || '🏷️'}</span>
              <span>${catInfo.subCategory}</span>
            </div>
            ` : ''}

            <!-- Row 4: Item Name (if different from category) -->
            ${e.item && e.item !== e.category ? `
            <div style="font-size: 0.95rem; color: var(--ps3-text); margin-bottom: 10px; padding-left: 2px; display: flex; align-items: center; gap: 6px;">
              <span class="fs-1">📝</span>
              <span>${e.item}</span>
            </div>
            ` : ''}

            <!-- Row 5: Time | TX ID (centered) | Note -->
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: var(--ps3-muted); padding-top: 8px; border-top: 1px solid var(--ps3-red-badge); opacity: 0.85; margin-bottom: 12px;">
              <div class="info-row-compact">
                <span>🕐</span>
                <span>${formatTimeOnlyWIB(e.created_at || e.date)}</span>
              </div>
              <div class="tab-btn-group">
                <span class="tx-id-label">TX ID:</span>
                <span onclick="copyToClipboard('${e.id || ''}')" class="tx-id-badge" title="Klik untuk copy ID" class="fs-75">${e.id || ''}</span>
              </div>
              <div style="font-style: italic; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; flex: 1;">
                ${e.note ? `💬 ${e.note}` : ''}
              </div>
            </div>

            <!-- Deleted Info -->
            <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; margin-bottom: 12px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span class="text-75 text-muted">Dihapus:</span>
                <span style="font-size: 0.75rem; color: var(--ps3-red);">${formatTrashDateTime(log.deletedAt)}</span>
              </div>
              <div class="flex-between">
                <span class="text-75 text-muted">Alasan:</span>
                <span style="font-size: 0.75rem; color: var(--ps3-text);">${log.deleteReason || '-'}</span>
              </div>
            </div>

            <!-- Action Buttons: Kembalikan & Hapus Permanen -->
            <div class="flex-gap-8">
              <button onclick="restoreExpenseFromTrash(${log.id})" style="flex: 1; padding: 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; background: var(--ps3-green-dark); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                ♻️ Kembalikan
              </button>
              <button onclick="deleteExpensePermanently(${log.id}, '${log.recordId}')" style="flex: 1; padding: 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; background: var(--ps3-red); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                🗑️ Hapus
              </button>
            </div>
          </div>
          `;
        }).join('');
      } catch (error) {
        container.innerHTML = `<p style="text-align: center; color: var(--ps3-red); padding: 20px;">❌ Error: ${escapeHtml(error.message)}</p>`;
      }
    }

    // ═════════════════ Trash Expense Autocomplete Functions ═════════════════
    let trashExpenseCategoryTimer = null;
    let trashExpenseSubCategoryTimer = null;
    let trashExpenseItemTimer = null;

    // Category Autocomplete
    function onTrashExpenseCategoryInput() {
      showTrashExpenseCategorySuggestions();
      if (trashExpenseCategoryTimer) clearTimeout(trashExpenseCategoryTimer);
      trashExpenseCategoryTimer = setTimeout(() => {
        updateTrashExpenseSearchStateFromUI();
        updateTrashExpenseFilterBadge();
        renderTrashExpenseList();
      }, 300);
    }

    function showTrashExpenseCategorySuggestions() {
      const input = document.getElementById('trashExpenseFilterCategory');
      const dropdown = document.getElementById('trashExpenseCategorySuggestions');
      const value = input.value.trim().toLowerCase();

      const matches = value
        ? uniqueTrashExpenseCategories.filter(c => c.toLowerCase().includes(value))
        : uniqueTrashExpenseCategories.slice(0, 10);

      if (matches.length === 0) {
        dropdown.innerHTML = '<div class="suggestion-empty">Tidak ditemukan</div>';
      } else {
        dropdown.innerHTML = matches.map(cat => {
          const highlighted = value
            ? cat.replace(new RegExp(`(${escapeRegex(value)})`, 'gi'), '<mark>$1</mark>')
            : cat;
          return `<div class="suggestion-item" onclick="selectTrashExpenseCategory('${escapeHtml(cat)}')">${highlighted}</div>`;
        }).join('');
      }

      dropdown.style.display = 'block';
      setTimeout(() => {
        document.addEventListener('click', hideTrashExpenseCategorySuggestions, { once: true, capture: true });
      }, 0);
    }

    function hideTrashExpenseCategorySuggestions(e) {
      const wrapper = document.querySelector('#trashExpenseFilterCategory')?.closest('.autocomplete-wrapper');
      const dropdown = document.getElementById('trashExpenseCategorySuggestions');
      if (wrapper && !wrapper.contains(e.target)) {
        dropdown.style.display = 'none';
      } else {
        document.addEventListener('click', hideTrashExpenseCategorySuggestions, { once: true, capture: true });
      }
    }

    function selectTrashExpenseCategory(category) {
      document.getElementById('trashExpenseFilterCategory').value = category;
      document.getElementById('trashExpenseCategorySuggestions').style.display = 'none';
      updateTrashExpenseSearchStateFromUI();
      updateTrashExpenseFilterBadge();
      renderTrashExpenseList();
    }

    // Sub-category Autocomplete
    function onTrashExpenseSubCategoryInput() {
      showTrashExpenseSubCategorySuggestions();
      if (trashExpenseSubCategoryTimer) clearTimeout(trashExpenseSubCategoryTimer);
      trashExpenseSubCategoryTimer = setTimeout(() => {
        updateTrashExpenseSearchStateFromUI();
        updateTrashExpenseFilterBadge();
        renderTrashExpenseList();
      }, 300);
    }

    function showTrashExpenseSubCategorySuggestions() {
      const input = document.getElementById('trashExpenseFilterSubCategory');
      const dropdown = document.getElementById('trashExpenseSubCategorySuggestions');
      const value = input.value.trim().toLowerCase();

      const matches = value
        ? uniqueTrashExpenseSubCategories.filter(s => s.toLowerCase().includes(value))
        : uniqueTrashExpenseSubCategories.slice(0, 10);

      if (matches.length === 0) {
        dropdown.innerHTML = '<div class="suggestion-empty">Tidak ditemukan</div>';
      } else {
        dropdown.innerHTML = matches.map(sub => {
          const highlighted = value
            ? sub.replace(new RegExp(`(${escapeRegex(value)})`, 'gi'), '<mark>$1</mark>')
            : sub;
          return `<div class="suggestion-item" onclick="selectTrashExpenseSubCategory('${escapeHtml(sub)}')">${highlighted}</div>`;
        }).join('');
      }

      dropdown.style.display = 'block';
      setTimeout(() => {
        document.addEventListener('click', hideTrashExpenseSubCategorySuggestions, { once: true, capture: true });
      }, 0);
    }

    function hideTrashExpenseSubCategorySuggestions(e) {
      const wrapper = document.querySelector('#trashExpenseFilterSubCategory')?.closest('.autocomplete-wrapper');
      const dropdown = document.getElementById('trashExpenseSubCategorySuggestions');
      if (wrapper && !wrapper.contains(e.target)) {
        dropdown.style.display = 'none';
      } else {
        document.addEventListener('click', hideTrashExpenseSubCategorySuggestions, { once: true, capture: true });
      }
    }

    function selectTrashExpenseSubCategory(subCategory) {
      document.getElementById('trashExpenseFilterSubCategory').value = subCategory;
      document.getElementById('trashExpenseSubCategorySuggestions').style.display = 'none';
      updateTrashExpenseSearchStateFromUI();
      updateTrashExpenseFilterBadge();
      renderTrashExpenseList();
    }

    // Item Autocomplete
    function onTrashExpenseItemInput() {
      showTrashExpenseItemSuggestions();
      if (trashExpenseItemTimer) clearTimeout(trashExpenseItemTimer);
      trashExpenseItemTimer = setTimeout(() => {
        updateTrashExpenseSearchStateFromUI();
        updateTrashExpenseFilterBadge();
        renderTrashExpenseList();
      }, 300);
    }

    function showTrashExpenseItemSuggestions() {
      const input = document.getElementById('trashExpenseFilterItem');
      const dropdown = document.getElementById('trashExpenseItemSuggestions');
      const value = input.value.trim().toLowerCase();

      const matches = value
        ? uniqueTrashExpenseItems.filter(i => i.toLowerCase().includes(value))
        : uniqueTrashExpenseItems.slice(0, 10);

      if (matches.length === 0) {
        dropdown.innerHTML = '<div class="suggestion-empty">Tidak ditemukan</div>';
      } else {
        dropdown.innerHTML = matches.map(item => {
          const highlighted = value
            ? item.replace(new RegExp(`(${escapeRegex(value)})`, 'gi'), '<mark>$1</mark>')
            : item;
          return `<div class="suggestion-item" onclick="selectTrashExpenseItem('${escapeHtml(item)}')">${highlighted}</div>`;
        }).join('');
      }

      dropdown.style.display = 'block';
      setTimeout(() => {
        document.addEventListener('click', hideTrashExpenseItemSuggestions, { once: true, capture: true });
      }, 0);
    }

    function hideTrashExpenseItemSuggestions(e) {
      const wrapper = document.querySelector('#trashExpenseFilterItem')?.closest('.autocomplete-wrapper');
      const dropdown = document.getElementById('trashExpenseItemSuggestions');
      if (wrapper && !wrapper.contains(e.target)) {
        dropdown.style.display = 'none';
      } else {
        document.addEventListener('click', hideTrashExpenseItemSuggestions, { once: true, capture: true });
      }
    }

    function selectTrashExpenseItem(item) {
      document.getElementById('trashExpenseFilterItem').value = item;
      document.getElementById('trashExpenseItemSuggestions').style.display = 'none';
      updateTrashExpenseSearchStateFromUI();
      updateTrashExpenseFilterBadge();
      renderTrashExpenseList();
    }

    // Restore function for expenses
    async function restoreExpenseFromTrash(logId) {
      if (!logId) {
        showToast('ID log tidak valid', 'error');
        return;
      }

      try {
        const res = await api('POST', `/deletion-logs/${logId}/restore`, {});

        if (!res.ok) {
          throw new Error(res.error || 'Gagal mengembalikan pengeluaran');
        }

        // Small delay to ensure DB commit completes
        await new Promise(r => setTimeout(r, 300));

        // Refresh data dari server
        await loadData();

        // Remove restored item from cache and re-render
        cachedTrashExpenses = cachedTrashExpenses.filter(log => log.id !== logId);
        setupTrashExpenseAutocomplete();

        // Refresh riwayat pengeluaran jika modal terbuka
        if (document.getElementById('modalAllExpenses')?.classList.contains('active')) {
          await searchExpenses();
        }

        // Explicitly render expenses list on main page
        renderExpenses();

        showToast(`Pengeluaran ${res.restoredId} berhasil dikembalikan dengan ID yang sama`, 'success');
        renderTrashExpenseList();
        renderReports();
      } catch (error) {
        showToast('Gagal mengembalikan pengeluaran: ' + error.message, 'error');
      }
    }

    // Permanent delete function for expenses
    async function deleteExpensePermanently(logId, recordId) {
      if (!logId) {
        showToast('ID log tidak valid', 'error');
        return;
      }

      // Show confirmation dialog
      if (!confirm(`⚠️ PERINGATAN:\n\nPengeluaran ${recordId} akan dihapus PERMANEN dan tidak bisa dikembalikan.\n\nYakin ingin melanjutkan?`)) {
        return;
      }

      try {
        const res = await api('POST', `/deletion-logs/${logId}/permanent-delete`, {});

        if (!res.ok) {
          throw new Error(res.error || 'Gagal menghapus permanen');
        }

        // Remove deleted item from cache and re-render
        cachedTrashExpenses = cachedTrashExpenses.filter(log => log.id !== logId);
        setupTrashExpenseAutocomplete();

        showToast(`Pengeluaran ${res.deletedId} dihapus permanen`, 'success');
        renderTrashExpenseList();
        renderReports();
      } catch (error) {
        showToast('Gagal menghapus permanen: ' + error.message, 'error');
      }
    }

    // Tab switching functions for history modal
    async function showEditLogsTab() {
      document.getElementById('btnShowEditLogs').style.background = 'var(--ps3-red)';
      document.getElementById('btnShowEditLogs').style.opacity = '1';

      if (currentEditTransactionId) {
        await loadEditHistory(currentEditTransactionId);
      }
    }

    // ═════════════════ Expense Edit Functions ═════════════════
    let currentEditExpenseId = null;
    let currentEditExpenseCategory = null;

    function openEditExpenseModal(expenseId) {
      showToast('Membuka edit pengeluaran... ID: ' + expenseId, 'info');
      
      currentEditExpenseId = expenseId;
      
      if (!expenses || expenses.length === 0) {
        showToast('Data pengeluaran belum dimuat. Tunggu sebentar...', 'error');
        return;
      }
      
      const expense = expenses.find(e => e.id == expenseId);
      if (!expense) {
        showToast('Pengeluaran tidak ditemukan (ID: ' + expenseId + '). Total: ' + expenses.length, 'error');
        return;
      }

      // Reset steps
      document.getElementById('editExpenseStep1').style.display = 'block';
      document.getElementById('editExpenseStep2').style.display = 'none';
      document.getElementById('editExpenseStep3').style.display = 'none';

      // Reset checkboxes
      document.getElementById('editExpenseCheckCategory').checked = false;
      document.getElementById('editExpenseCheckAmount').checked = false;
      document.getElementById('editExpenseCheckDateTime').checked = false;
      document.getElementById('editExpenseCheckNote').checked = false;

      // Get inferred category info for display
      const catInfo = getExpenseCategoryInfo(expense.item, expense.category);
      
      // Pre-fill current values
      // For legacy records with empty category, infer from item name
      let categoryToUse = expense.category || '';
      if (!categoryToUse && catInfo.category) {
        // Try to reverse-map the inferred category back to a dropdown value
        for (const [key, info] of Object.entries(EXPENSE_CATEGORY_MAP)) {
          if (info.category === catInfo.category || key === catInfo.category) {
            categoryToUse = key;
            break;
          }
        }
        // If no match found, use the item itself if it's a simple category
        if (!categoryToUse && !catInfo.subCategory) {
          categoryToUse = catInfo.category;
        }
      }
      
      currentEditExpenseCategory = categoryToUse;
      document.getElementById('editExpenseCategory').value = categoryToUse;
      document.getElementById('editExpenseAmount').value = expense.amount || 0;
      document.getElementById('editExpenseNote').value = expense.note || '';
      document.getElementById('editExpenseReason').value = '';
      
      // Parse and set datetime from created_at
      if (expense.created_at) {
        const wibTime = new Date(expense.created_at + (7 * 60 * 60 * 1000));
        const yyyy = wibTime.getUTCFullYear();
        const mm = String(wibTime.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(wibTime.getUTCDate()).padStart(2, '0');
        const hh = String(wibTime.getUTCHours()).padStart(2, '0');
        const min = String(wibTime.getUTCMinutes()).padStart(2, '0');
        document.getElementById('editExpenseDateTime').value = `${yyyy}-${mm}-${dd}T${hh}:${min}`;
      }
      
      // Handle sub-category
      onEditExpenseCategoryChange();
      if (catInfo.subCategory && EXPENSE_SUB_CATEGORIES[categoryToUse]) {
        // Set sub-category from parsed item (format: "Category - SubCategory")
        document.getElementById('editExpenseSubCategory').value = catInfo.subCategory;
      } else if (categoryToUse && EXPENSE_SUB_CATEGORIES[categoryToUse]) {
        // Try to extract sub-category from item if it contains " - "
        if (expense.item && expense.item.includes(' - ')) {
          const parts = expense.item.split(' - ');
          if (parts.length >= 2) {
            document.getElementById('editExpenseSubCategory').value = parts[1];
          }
        }
      } else if (categoryToUse === 'Custom') {
        document.getElementById('editExpenseCustomName').value = expense.item || '';
      }

      // Load edit history
      loadExpenseEditHistory(expenseId);

      openModal('modalEditExpense', true);
    }

    function onEditExpenseCategoryChange() {
      const category = document.getElementById('editExpenseCategory').value;
      const subCatContainer = document.getElementById('editExpenseSubCategoryContainer');
      const customContainer = document.getElementById('editExpenseCustomContainer');
      const subCatSelect = document.getElementById('editExpenseSubCategory');
      
      if (EXPENSE_SUB_CATEGORIES[category]) {
        subCatContainer.style.display = 'block';
        customContainer.style.display = 'none';
        
        // Populate sub-categories
        subCatSelect.innerHTML = '<option value="">-- Pilih Sub --</option>';
        EXPENSE_SUB_CATEGORIES[category].forEach(sub => {
          const option = document.createElement('option');
          option.value = sub.value;
          option.textContent = sub.label;
          subCatSelect.appendChild(option);
        });
      } else if (category === 'Custom') {
        subCatContainer.style.display = 'none';
        customContainer.style.display = 'block';
      } else {
        subCatContainer.style.display = 'none';
        customContainer.style.display = 'none';
      }
    }

    function proceedToEditExpenseStep2() {
      const fields = [
        'editExpenseCheckCategory',
        'editExpenseCheckAmount',
        'editExpenseCheckDateTime',
        'editExpenseCheckNote'
      ];

      const anySelected = fields.some(id => document.getElementById(id).checked);
      if (!anySelected) {
        showToast('Pilih minimal 1 data yang ingin diedit', 'error');
        return;
      }

      // Hide/show fields based on selection
      document.getElementById('editExpenseFieldCategory').style.display =
        document.getElementById('editExpenseCheckCategory').checked ? 'block' : 'none';
      document.getElementById('editExpenseFieldAmount').style.display =
        document.getElementById('editExpenseCheckAmount').checked ? 'block' : 'none';
      document.getElementById('editExpenseFieldDateTime').style.display =
        document.getElementById('editExpenseCheckDateTime').checked ? 'block' : 'none';
      document.getElementById('editExpenseFieldNote').style.display =
        document.getElementById('editExpenseCheckNote').checked ? 'block' : 'none';

      document.getElementById('editExpenseStep1').style.display = 'none';
      document.getElementById('editExpenseStep2').style.display = 'block';
    }

    function backToEditExpenseStep1() {
      document.getElementById('editExpenseStep1').style.display = 'block';
      document.getElementById('editExpenseStep2').style.display = 'none';
    }

    async function saveExpenseEdit() {
      const reason = document.getElementById('editExpenseReason').value.trim();
      if (!reason) {
        showToast('Alasan edit wajib diisi', 'error');
        return;
      }

      const updates = {};

      if (document.getElementById('editExpenseCheckCategory').checked) {
        const category = document.getElementById('editExpenseCategory').value;
        updates.category = category;
        
        // Determine item name based on category
        if (EXPENSE_SUB_CATEGORIES[category]) {
          const subCat = document.getElementById('editExpenseSubCategory').value;
          if (subCat) {
            updates.item = subCat;
          } else {
            showToast('Pilih sub-kategori', 'error');
            return;
          }
        } else if (category === 'Custom') {
          const customName = document.getElementById('editExpenseCustomName').value.trim();
          if (customName) {
            updates.item = customName;
          } else {
            showToast('Masukkan nama pengeluaran custom', 'error');
            return;
          }
        } else {
          updates.item = category;
        }
      }
      
      if (document.getElementById('editExpenseCheckAmount').checked) {
        updates.amount = parseInt(document.getElementById('editExpenseAmount').value) || 0;
      }
      
      if (document.getElementById('editExpenseCheckDateTime').checked) {
        // Convert datetime-local to timestamp (WIB to UTC)
        const dtLocal = document.getElementById('editExpenseDateTime').value;
        if (dtLocal) {
          // Parse as WIB (UTC+7) - manually construct UTC timestamp
          const [datePart, timePart] = dtLocal.split('T');
          const [year, month, day] = datePart.split('-').map(Number);
          const [hours, minutes] = timePart.split(':').map(Number);
          
          // Create UTC date that represents the WIB time
          // WIB = UTC+7, so UTC = WIB - 7 hours
          const utcYear = year;
          const utcMonth = month - 1; // JS months are 0-indexed
          const utcDay = day;
          const utcHours = hours - 7; // Subtract 7 hours for WIB→UTC
          
          const utcDate = new Date(Date.UTC(utcYear, utcMonth, utcDay, utcHours, minutes, 0));
          updates.created_at = utcDate.getTime();
          updates.date = datePart; // YYYY-MM-DD format
        }
      }
      
      if (document.getElementById('editExpenseCheckNote').checked) {
        updates.note = document.getElementById('editExpenseNote').value.trim();
      }

      if (Object.keys(updates).length === 0) {
        showToast('Tidak ada perubahan untuk disimpan', 'error');
        return;
      }

      try {
        const response = await api('PUT', `/expenses/${currentEditExpenseId}`, {
          updates,
          reason,
          editedBy: 'admin'
        });

        if (response.ok) {
          showToast(`Pengeluaran diperbarui (${response.changes} perubahan)`, 'success');

          // Show history after successful edit
          document.getElementById('editExpenseStep2').style.display = 'none';
          document.getElementById('editExpenseStep3').style.display = 'block';
          document.getElementById('btnShowExpenseEditLogs').style.background = 'var(--ps3-red)';
          document.getElementById('btnShowExpenseEditLogs').style.opacity = '1';
          await loadExpenseEditHistory(currentEditExpenseId);

          // Refresh data and re-render
          await loadData();
          renderExpenses();
          renderReports();
        } else {
          showToast(response.error || 'Gagal mengupdate pengeluaran', 'error');
        }
      } catch (error) {
        showToast(error.message || 'Terjadi kesalahan', 'error');
      }
    }

    async function loadExpenseEditHistory(expenseId) {
      try {
        const response = await api('GET', `/expenses/${expenseId}/edits`);
        const container = document.getElementById('editExpenseHistoryList');

        if (!response.ok || !response.logs || response.logs.length === 0) {
          container.innerHTML = `
            <div class="empty-state-p20">
              <div class="fs-2 mb-10">📝</div>
              <div>Belum ada riwayat edit untuk pengeluaran ini</div>
            </div>
          `;
          return;
        }

        const fieldLabels = {
          'category': 'Kategori',
          'item': 'Item',
          'amount': 'Jumlah',
          'date': 'Tanggal',
          'note': 'Catatan',
          'created_at': 'Waktu'
        };

        container.innerHTML = response.logs.map(log => {
          const editedAtWIB = new Date(log.editedAt + (7 * 60 * 60 * 1000));
          const dateStr = editedAtWIB.toLocaleString('id-ID', { 
            day: 'numeric', 
            month: 'short', 
            hour: '2-digit', 
            minute: '2-digit',
            timeZone: 'UTC'
          });

          let oldValue = log.oldValue;
          let newValue = log.newValue;

          // Format currency for amount field
          if (log.fieldName === 'amount') {
            oldValue = formatMoney(parseInt(oldValue) || 0);
            newValue = formatMoney(parseInt(newValue) || 0);
          }
          
          return `
            <div style="border-left: 3px solid var(--ps3-red); padding: 12px; margin-bottom: 12px; background: rgba(255,255,255,0.05); border-radius: 0 10px 10px 0;">
              <div class="text-8 text-muted mb-6">
                ${dateStr} • oleh ${log.editedBy || 'admin'}
              </div>
              <div class="fw-600 mb-4 text-primary">
                ${fieldLabels[log.fieldName] || log.fieldName}
              </div>
              <div style="display: flex; align-items: center; gap: 8px; font-size: 0.9rem;">
                <span class="strike text-red">${oldValue || '(kosong)'}</span>
                <span class="text-muted">→</span>
                <span style="color: var(--ps3-green); font-weight: 500;">${newValue || '(kosong)'}</span>
              </div>
              ${log.editReason ? `<div style="font-size: 0.8rem; color: var(--ps3-muted); margin-top: 6px; font-style: italic;">💬 ${log.editReason}</div>` : ''}
            </div>
          `;
        }).join('');
      } catch (error) {
        console.error('Error loading expense edit history:', error);
      }
    }

    async function viewExpenseEditHistory(expenseId, itemName) {
      if (!expenseId) {
        showToast('ID pengeluaran tidak valid', 'error');
        return;
      }
      
      currentEditExpenseId = expenseId;
      
      // Show history modal
      document.querySelector('#modalEditExpense .modal-title').textContent = `📋 Riwayat: ${itemName}`;
      document.getElementById('editExpenseStep1').style.display = 'none';
      document.getElementById('editExpenseStep2').style.display = 'none';
      document.getElementById('editExpenseStep3').style.display = 'block';

      // Reset button style
      document.getElementById('btnShowExpenseEditLogs').style.background = 'var(--ps3-red)';
      document.getElementById('btnShowExpenseEditLogs').style.opacity = '1';
      
      openModal('modalEditExpense', true);
      
      // Load history
      await loadExpenseEditHistory(expenseId);
    }

    // ═════════════════ Expense Delete Functions ═════════════════
    let currentDeleteExpenseId = null;

    function openDeleteExpenseModal(expenseId, itemName, amount) {
      if (!expenseId) {
        showToast('ID pengeluaran tidak valid', 'error');
        return;
      }
      
      currentDeleteExpenseId = expenseId;
      
      // Populate modal details
      document.getElementById('deleteExpenseItem').textContent = itemName || '-';
      document.getElementById('deleteExpenseAmount').textContent = formatMoney(amount || 0);
      
      // Reset form
      document.getElementById('confirmDeleteExpenseCheckbox').checked = false;
      document.getElementById('deleteExpenseReason').value = '';
      
      openModal('modalDeleteExpense', true);
    }

    async function confirmDeleteExpense() {
      // Validate checkbox
      if (!document.getElementById('confirmDeleteExpenseCheckbox').checked) {
        showToast('Anda harus menyetujui penghapusan', 'error');
        return;
      }
      
      // Validate reason
      const reason = document.getElementById('deleteExpenseReason').value.trim();
      if (!reason || reason.length < 3) {
        showToast('Alasan penghapusan wajib diisi (minimum 3 karakter)', 'error');
        return;
      }
      
      try {
        const response = await api('DELETE', `/expenses/${currentDeleteExpenseId}`, {
          reason: reason,
          deletedBy: 'admin'
        });
        
        if (response.ok) {
          showToast('Pengeluaran berhasil dihapus', 'success');
          closeModal('modalDeleteExpense');
          await loadData();
          renderExpenses();

          // Clear trash cache so it will be re-fetched with the new item
          cachedTrashExpenses = [];
        } else {
          showToast('Gagal menghapus: ' + (response.error || 'Unknown error'), 'error');
        }
      } catch (error) {
        showToast('Gagal menghapus: ' + error.message, 'error');
      }
    }



    function showLoading(show) {
      document.getElementById('loadingOverlay').classList.toggle('active', show);
    }

    function showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.innerHTML = `
        <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
        <span class="toast-message">${message}</span>
      `;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
    }

    function updateSyncStatus(status) {
      const indicator = document.getElementById('syncIndicator');
      indicator.className = 'sync-indicator ' + status;
    }

    // ═════════════════ Global Clock System ═════════════════
    // Global clock state - used by all time-based calculations
    let globalClock = {
      now: new Date(),
      lastMinute: null,
      wibTime: null
    };

    function updateClock() {
      const now = new Date();
      // Convert to WIB timezone (UTC+7)
      const wibTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
      const hours = String(wibTime.getUTCHours()).padStart(2, '0');
      const minutes = String(wibTime.getUTCMinutes()).padStart(2, '0');
      const seconds = String(wibTime.getUTCSeconds()).padStart(2, '0');
      
      // Update global clock state
      globalClock.now = now;
      globalClock.wibTime = wibTime;
      const currentMinute = `${hours}:${minutes}`;
      
      // Check if minute changed
      const minuteChanged = globalClock.lastMinute !== null && globalClock.lastMinute !== currentMinute;
      globalClock.lastMinute = currentMinute;
      
      // Update clock display
      const clockEl = document.getElementById('clock');
      if (clockEl) {
        const timeEl = clockEl.querySelector('.time');
        if (timeEl) {
          timeEl.textContent = `${hours}:${minutes}:${seconds}`;
        }
      }
      
      // When minute changes, update time-sensitive UI elements
      if (minuteChanged) {
        onMinuteChanged();
      }
    }

    // Called every time the minute changes
    function onMinuteChanged() {
      // Re-render schedules to update countdown badges
      if (document.getElementById('pageManagement')?.style.display !== 'none') {
        renderSchedules();
      }
    }

    // ═════════════════ Format Helpers ═════════════════
    function formatMoney(amount) {
      if (amount < 0) {
        return 'Rp -' + Math.abs(amount).toLocaleString('id-ID');
      }
      return 'Rp' + amount.toLocaleString('id-ID');
    }

    function formatTime(ms) {
      if (ms < 0) ms = 0;
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    function formatDate(timestamp) {
      return new Date(timestamp).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    // Format Unix timestamp (ms) to WIB timezone display (matching the clock in top-right)
    function formatDateWIB(timestampMs) {
      if (!timestampMs) return '−';
      // Convert to number if it's a string (e.g., date string)
      const ts = typeof timestampMs === 'string' ? new Date(timestampMs).getTime() : Number(timestampMs);
      if (isNaN(ts)) return '−';
      // WIB is UTC+7
      const wibTime = new Date(ts + (7 * 60 * 60 * 1000));
      const day = wibTime.getUTCDate();
      const month = wibTime.toLocaleString('id-ID', { month: 'short', timeZone: 'UTC' });
      const year = wibTime.getUTCFullYear();
      const hours = String(wibTime.getUTCHours()).padStart(2, '0');
      const minutes = String(wibTime.getUTCMinutes()).padStart(2, '0');
      return `${day} ${month} ${year} ${hours}:${minutes}`;
    }

    function formatDateOnlyWIB(timestampMs) {
      if (!timestampMs) return '−';
      // Convert to number if it's a string (e.g., date string)
      const ts = typeof timestampMs === 'string' ? new Date(timestampMs).getTime() : Number(timestampMs);
      if (isNaN(ts)) return '−';
      const wibTime = new Date(ts + (7 * 60 * 60 * 1000));
      const day = wibTime.getUTCDate();
      const month = wibTime.toLocaleString('id-ID', { month: 'short', timeZone: 'UTC' });
      const year = wibTime.getUTCFullYear();
      return `${day} ${month} ${year}`;
    }

    function formatTimeOnlyWIB(timestampMs) {
      if (!timestampMs) return '−';
      // Convert to number if it's a string (e.g., date string)
      const ts = typeof timestampMs === 'string' ? new Date(timestampMs).getTime() : Number(timestampMs);
      if (isNaN(ts)) return '−';
      const wibTime = new Date(ts + (7 * 60 * 60 * 1000));
      const hours = String(wibTime.getUTCHours()).padStart(2, '0');
      const minutes = String(wibTime.getUTCMinutes()).padStart(2, '0');
      return `${hours}:${minutes} WIB`;
    }

    async function copyToClipboard(text) {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        showToast(`ID disalin: ${text}`);
      } catch (err) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
          showToast(`ID disalin: ${text}`);
        } catch (e) {
          alert('Gagal copy ID: ' + text);
        }
        document.body.removeChild(textArea);
      }
    }

    function showToast(message) {
      const existing = document.querySelector('.toast-notification');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.className = 'toast-notification';
      toast.textContent = message;
      toast.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.9);
        color: #fff;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 0.8rem;
        z-index: 10000;
        border: 1px solid var(--ps3-red);
        box-shadow: 0 4px 20px rgba(230,0,18,0.3);
        animation: fadeInUp 0.3s ease;
      `;
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.style.animation = 'fadeOutDown 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 2000);
    }

    // Toast animations
    const toastStyles = document.createElement('style');
    toastStyles.textContent = `
      @keyframes fadeInUp {
        from { opacity: 0; transform: translate(-50%, 20px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
      @keyframes fadeOutDown {
        from { opacity: 1; transform: translate(-50%, 0); }
        to { opacity: 0; transform: translate(-50%, 20px); }
      }
    `;
    document.head.appendChild(toastStyles);

    // ═════════════════ Management Functions ═════════════════
    // Data storage for management
    let schedules = [];
    let inventory = [];
    let capitalData = { capital: [], expenses: [], summary: { totalCapital: 0, totalSpent: 0, remaining: 0 } };

    // Schedule Functions
    function handleScheduleDurationChange(select) {
      const customInput = document.getElementById('scheduleDurationCustom');
      const customLabel = document.getElementById('customDurationLabel');
      
      if (select.value === 'custom') {
        customInput.style.display = 'block';
        customLabel.style.color = 'var(--ps3-text)';
        customInput.focus();
      } else {
        customInput.style.display = 'none';
        customLabel.style.color = 'var(--ps3-muted)';
        // Auto update end date/time when selecting preset duration
        updateEndDateTimeFromDuration();
      }
    }
    
    // Initialize default end date when start date changes
    function initDefaultEndDate() {
      const startDate = document.getElementById('scheduleDate').value;
      const endDateInput = document.getElementById('scheduleEndDate');
      
      if (startDate && !endDateInput.value) {
        endDateInput.value = startDate;
      }
      
      // Also update end time if we have start time and duration
      updateEndDateTimeFromDuration();
    }
    
    // Calculate duration from start and end datetime (with dates, WIB timezone aware)
    function getDurationMinutesWithDate(startDate, startTime, endDate, endTime) {
      if (!startDate || !startTime || !endDate || !endTime) return 0;
      
      // Parse dates as WIB (UTC+7) by appending timezone offset
      const start = new Date(`${startDate}T${startTime}:00+07:00`);
      const end = new Date(`${endDate}T${endTime}:00+07:00`);
      
      const diffMs = end - start;
      const diffMinutes = Math.round(diffMs / (1000 * 60));
      
      return diffMinutes > 0 ? diffMinutes : 0;
    }
    
    // Calculate end datetime from start datetime and duration (WIB timezone aware)
    function addMinutesToDateTime(startDate, startTime, minutes) {
      if (!startDate || !startTime || !minutes) return { date: '', time: '' };
      
      // Parse start date as local time (WIB) by appending timezone offset
      const start = new Date(`${startDate}T${startTime}:00+07:00`);
      const end = new Date(start.getTime() + minutes * 60000);
      
      // Format date as YYYY-MM-DD in WIB
      const endDate = end.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      // Format time as HH:MM in WIB  
      const endTime = end.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit' });
      
      return { date: endDate, time: endTime };
    }
    
    // Legacy function for backward compatibility (used in other parts)
    function getDurationMinutes(startTime, endTime) {
      if (!startTime || !endTime) return 0;
      const [startH, startM] = startTime.split(':').map(Number);
      const [endH, endM] = endTime.split(':').map(Number);
      let startMinutes = startH * 60 + startM;
      let endMinutes = endH * 60 + endM;
      // Handle crossing midnight
      if (endMinutes < startMinutes) {
        endMinutes += 24 * 60;
      }
      return endMinutes - startMinutes;
    }
    
    // Legacy function for backward compatibility
    function addMinutesToTime(timeStr, minutes) {
      if (!timeStr || !minutes) return '';
      const [h, m] = timeStr.split(':').map(Number);
      let totalMinutes = h * 60 + m + parseInt(minutes);
      totalMinutes = totalMinutes % (24 * 60); // Wrap around 24h
      const newH = Math.floor(totalMinutes / 60);
      const newM = totalMinutes % 60;
      return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
    }
    
    // When duration changes, update end date and time
    function updateEndDateTimeFromDuration() {
      const startDate = document.getElementById('scheduleDate').value;
      const startTime = document.getElementById('scheduleTime').value;
      const durationSelect = document.getElementById('scheduleDuration').value;
      let duration = 0;
      
      if (durationSelect === 'custom') {
        duration = parseInt(document.getElementById('scheduleDurationCustom').value) || 0;
      } else {
        duration = parseInt(durationSelect) || 0;
      }
      
      if (startDate && startTime && duration > 0) {
        const result = addMinutesToDateTime(startDate, startTime, duration);
        document.getElementById('scheduleEndDate').value = result.date;
        document.getElementById('scheduleEndTime').value = result.time;
      }
    }
    
    // When end date/time changes, update duration
    function updateDurationFromEndDateTime() {
      const startDate = document.getElementById('scheduleDate').value;
      const startTime = document.getElementById('scheduleTime').value;
      const endDate = document.getElementById('scheduleEndDate').value;
      const endTime = document.getElementById('scheduleEndTime').value;
      
      if (startDate && startTime && endDate && endTime) {
        const duration = getDurationMinutesWithDate(startDate, startTime, endDate, endTime);
        if (duration > 0) {
          const durationSelect = document.getElementById('scheduleDuration');
          const customInput = document.getElementById('scheduleDurationCustom');
          const customLabel = document.getElementById('customDurationLabel');
          
          // Check if duration matches preset options
          const presetOptions = [60, 120, 180, 240, 300];
          if (presetOptions.includes(duration)) {
            durationSelect.value = duration.toString();
            customInput.style.display = 'none';
            customLabel.style.color = 'var(--ps3-muted)';
          } else {
            durationSelect.value = 'custom';
            customInput.style.display = 'block';
            customInput.value = duration;
            customLabel.style.color = 'var(--ps3-text)';
          }
        }
      }
    }
    
    async function addSchedule() {
      const customer = document.getElementById('scheduleCustomer').value.trim();
      const phone = document.getElementById('schedulePhone').value.trim();
      const date = document.getElementById('scheduleDate').value;
      const time = document.getElementById('scheduleTime').value;
      const endDate = document.getElementById('scheduleEndDate').value;
      const endTime = document.getElementById('scheduleEndTime').value;
      const stationId = document.getElementById('scheduleUnit').value;
      const durationSelect = document.getElementById('scheduleDuration').value;
      const durationCustom = document.getElementById('scheduleDurationCustom').value;
      const note = document.getElementById('scheduleNote').value.trim();
      
      // Validasi kolom wajib
      if (!customer) {
        showToast('Nama pelanggan wajib diisi', 'error');
        document.getElementById('scheduleCustomer').focus();
        return;
      }
      if (!date) {
        showToast('Tanggal mulai wajib dipilih', 'error');
        document.getElementById('scheduleDate').focus();
        return;
      }
      if (!time) {
        showToast('Jam mulai wajib dipilih', 'error');
        document.getElementById('scheduleTime').focus();
        return;
      }
      if (!endDate) {
        showToast('Tanggal berakhir wajib dipilih', 'error');
        document.getElementById('scheduleEndDate').focus();
        return;
      }
      if (!endTime) {
        showToast('Jam berakhir wajib dipilih', 'error');
        document.getElementById('scheduleEndTime').focus();
        return;
      }
      if (!stationId) {
        showToast('Stasiun wajib dipilih', 'error');
        document.getElementById('scheduleUnit').focus();
        return;
      }
      
      // Hitung durasi dari tanggal dan jam
      let duration = getDurationMinutesWithDate(date, time, endDate, endTime);
      if (duration < 30) {
        showToast('Durasi minimal 30 menit', 'error');
        return;
      }
      
      const stationName = stations.find(s => s.id === stationId)?.name || '';
      
      try {
        await api('POST', '/schedules', {
          customer,
          phone,
          unitId: stationId || null,
          unitName: stationName,
          scheduledDate: date,
          scheduledTime: time,
          scheduledEndDate: endDate,
          scheduledEndTime: endTime,
          duration,
          note
        });
        
        // Clear form
        document.getElementById('scheduleCustomer').value = '';
        document.getElementById('schedulePhone').value = '';
        document.getElementById('scheduleDate').value = '';
        document.getElementById('scheduleTime').value = '';
        document.getElementById('scheduleEndDate').value = '';
        document.getElementById('scheduleEndTime').value = '';
        document.getElementById('scheduleUnit').value = '';
        document.getElementById('scheduleDuration').value = '120';
        document.getElementById('scheduleDurationCustom').style.display = 'none';
        document.getElementById('scheduleDurationCustom').value = '';
        document.getElementById('customDurationLabel').style.color = 'var(--ps3-muted)';
        document.getElementById('scheduleNote').value = '';
        
        await loadSchedules();
        renderSchedules();
        closeModal('modalAddSchedule');
        showToast('Jadwal booking ditambahkan', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    async function loadSchedules() {
      try {
        const response = await api('GET', '/schedules');
        // API returns { ok: true, schedules: [...] }
        // Extract schedules array from response
        if (response && response.ok && Array.isArray(response.schedules)) {
          schedules = response.schedules;
        } else if (Array.isArray(response)) {
          // Fallback if API returns array directly
          schedules = response;
        } else {
          schedules = [];
        }
      } catch (error) {
        console.error('Failed to load schedules:', error);
        schedules = [];
      }
    }

    // State untuk toggle view schedule
    let showAllSchedules = false;

    function getTimeUntil(dateStr, timeStr) {
      // Use global clock for consistent time calculations
      const now = globalClock.now || new Date();
      const scheduled = new Date(dateStr + 'T' + (timeStr || '00:00'));
      const diffMs = scheduled - now;
      
      if (diffMs <= 0) return null;
      
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      
      if (hours > 0) {
        return minutes > 0 ? `Dalam ${hours} jam ${minutes} menit` : `Dalam ${hours} jam`;
      }
      return `Dalam ${minutes} menit`;
    }

    function getMinutesUntil(dateStr, timeStr) {
      // Use global clock for consistent time calculations
      const now = globalClock.now || new Date();
      const scheduled = new Date(dateStr + 'T' + (timeStr || '00:00'));
      const diffMs = scheduled - now;
      return Math.ceil(diffMs / (1000 * 60));
    }

    function getDaysUntil(dateStr) {
      // Use global clock for consistent time calculations
      const now = globalClock.now || new Date();
      now.setHours(0, 0, 0, 0);
      const scheduled = new Date(dateStr);
      scheduled.setHours(0, 0, 0, 0);
      
      const diffDays = Math.ceil((scheduled - now) / (1000 * 60 * 60 * 24));
      
      if (diffDays <= 0) return null;
      if (diffDays === 1) return 'Dalam 1 hari';
      if (diffDays === 2) return 'Dalam 2 hari';
      return `Dalam ${diffDays} hari`;
    }

    function isScheduleRunning(s) {
      // Use global clock for consistent time calculations
      const now = globalClock.now || new Date();
      const startTime = new Date(s.scheduledDate + 'T' + (s.scheduledTime || '00:00'));
      let endTime;
      
      if (s.scheduledEndTime) {
        endTime = new Date(s.scheduledDate + 'T' + s.scheduledEndTime);
      } else if (s.scheduledTime && s.duration) {
        // Calculate end time from duration
        const [hours, minutes] = s.scheduledTime.split(':').map(Number);
        endTime = new Date(s.scheduledDate + 'T' + s.scheduledTime);
        endTime.setMinutes(endTime.getMinutes() + parseInt(s.duration));
      } else {
        return false;
      }
      
      return now >= startTime && now <= endTime;
    }

    function getScheduleHighlight(s) {
      // Use global clock for consistent time calculations
      const now = globalClock.now || new Date();
      const today = now.toISOString().split('T')[0];
      const isToday = s.scheduledDate === today;
      
      // Helper: get overdue time (for pending missed)
      function getOverdueTime() {
        const scheduled = new Date(s.scheduledDate + 'T' + (s.scheduledTime || '00:00'));
        const diffMs = now - scheduled;
        if (diffMs <= 0) return null;
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        return hours > 0 || minutes > 0;
      }
      
      // Helper: get overtime (for running schedules)
      function hasOvertime() {
        if (s.unitId && Array.isArray(units)) {
          const unit = units.find(u => u.id == s.unitId && u.active);
          if (unit && unit.startTime && unit.duration) {
            const endTime = new Date(unit.startTime + (unit.duration * 60000));
            return now > endTime;
          }
        }
        // Fallback: gunakan data jadwal
        if (s.scheduledEndTime) {
          const endTime = new Date(s.scheduledDate + 'T' + s.scheduledEndTime);
          return now > endTime;
        } else if (s.scheduledTime && s.duration) {
          const endTime = new Date(s.scheduledDate + 'T' + s.scheduledTime);
          endTime.setMinutes(endTime.getMinutes() + parseInt(s.duration));
          return now > endTime;
        }
        return false;
      }
      
      // Helper: get minutes until start
      function getMinutesUntil() {
        if (!s.scheduledTime) return null;
        const startTime = new Date(s.scheduledDate + 'T' + s.scheduledTime);
        const diffMs = startTime - now;
        if (diffMs <= 0) return null;
        return Math.floor(diffMs / (1000 * 60));
      }
      
      // 5. Deleted -> Red (using badge shade for consistency)
      if (s.status === 'deleted') {
        return { bg: 'rgba(220, 38, 38, 0.15)', border: 'var(--ps3-red-badge)' };
      }
      
      // 4. Cancelled -> Red (using badge shade for consistency)
      if (s.status === 'cancelled') {
        return { bg: 'rgba(220, 38, 38, 0.15)', border: 'var(--ps3-red-badge)' };
      }
      
      // 3. Completed -> Dark Green (match badge)
      if (s.status === 'completed') {
        return { bg: 'rgba(34, 139, 34, 0.15)', border: 'var(--ps3-green-dark)' };
      }
      
      // 2. Running -> Check overtime first
      if (s.status === 'running') {
        if (hasOvertime()) {
          // Running overtime -> Red (match badge)
          return { bg: 'rgba(220, 38, 38, 0.15)', border: 'var(--ps3-red-badge)' };
        }
        // Running on time -> Green (match badge)
        return { bg: 'rgba(74, 222, 128, 0.15)', border: 'var(--ps3-green)' };
      }
      
      // 1. Pending (including missed/terlewat)
      if (s.status === 'pending') {
        const startTime = new Date(s.scheduledDate + 'T' + (s.scheduledTime || '00:00'));
        
        // Pending + Start time passed (Missed) -> Red (match badge)
        if (now > startTime && getOverdueTime()) {
          return { bg: 'rgba(220, 38, 38, 0.15)', border: 'var(--ps3-red-badge)' };
        }
        
        // Pending + Within 5 minutes -> Orange (match badge)
        if (isToday) {
          const minutesUntil = getMinutesUntil();
          if (minutesUntil !== null && minutesUntil <= 5 && minutesUntil > 0) {
            return { bg: 'rgba(255, 165, 0, 0.15)', border: 'var(--ps3-orange)' };
          }
        }
        
        // Pending + Normal -> Yellow (match badge)
        return { bg: 'rgba(255, 255, 0, 0.15)', border: 'var(--ps3-yellow)' };
      }
      
      // Fallback
      return { bg: 'var(--ps3-surface)', border: 'var(--ps3-border)' };
    }

    function getScheduleStatusBadge(s) {
      // Use global clock for consistent time calculations
      const now = globalClock.now || new Date();
      const today = now.toISOString().split('T')[0];
      const isToday = s.scheduledDate === today;
      const isPast = s.scheduledDate < today;
      
      // Helper: get overdue time
      function getOverdueTime(dateStr, timeStr) {
        const scheduled = new Date(dateStr + 'T' + (timeStr || '00:00'));
        const diffMs = now - scheduled;
        if (diffMs <= 0) return null;
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 0) {
          return minutes > 0 ? `${hours} jam ${minutes} menit` : `${hours} jam`;
        }
        return `${minutes} menit`;
      }
      
      // Helper: get overtime (for running schedules)
      // Gunakan data unit yang aktual untuk perhitungan yang akurat
      function getOvertime() {
        // Prioritaskan data unit yang sedang aktif
        if (s.unitId && Array.isArray(units)) {
          const unit = units.find(u => u.id == s.unitId && u.active);
          if (unit && unit.startTime && unit.duration) {
            const endTime = new Date(unit.startTime + (unit.duration * 60000));
            const diffMs = now - endTime;
            if (diffMs <= 0) return null;
            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            if (hours > 0) {
              return minutes > 0 ? `${hours} jam ${minutes} menit` : `${hours} jam`;
            }
            return `${minutes} menit`;
          }
        }
        // Fallback: gunakan data jadwal
        let endTime;
        if (s.scheduledEndTime) {
          endTime = new Date(s.scheduledDate + 'T' + s.scheduledEndTime);
        } else if (s.scheduledTime && s.duration) {
          endTime = new Date(s.scheduledDate + 'T' + s.scheduledTime);
          endTime.setMinutes(endTime.getMinutes() + parseInt(s.duration));
        } else {
          return null;
        }
        const diffMs = now - endTime;
        if (diffMs <= 0) return null;
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 0) {
          return minutes > 0 ? `${hours} jam ${minutes} menit` : `${hours} jam`;
        }
        return `${minutes} menit`;
      }
      
      // 5. Deleted -> Red badge (distinct shade), "🗑 Dibatalkan"
      if (s.status === 'deleted') {
        return { text: '🗑️ Dibatalkan', bg: 'var(--ps3-red-badge)', color: '#fff' };
      }
      
      // 4. Cancelled -> Red badge (distinct shade), "❌ Dibatalkan"
      if (s.status === 'cancelled') {
        return { text: '❌ Dibatalkan', bg: 'var(--ps3-red-badge)', color: '#fff' };
      }
      
      // 3. Completed -> Dark green badge, "✅ Selesai"
      if (s.status === 'completed') {
        return { text: '✅ Selesai', bg: 'var(--ps3-green-dark)', color: '#fff' };
      }
      
      // Helper: get remaining time (for running schedules)
      // Gunakan data unit yang aktual (waktu mulai sebenarnya saat user klik tombol Mulai)
      function getRemainingTime() {
        // Cari unit yang terkait dengan schedule ini
        if (s.unitId && Array.isArray(units)) {
          const unit = units.find(u => u.id == s.unitId && u.active);
          if (unit && unit.startTime && unit.duration) {
            const endTime = new Date(unit.startTime + (unit.duration * 60000));
            const remainingMs = endTime - now;
            if (remainingMs <= 0) return null;
            const hours = Math.floor(remainingMs / (1000 * 60 * 60));
            const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
            if (hours > 0) {
              return minutes > 0 ? `${hours} jam ${minutes} menit` : `${hours} jam`;
            }
            return `${minutes} menit`;
          }
        }
        // Fallback: gunakan data jadwal jika unit tidak ditemukan
        if (!s.scheduledTime || !s.duration) return null;
        const startTime = new Date(s.scheduledDate + 'T' + s.scheduledTime);
        const endTime = new Date(startTime.getTime() + parseInt(s.duration) * 60000);
        const remainingMs = endTime - now;
        if (remainingMs <= 0) return null;
        const hours = Math.floor(remainingMs / (1000 * 60 * 60));
        const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 0) {
          return minutes > 0 ? `${hours} jam ${minutes} menit` : `${hours} jam`;
        }
        return `${minutes} menit`;
      }

      // 2a. Running + Overtime -> Red badge (distinct shade), "🆘 Melebihi waktu X jam X menit"
      if (s.status === 'running') {
        const overtime = getOvertime();
        if (overtime) {
          return { text: `🆘 Melebihi waktu ${overtime}`, bg: 'var(--ps3-red-badge)', color: '#fff' };
        }
        // Running on time -> Green badge, "🔥 Sisa X jam Y menit"
        const remaining = getRemainingTime();
        if (remaining) {
          return { text: `🔥 Sisa ${remaining}`, bg: 'var(--ps3-green)', color: '#000' };
        }
        // Fallback if no duration set
        return { text: '🔥 Berjalan', bg: 'var(--ps3-green)', color: '#000' };
      }
      
      // 2b. Pending + Start time passed (Missed) -> Red badge (distinct shade), "⛔️ Terlewat X jam X menit"
      if (s.status === 'pending') {
        const startTime = new Date(s.scheduledDate + 'T' + (s.scheduledTime || '00:00'));
        if (now > startTime) {
          const overdue = getOverdueTime(s.scheduledDate, s.scheduledTime);
          if (overdue) {
            return { text: `⛔️ Terlewat ${overdue}`, bg: 'var(--ps3-red-badge)', color: '#fff' };
          }
        }
        
        // Pending + Within 5 minutes -> Orange
        // Pending + Normal -> Yellow
        const minutesUntil = getMinutesUntil(s.scheduledDate, s.scheduledTime);
        const isUrgent = minutesUntil !== null && minutesUntil <= 5 && minutesUntil > 0;
        
        let countText;
        if (isToday) {
          const timeUntil = getTimeUntil(s.scheduledDate, s.scheduledTime);
          countText = timeUntil || '⏰ Segera';
        } else {
          const daysUntil = getDaysUntil(s.scheduledDate);
          countText = daysUntil || '📅 Mendatang';
        }
        
        return {
          text: isUrgent ? `⏰ ${countText}` : `⏳ ${countText}`,
          bg: isUrgent ? 'var(--ps3-orange)' : 'var(--ps3-yellow)',
          color: isUrgent ? '#fff' : '#000'
        };
      }
      
      // Fallback - should not reach here
      return { text: '⏳ Menunggu', bg: 'var(--ps3-yellow)', color: '#000' };
    }

    function renderSchedules() {
      const container = document.getElementById('scheduleList');
      if (!container) return;
      
      // Ensure schedules is always an array
      if (!Array.isArray(schedules)) {
        schedules = [];
      }
      
      if (schedules.length === 0) {
        container.innerHTML = '<p class="empty-state-p20">Belum ada jadwal booking</p>';
        return;
      }
      
      // Use global clock for consistent time calculations
      const now = globalClock.now || new Date();
      const today = now.toISOString().split('T')[0];
      
      // Sort by time closest to now (upcoming first, then past)
      const sorted = [...schedules].sort((a, b) => {
        const dateTimeA = new Date(a.scheduledDate + 'T' + (a.scheduledTime || '00:00'));
        const dateTimeB = new Date(b.scheduledDate + 'T' + (b.scheduledTime || '00:00'));
        const diffA = dateTimeA - now;
        const diffB = dateTimeB - now;
        
        // If both are in future or both in past, sort by absolute difference
        if ((diffA >= 0 && diffB >= 0) || (diffA < 0 && diffB < 0)) {
          return Math.abs(diffA) - Math.abs(diffB);
        }
        // Future comes before past
        return diffB - diffA;
      });
      
      // Filter out completed schedules - they only appear in History modal
      const activeSchedules = sorted.filter(s => s.status !== 'completed');
      
      // Selalu filter hanya jadwal hari ini di halaman utama
      const filtered = activeSchedules.filter(s => s.scheduledDate === today);
      
      // Count other schedules (non-today) untuk tombol "Lihat Semua"
      const otherSchedules = activeSchedules.filter(s => s.scheduledDate !== today);
      
      let html = '';
      
      // Card untuk hari ini (exclude completed)
      if (filtered.length === 0) {
        html += '<p class="empty-state-p20">Tidak ada jadwal untuk hari ini</p>';
      }
      
      html += filtered.map((s, index) => {
        const highlight = getScheduleHighlight(s);
        const badge = getScheduleStatusBadge(s);
        const nomor = index + 1;

        return `
          <div style="background: ${highlight.bg}; border: 2px solid ${highlight.border}; border-radius: 10px; padding: 12px; margin-bottom: 10px; position: relative;">
            <div style="position: absolute; top: -8px; left: 10px; background: var(--ps3-red); color: #fff; font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; z-index: 1;">${nomor}</div>
            <div class="card-row-between-start">
              <div>
                <div class="info-row">
                  <span class="fw-700 text-primary">${s.customer}</span>
                  ${s.scheduleId ? `
                    <span class="tx-id-label">TX ID:</span>
                    <span onclick="copyToClipboard('${s.scheduleId}')" class="tx-id-badge" title="Klik untuk copy ID" class="fs-75">${s.scheduleId}</span>
                  ` : ''}
                </div>
                ${s.phone ? `<div class="fs-8 text-muted mt-2">📞 ${s.phone}</div>` : ''}
              </div>
              <span style="font-size: 0.75rem; padding: 5px 10px; border-radius: 6px; background: ${badge.bg}; color: ${badge.color}; font-weight: 600; white-space: nowrap;">${badge.text}</span>
            </div>
            <div class="text-85 text-muted mb-2px">
              ${formatScheduleDate(s)}
            </div>
            <div class="fs-85 text-primary fw-600 mb-6">
              ${formatScheduleTime(s)}
            </div>
            ${s.unitName ? `<div class="label-xs-muted" class="mb-4">🎮 ${s.unitName} ${s.status === 'running' ? '<span style="color: var(--ps3-green); font-size: 0.7rem;">● AKTIF</span>' : ''}</div>` : ''}
            ${s.note ? `<div class="fs-8 text-muted italic mt-4">💬 ${s.note}</div>` : ''}
            ${s.status === 'running' ? `<div style="font-size: 0.75rem; color: var(--ps3-green); margin-top: 6px; padding: 4px 8px; background: rgba(119,221,119,0.1); border-radius: 4px; border: 1px solid rgba(119,221,119,0.3);">▶️ Sedang berjalan di unit</div>` : ''}
            <div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">
              ${s.status === 'pending' ? `
                <button onclick="startSchedule(${s.id})" style="background: var(--ps3-green); color: #000; border: none; padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='var(--ps3-green-dark)'" onmouseout="this.style.background='var(--ps3-green)'">▶️ Mulai</button>
                <button onclick="openCancelScheduleModal(${s.id})" class="btn-surface-danger px-12 py-6 br-6 fs-75 fw-600 cursor-pointer" onmouseover="this.style.background='var(--ps3-red-danger)';this.style.color='#fff'" onmouseout="this.style.background='var(--ps3-surface)';this.style.color='var(--ps3-red-danger)'">❌ Batal</button>
              ` : ''}
              ${s.status === 'running' ? `
                <button onclick="updateScheduleStatus(${s.id}, 'completed')" style="background: var(--ps3-green-dark); color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='var(--ps3-green)'" onmouseout="this.style.background='var(--ps3-green-dark)'">✅ Selesai</button>
                <button onclick="openCancelScheduleModal(${s.id})" class="btn-surface-danger px-12 py-6 br-6 fs-75 fw-600 cursor-pointer" onmouseover="this.style.background='var(--ps3-red-danger)';this.style.color='#fff'" onmouseout="this.style.background='var(--ps3-surface)';this.style.color='var(--ps3-red-danger)'">❌ Batal</button>
              ` : ''}
              ${s.status === 'pending' || s.status === 'running' ? `<button onclick="openEditScheduleModal(${s.id})" style="background: var(--ps3-surface); color: var(--ps3-yellow); border: 1px solid var(--ps3-yellow); padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='var(--ps3-yellow)';this.style.color='#000'" onmouseout="this.style.background='var(--ps3-surface)';this.style.color='var(--ps3-yellow)'">✏️ Edit</button>` : ''}
              ${s.editCount > 0 ? `<button onclick="openScheduleHistoryModal(${s.id})" style="background: var(--ps3-surface); color: var(--ps3-silver); border: 1px solid var(--ps3-border); padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='var(--ps3-blue)';this.style.color='#fff'" onmouseout="this.style.background='var(--ps3-surface)';this.style.color='var(--ps3-silver)'">📜 Riwayat Edit</button>` : ''}
            </div>
          </div>
        `;
      }).join('');
      
      container.innerHTML = html;
      
      // Render tombol "Lihat Semua Jadwal" di LUAR area scroll
      renderViewAllButton(otherSchedules.length, activeSchedules.length);
    }

    function toggleShowAllSchedules() {
      showAllSchedules = !showAllSchedules;
      renderSchedules();
    }

    // ═════════════════ View All Button (Outside Scroll Area) ═════════════════
    function renderViewAllButton(otherCount, totalActive) {
      const container = document.getElementById('scheduleViewAllContainer');
      if (!container) return;
      
      if (otherCount > 0) {
        container.innerHTML = `
          <button onclick="openScheduleCalendarModal()" class="btn-view-all" style="width: 100%; background: linear-gradient(135deg, var(--ps3-surface) 0%, var(--ps3-card) 100%); border: 1px solid var(--ps3-border); color: var(--ps3-silver); padding: 14px 18px; border-radius: 12px; font-size: 0.9rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 -2px 8px rgba(230,0,18,0.1); transition: all 0.3s ease;">
            <span style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: rgba(230,0,18,0.15); border-radius: 8px; color: var(--ps3-red);">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
            </span>
            <span style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px;">
              <span class="font-semibold text-primary">Lihat Semua Jadwal</span>
              <span class="text-75 text-muted">${totalActive} jadwal aktif</span>
            </span>
            <span style="margin-left: auto; display: flex; align-items: center; color: var(--ps3-red);">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </span>
          </button>
        `;
        container.style.display = 'block';
      } else {
        container.innerHTML = '';
        container.style.display = 'none';
      }
    }

    // ═════════════════ Schedule Calendar Modal Functions ═════════════════
    let calendarFilter = { year: null, month: null, date: null };
    let calendarSearch = { txId: '', customer: '', unit: '' };

    function openScheduleCalendarModal() {
      calendarFilter = { year: null, month: null, date: null };
      calendarSearch = { txId: '', customer: '', unit: '', isCustomUnit: false };
      // Reset search inputs
      document.getElementById('calendarSearchTxId').value = '';
      document.getElementById('calendarFilterCustomer').value = '';
      document.getElementById('calendarCustomerSuggestions').style.display = 'none';
      // Reset unit filter to dropdown (not custom input)
      const unitSelect = document.getElementById('calendarFilterUnit');
      const customUnitInput = document.getElementById('calendarFilterUnitCustom');
      unitSelect.value = '';
      unitSelect.style.display = 'block';
      customUnitInput.value = '';
      customUnitInput.style.display = 'none';
      document.getElementById('calendarSearchActions').style.display = 'none';
      buildScheduleCalendar();
      openModal('modalScheduleCalendar');
    }

    // ═════════════════ Calendar Search & Filter Handlers ═════════════════
    function handleCalendarSearch() {
      const txIdInput = document.getElementById('calendarSearchTxId');
      const customerInput = document.getElementById('calendarFilterCustomer');
      const unitSelect = document.getElementById('calendarFilterUnit');
      const customUnitInput = document.getElementById('calendarFilterUnitCustom');
      const searchActions = document.getElementById('calendarSearchActions');

      calendarSearch.txId = txIdInput.value.trim().toLowerCase();
      calendarSearch.customer = customerInput.value.trim(); // Text input value
      
      // Check if using custom unit input
      if (unitSelect.value === '__CUSTOM__' && customUnitInput.style.display !== 'none') {
        calendarSearch.unit = customUnitInput.value.trim(); // Use custom input value
        calendarSearch.isCustomUnit = true;
      } else {
        calendarSearch.unit = unitSelect.value;
        calendarSearch.isCustomUnit = false;
      }

      // Show/hide clear button
      const hasSearch = calendarSearch.txId || calendarSearch.customer || calendarSearch.unit;
      searchActions.style.display = hasSearch ? 'block' : 'none';

      // Re-render schedules with search filters
      filterCalendarSchedules();
    }

    function clearCalendarSearch() {
      calendarSearch = { txId: '', customer: '', unit: '', isCustomUnit: false };
      document.getElementById('calendarSearchTxId').value = '';
      document.getElementById('calendarFilterCustomer').value = '';
      document.getElementById('calendarCustomerSuggestions').style.display = 'none';
      
      // Reset unit filter to dropdown
      const unitSelect = document.getElementById('calendarFilterUnit');
      const customUnitInput = document.getElementById('calendarFilterUnitCustom');
      unitSelect.value = '';
      unitSelect.style.display = 'block';
      customUnitInput.value = '';
      customUnitInput.style.display = 'none';
      
      document.getElementById('calendarSearchActions').style.display = 'none';
      filterCalendarSchedules();
    }

    // Store unique customers for calendar autocomplete
    let calendarUniqueCustomers = [];

    function buildCalendarFilterOptions(activeSchedules) {
      // Extract unique customers and units
      const customers = new Set();
      const units = new Set();

      activeSchedules.forEach(s => {
        if (s.customer) customers.add(s.customer);
        if (s.unitName) units.add(s.unitName);
      });

      // Sort alphabetically
      calendarUniqueCustomers = Array.from(customers).sort();
      const sortedUnits = Array.from(units).sort();

      // Build unit options (preserve Custom option)
      const unitSelect = document.getElementById('calendarFilterUnit');
      const currentUnit = unitSelect.value;
      const isCustomActive = currentUnit === '__CUSTOM__';
      
      let unitHtml = '<option value="">🎮 Semua Unit</option>';
      sortedUnits.forEach(unit => {
        const isSelected = currentUnit === unit ? 'selected' : '';
        unitHtml += `<option value="${escapeHtml(unit)}" ${isSelected}>${escapeHtml(unit)}</option>`;
      });
      // Add Custom option (always last)
      unitHtml += `<option value="__CUSTOM__" ${isCustomActive ? 'selected' : ''}>✏️ Custom...</option>`;
      unitSelect.innerHTML = unitHtml;
    }

    // ═════════════════ Calendar Unit Custom Input Handler ═════════════════
    function onCalendarUnitChange() {
      const unitSelect = document.getElementById('calendarFilterUnit');
      const customInput = document.getElementById('calendarFilterUnitCustom');
      
      if (unitSelect.value === '__CUSTOM__') {
        // Show custom input, hide select
        unitSelect.style.display = 'none';
        customInput.style.display = 'block';
        customInput.focus();
        // Clear any previous custom value
        customInput.value = '';
      } else {
        // Hide custom input, show select
        customInput.style.display = 'none';
        unitSelect.style.display = 'block';
        handleCalendarSearch();
      }
    }

    // ═════════════════ Calendar Customer Autocomplete ═════════════════
    let calendarCustomerAutocompleteTimer = null;

    function onCalendarCustomerInput() {
      // Show suggestions immediately with fresh highlight
      showCalendarCustomerSuggestions();

      // Debounce the actual search
      if (calendarCustomerAutocompleteTimer) {
        clearTimeout(calendarCustomerAutocompleteTimer);
      }
      calendarCustomerAutocompleteTimer = setTimeout(() => {
        handleCalendarSearch();
      }, 300);
    }

    function showCalendarCustomerSuggestions() {
      const input = document.getElementById('calendarFilterCustomer');
      const dropdown = document.getElementById('calendarCustomerSuggestions');
      const value = input.value.trim().toLowerCase();

      // Filter customers that match input (case-insensitive)
      const matches = value
        ? calendarUniqueCustomers.filter(c => c.toLowerCase().includes(value))
        : calendarUniqueCustomers.slice(0, 10); // Show first 10 if empty

      if (matches.length === 0) {
        dropdown.innerHTML = '<div class="suggestion-empty">Tidak ada hasil</div>';
      } else {
        dropdown.innerHTML = matches.map(customer => {
          // Highlight matching portion
          let display = escapeHtml(customer);
          if (value) {
            const regex = new RegExp(`(${escapeHtml(value)})`, 'gi');
            display = display.replace(regex, '<mark>$1</mark>');
          }
          return `<div class="suggestion-item" onclick="selectCalendarCustomer('${escapeHtml(customer)}')">${display}</div>`;
        }).join('');
      }

      dropdown.style.display = 'block';
    }

    function selectCalendarCustomer(customer) {
      document.getElementById('calendarFilterCustomer').value = customer;
      document.getElementById('calendarCustomerSuggestions').style.display = 'none';
      handleCalendarSearch();
    }

    function hideCalendarCustomerSuggestions() {
      document.getElementById('calendarCustomerSuggestions').style.display = 'none';
    }

    // Hide suggestions when clicking outside
    document.addEventListener('click', function(e) {
      const input = document.getElementById('calendarFilterCustomer');
      const dropdown = document.getElementById('calendarCustomerSuggestions');
      if (input && dropdown && !input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });

    function escapeHtml(text) {
      if (!text) return '';
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function buildScheduleCalendar() {
      const activeSchedules = schedules.filter(s => s.status !== 'completed');

      // Build filter dropdown options (customers & units)
      buildCalendarFilterOptions(activeSchedules);

      // Extract unique years, months, and dates
      const yearSet = new Set();
      const monthSet = new Set();
      const dateMap = new Map(); // key: "year-month", value: Set of dates

      activeSchedules.forEach(s => {
        if (s.scheduledDate) {
          const d = new Date(s.scheduledDate + 'T00:00:00');
          const year = d.getFullYear();
          const month = d.getMonth(); // 0-11
          const date = d.getDate();
          const dayName = d.toLocaleDateString('id-ID', { weekday: 'short' });

          yearSet.add(year);
          monthSet.add(month);

          const key = `${year}-${month}`;
          if (!dateMap.has(key)) {
            dateMap.set(key, new Set());
          }
          dateMap.get(key).add({ date, dayName, fullDate: s.scheduledDate });
        }
      });

      // Sort years ascending (terkecil ke terbesar)
      const years = Array.from(yearSet).sort((a, b) => a - b);

      // Sort months ascending
      const months = Array.from(monthSet).sort((a, b) => a - b);

      // Render Years (dengan tombol SEMUA tanpa emoji di paling kiri)
      const yearsContainer = document.getElementById('calendarYears');
      const allYearsActive = calendarFilter.year === null && calendarFilter.month === null && calendarFilter.date === null;
      let yearsHtml = `
        <button onclick="selectCalendarYear(null)" 
          style="padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; cursor: pointer;
            background: ${allYearsActive ? 'var(--ps3-red)' : 'var(--ps3-surface)'}; 
            color: ${allYearsActive ? '#fff' : 'var(--ps3-text)'}; 
            border: 1px solid ${allYearsActive ? 'var(--ps3-red)' : 'var(--ps3-border)'};">
          SEMUA
        </button>
      `;
      yearsHtml += years.map(year => {
        const isActive = calendarFilter.year === year;
        return `
          <button onclick="selectCalendarYear(${year})" 
            style="padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; cursor: pointer;
              background: ${isActive ? 'var(--ps3-red)' : 'var(--ps3-surface)'}; 
              color: ${isActive ? '#fff' : 'var(--ps3-text)'}; 
              border: 1px solid ${isActive ? 'var(--ps3-red)' : 'var(--ps3-border)'};">
            ${year}
          </button>
        `;
      }).join('');
      yearsContainer.innerHTML = yearsHtml;

      // Render Months (HANYA jika tahun sudah dipilih)
      const monthsContainer = document.getElementById('calendarMonths');
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      
      if (calendarFilter.year === null) {
        // Sembunyikan bulan jika belum pilih tahun
        monthsContainer.innerHTML = '';
      } else {
        // Get months that have schedules in the selected year
        const availableMonths = new Set();
        activeSchedules.forEach(s => {
          if (s.scheduledDate) {
            const d = new Date(s.scheduledDate + 'T00:00:00');
            const year = d.getFullYear();
            const month = d.getMonth();
            if (calendarFilter.year === year) {
              availableMonths.add(month);
            }
          }
        });
        
        monthsContainer.innerHTML = Array.from(availableMonths).sort((a, b) => a - b).map(month => {
          const isActive = calendarFilter.month === month;
          return `
            <button onclick="selectCalendarMonth(${month})" 
              style="padding: 8px 14px; border-radius: 8px; font-size: 0.85rem; cursor: pointer;
                background: ${isActive ? 'var(--ps3-red)' : 'var(--ps3-surface)'}; 
                color: ${isActive ? '#fff' : 'var(--ps3-text)'}; 
                border: 1px solid ${isActive ? 'var(--ps3-red)' : 'var(--ps3-border)'};">
              ${monthNames[month]}
            </button>
          `;
        }).join('');
      }

      // Render Dates (HANYA jika bulan sudah dipilih)
      const datesContainer = document.getElementById('calendarDates');
      
      if (calendarFilter.month === null) {
        // Sembunyikan tanggal jika belum pilih bulan
        datesContainer.innerHTML = '';
      } else {
        const availableDates = new Set();
        const dateInfoMap = new Map();
        
        activeSchedules.forEach(s => {
          if (s.scheduledDate) {
            const d = new Date(s.scheduledDate + 'T00:00:00');
            const year = d.getFullYear();
            const month = d.getMonth();
            const date = d.getDate();
            const dayName = d.toLocaleDateString('id-ID', { weekday: 'short' });
            
            const yearMatch = calendarFilter.year === year;
            const monthMatch = calendarFilter.month === month;
            
            if (yearMatch && monthMatch) {
              availableDates.add(s.scheduledDate);
              dateInfoMap.set(s.scheduledDate, { date, dayName });
            }
          }
        });

        // Sort dates ascending (terkecil ke terbesar)
        const sortedDates = Array.from(availableDates).sort((a, b) => new Date(a) - new Date(b));
        
        datesContainer.innerHTML = sortedDates.map(dateStr => {
          const info = dateInfoMap.get(dateStr);
          const isActive = calendarFilter.date === dateStr;
          return `
            <button onclick="selectCalendarDate('${dateStr}')" 
              style="padding: 8px 12px; border-radius: 8px; font-size: 0.8rem; cursor: pointer; min-width: 80px;
                background: ${isActive ? 'var(--ps3-red)' : 'var(--ps3-surface)'}; 
                color: ${isActive ? '#fff' : 'var(--ps3-text)'}; 
                border: 1px solid ${isActive ? 'var(--ps3-red)' : 'var(--ps3-border)'};">
              <div style="font-size: 0.65rem; opacity: 0.8; text-transform: uppercase;">${info.dayName}</div>
              <div class="fw-600">${info.date}</div>
            </button>
          `;
        }).join('');
      }

      // Update filter display
      updateCalendarFilterDisplay();
      
      // Render filtered schedules
      filterCalendarSchedules();
    }

    function selectCalendarYear(year) {
      if (year === null) {
        // Klik SEMUA - reset semua filter
        calendarFilter = { year: null, month: null, date: null };
      } else if (calendarFilter.year === year) {
        // Klik tahun yang sudah aktif - reset tahun dan turunannya
        calendarFilter.year = null;
        calendarFilter.month = null;
        calendarFilter.date = null;
      } else {
        // Klik tahun baru - set tahun, reset bulan dan tanggal
        calendarFilter.year = year;
        calendarFilter.month = null;
        calendarFilter.date = null;
      }
      buildScheduleCalendar();
    }

    function selectCalendarMonth(month) {
      if (calendarFilter.month === month) {
        // Klik bulan yang sudah aktif - reset bulan dan turunannya
        calendarFilter.month = null;
        calendarFilter.date = null;
      } else {
        // Klik bulan baru - set bulan, reset tanggal
        calendarFilter.month = month;
        calendarFilter.date = null;
      }
      buildScheduleCalendar();
    }

    function selectCalendarDate(dateStr) {
      calendarFilter.date = calendarFilter.date === dateStr ? null : dateStr;
      buildScheduleCalendar();
    }

    function clearCalendarFilter() {
      calendarFilter = { year: null, month: null, date: null };
      buildScheduleCalendar();
    }

    function updateCalendarFilterDisplay() {
      const filterContainer = document.getElementById('calendarActiveFilter');
      const filterText = document.getElementById('calendarFilterText');
      
      const hasFilter = calendarFilter.year !== null || calendarFilter.month !== null || calendarFilter.date !== null;
      
      if (hasFilter) {
        const parts = [];
        if (calendarFilter.year) parts.push(`Tahun ${calendarFilter.year}`);
        if (calendarFilter.month !== null) {
          const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 
                             'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
          parts.push(monthNames[calendarFilter.month]);
        }
        if (calendarFilter.date) {
          const d = new Date(calendarFilter.date + 'T00:00:00');
          parts.push(`${d.getDate()} ${d.toLocaleDateString('id-ID', { month: 'short' })}`);
        }
        
        filterText.textContent = parts.join(' + ');
        filterContainer.style.display = 'block';
      } else {
        filterContainer.style.display = 'none';
      }
    }

    function filterCalendarSchedules() {
      const listContainer = document.getElementById('calendarScheduleList');
      const countElement = document.getElementById('calendarResultCount');

      // Get active schedules (not completed)
      let filtered = schedules.filter(s => s.status !== 'completed');

      // Apply date filters
      if (calendarFilter.year) {
        filtered = filtered.filter(s => {
          if (!s.scheduledDate) return false;
          const d = new Date(s.scheduledDate + 'T00:00:00');
          return d.getFullYear() === calendarFilter.year;
        });
      }

      if (calendarFilter.month !== null) {
        filtered = filtered.filter(s => {
          if (!s.scheduledDate) return false;
          const d = new Date(s.scheduledDate + 'T00:00:00');
          return d.getMonth() === calendarFilter.month;
        });
      }

      if (calendarFilter.date) {
        filtered = filtered.filter(s => s.scheduledDate === calendarFilter.date);
      }

      // Apply search filters (TX ID, Customer, Unit)
      if (calendarSearch.txId) {
        const searchTerm = calendarSearch.txId.toLowerCase();
        filtered = filtered.filter(s => {
          const txIdMatch = s.scheduleId && s.scheduleId.toLowerCase().includes(searchTerm);
          return txIdMatch;
        });
      }

      if (calendarSearch.customer) {
        const searchCustomer = calendarSearch.customer.toLowerCase();
        filtered = filtered.filter(s => {
          const customerMatch = s.customer && s.customer.toLowerCase().includes(searchCustomer);
          return customerMatch;
        });
      }

      if (calendarSearch.unit) {
        const searchUnit = calendarSearch.unit.toLowerCase();
        filtered = filtered.filter(s => {
          const unitMatch = s.unitName && s.unitName.toLowerCase().includes(searchUnit);
          return unitMatch;
        });
      }

      // Sort by date then time
      filtered.sort((a, b) => {
        const dateA = new Date(a.scheduledDate + 'T' + (a.scheduledTime || '00:00'));
        const dateB = new Date(b.scheduledDate + 'T' + (b.scheduledTime || '00:00'));
        return dateA - dateB;
      });

      countElement.textContent = filtered.length;
      
      if (filtered.length === 0) {
        listContainer.innerHTML = '<p class="empty-state-p30">Tidak ada jadwal untuk filter ini</p>';
        return;
      }
      
      // Group by date
      const grouped = {};
      filtered.forEach(s => {
        if (!grouped[s.scheduledDate]) {
          grouped[s.scheduledDate] = [];
        }
        grouped[s.scheduledDate].push(s);
      });
      
      // Render grouped schedules
      let html = '';
      const today = new Date().toISOString().split('T')[0];
      let globalCounter = 0;

      Object.keys(grouped).sort().forEach(dateStr => {
        const date = new Date(dateStr + 'T00:00:00');
        const dayName = date.toLocaleDateString('id-ID', { weekday: 'long' });
        const dateFormatted = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        const isToday = dateStr === today;

        html += `
          <div class="mb-15">
            <div style="font-size: 0.8rem; color: ${isToday ? 'var(--ps3-green)' : 'var(--ps3-muted)'};
                        margin-bottom: 8px; padding: 6px 10px; background: var(--ps3-surface);
                        border-radius: 6px; font-weight: 600; ${isToday ? 'border: 1px solid var(--ps3-green);' : ''}">
              ${isToday ? '📌 ' : '📅 '}${dayName}, ${dateFormatted} ${isToday ? '(Hari Ini)' : ''}
            </div>
        `;

        grouped[dateStr].forEach(s => {
          globalCounter++;
          const badge = getScheduleStatusBadge(s);
          const highlight = getScheduleHighlight(s);
          
          html += `
            <div style="background: ${highlight.bg}; border: 2px solid ${highlight.border}; border-radius: 10px; padding: 12px; margin-bottom: 10px; position: relative;">
              <div style="position: absolute; top: -8px; left: 10px; background: var(--ps3-red); color: #fff; font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; z-index: 1;">${globalCounter}</div>
              <div class="card-row-between-start">
                <div>
                  <div class="info-row">
                    <span class="fw-700 text-primary">${s.customer}</span>
                    ${s.scheduleId ? `
                      <span class="tx-id-label">TX ID:</span>
                      <span onclick="copyToClipboard('${s.scheduleId}')" class="tx-id-badge" title="Klik untuk copy ID" class="fs-75">${s.scheduleId}</span>
                    ` : ''}
                  </div>
                  ${s.phone ? `<div class="fs-8 text-muted mt-2">📞 ${s.phone}</div>` : ''}
                </div>
                <span style="font-size: 0.75rem; padding: 5px 10px; border-radius: 6px; background: ${badge.bg}; color: ${badge.color}; font-weight: 600; white-space: nowrap;">${badge.text}</span>
              </div>
              <div class="text-85 text-muted mb-2px">
                ${formatScheduleDate(s)}
              </div>
              <div class="fs-85 text-primary fw-600 mb-6">
                ${formatScheduleTime(s)}
              </div>
              ${s.unitName ? `<div class="label-xs-muted" class="mb-4">🎮 ${s.unitName} ${s.status === 'running' ? '<span style="color: var(--ps3-green); font-size: 0.7rem;">● AKTIF</span>' : ''}</div>` : ''}
              ${s.note ? `<div class="fs-8 text-muted italic mt-4">💬 ${s.note}</div>` : ''}
              ${s.status === 'running' ? `<div style="font-size: 0.75rem; color: var(--ps3-green); margin-top: 6px; padding: 4px 8px; background: rgba(119,221,119,0.1); border-radius: 4px; border: 1px solid rgba(119,221,119,0.3);">▶️ Sedang berjalan di unit</div>` : ''}
              <div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">
                ${s.status === 'pending' ? `
                  <button onclick="startSchedule(${s.id})" style="background: var(--ps3-green); color: #000; border: none; padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='var(--ps3-green-dark)'" onmouseout="this.style.background='var(--ps3-green)'">▶️ Mulai</button>
                  <button onclick="openCancelScheduleModal(${s.id})" class="btn-surface-danger px-12 py-6 br-6 fs-75 fw-600 cursor-pointer" onmouseover="this.style.background='var(--ps3-red-danger)';this.style.color='#fff'" onmouseout="this.style.background='var(--ps3-surface)';this.style.color='var(--ps3-red-danger)'">❌ Batal</button>
                ` : ''}
                ${s.status === 'running' ? `
                  <button onclick="updateScheduleStatus(${s.id}, 'completed')" style="background: var(--ps3-green-dark); color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='var(--ps3-green)'" onmouseout="this.style.background='var(--ps3-green-dark)'">✅ Selesai</button>
                  <button onclick="openCancelScheduleModal(${s.id})" class="btn-surface-danger px-12 py-6 br-6 fs-75 fw-600 cursor-pointer" onmouseover="this.style.background='var(--ps3-red-danger)';this.style.color='#fff'" onmouseout="this.style.background='var(--ps3-surface)';this.style.color='var(--ps3-red-danger)'">❌ Batal</button>
                ` : ''}
                ${s.status === 'pending' || s.status === 'running' ? `<button onclick="openEditScheduleModal(${s.id})" style="background: var(--ps3-surface); color: var(--ps3-yellow); border: 1px solid var(--ps3-yellow); padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='var(--ps3-yellow)';this.style.color='#000'" onmouseout="this.style.background='var(--ps3-surface)';this.style.color='var(--ps3-yellow)'">✏️ Edit</button>` : ''}
                ${s.editCount > 0 ? `<button onclick="openScheduleHistoryModal(${s.id})" style="background: var(--ps3-surface); color: var(--ps3-silver); border: 1px solid var(--ps3-border); padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='var(--ps3-blue)';this.style.color='#fff'" onmouseout="this.style.background='var(--ps3-surface)';this.style.color='var(--ps3-silver)'">📜 Riwayat Edit</button>` : ''}
              </div>
            </div>
          `;
        });

        html += '</div>';
      });
      
      listContainer.innerHTML = html;
    }

    function getStatusColor(status) {
      const colors = {
        completed: 'var(--ps3-green)',
        cancelled: 'var(--ps3-red)',
        pending: 'var(--ps3-yellow)',
        overdue: '#ff6600'
      };
      return colors[status] || 'var(--ps3-muted)';
    }

    function formatDate(dateStr) {
      const date = new Date(dateStr);
      const options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
      return date.toLocaleDateString('id-ID', options);
    }

    /**
     * Format schedule DATE line only (for 2-line display)
     * Returns format like: "📆 Sab, 11 Apr 2026" or "📆 Sab - Min, 11 - 12 Apr 2026"
     */
    function formatScheduleDate(s) {
      const startDate = new Date(s.scheduledDate + 'T00:00:00');
      
      // Calculate end date
      let endDate;
      if (s.scheduledEndDate) {
        endDate = new Date(s.scheduledEndDate + 'T00:00:00');
      } else if (s.scheduledTime && s.duration) {
        const startDateTime = new Date(s.scheduledDate + 'T' + s.scheduledTime);
        endDate = new Date(startDateTime.getTime() + parseInt(s.duration) * 60000);
      } else {
        // No end date, show only start
        const dayName = startDate.toLocaleDateString('id-ID', { weekday: 'short' });
        const day = startDate.getDate();
        const month = startDate.toLocaleDateString('id-ID', { month: 'short' });
        const year = startDate.getFullYear();
        return `📆 ${dayName}, ${day} ${month} ${year}`;
      }
      
      // Check which components are same/different
      const sameDay = startDate.toDateString() === endDate.toDateString();
      const sameMonth = startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear();
      const sameYear = startDate.getFullYear() === endDate.getFullYear();
      
      // Format components
      const startDayName = startDate.toLocaleDateString('id-ID', { weekday: 'short' });
      const endDayName = endDate.toLocaleDateString('id-ID', { weekday: 'short' });
      const startDay = startDate.getDate();
      const endDay = endDate.getDate();
      const startMonth = startDate.toLocaleDateString('id-ID', { month: 'short' });
      const endMonth = endDate.toLocaleDateString('id-ID', { month: 'short' });
      const startYear = startDate.getFullYear();
      const endYear = endDate.getFullYear();
      
      if (sameDay) {
        // Same day
        return `📆 ${startDayName}, ${startDay} ${startMonth} ${startYear}`;
      } else if (sameMonth && sameYear) {
        // Different day, same month/year
        return `📆 ${startDayName} - ${endDayName}, ${startDay} - ${endDay} ${startMonth} ${startYear}`;
      } else if (sameYear) {
        // Different month, same year
        return `📆 ${startDayName} - ${endDayName}, ${startDay} ${startMonth} - ${endDay} ${endMonth} ${startYear}`;
      } else {
        // Different year
        return `📆 ${startDayName} - ${endDayName}, ${startDay} ${startMonth} ${startYear} - ${endDay} ${endMonth} ${endYear}`;
      }
    }

    /**
     * Format schedule TIME line only (for 2-line display)
     * Returns format like: "🕐 14:30 → 17:30 ⏰ 60 menit"
     */
    function formatScheduleTime(s) {
      const startTime = s.scheduledTime || '--:--';
      
      // Calculate or get end time
      let endTime;
      if (s.scheduledEndTime) {
        endTime = s.scheduledEndTime;
      } else if (s.scheduledTime && s.duration) {
        const startDateTime = new Date(s.scheduledDate + 'T' + s.scheduledTime);
        const endDateTime = new Date(startDateTime.getTime() + parseInt(s.duration) * 60000);
        endTime = endDateTime.toTimeString().slice(0, 5);
      } else {
        endTime = '--:--';
      }
      
      const durationText = s.duration ? `⏰ ${s.duration} menit` : '';
      return `🕐 ${startTime} → ${endTime} ${durationText}`;
    }

    /**
     * Calculate end time from start time and duration
     * Returns HH:mm format
     */
    function calculateEndTime(startTime, durationMinutes) {
      if (!startTime || !durationMinutes) return '--:--';
      const [hours, minutes] = startTime.split(':').map(Number);
      const start = new Date();
      start.setHours(hours, minutes, 0, 0);
      const end = new Date(start.getTime() + parseInt(durationMinutes) * 60000);
      return end.toTimeString().slice(0, 5);
    }

    async function updateScheduleStatus(id, status) {
      try {
        const schedule = schedules.find(s => s.id == id);
        
        // If completing a running schedule, show payment modal first (same as stopSession)
        if (status === 'completed' && schedule && schedule.status === 'running') {
          // Get linked unit info
          const unit = units.find(u => u.id === schedule.unitId);
          if (!unit || !unit.active) {
            showToast('Unit tidak aktif atau tidak ditemukan', 'error');
            return;
          }
          
          // Store schedule ID for confirmation
          currentCompleteScheduleId = id;
          
          // Populate modal with data (same calculation as stopSession)
          const elapsed = Math.floor((Date.now() - unit.startTime) / 60000);
          const cost = Math.round((elapsed / 60) * settings.ratePerHour);
          
          document.getElementById('completeScheduleUnitName').textContent = unit.name;
          document.getElementById('completeScheduleCustomer').textContent = unit.customer || '-';
          document.getElementById('completeScheduleDuration').textContent = `${elapsed} menit`;
          document.getElementById('completeScheduleCost').value = cost;
          document.getElementById('completeSchedulePaid').value = cost;
          document.getElementById('completeSchedulePayment').value = 'cash';
          
          openModal('modalCompleteSchedule');
          return;
        }
        
        // For non-running schedules, just update status directly
        await api('PUT', `/schedules/${id}`, { status });
        showToast(`Status jadwal diperbarui`, 'success');
        
        await loadData();
        await loadSchedules();
        renderAll();
        renderSchedules();
        filterCalendarSchedules();
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    async function confirmCompleteSchedule() {
      const paid = parseInt(document.getElementById('completeSchedulePaid').value) || 0;
      const payment = document.getElementById('completeSchedulePayment').value;
      
      try {
        await api('POST', `/schedules/${currentCompleteScheduleId}/complete`, { paid, payment });
        closeModal('modalCompleteSchedule');
        showToast('Jadwal selesai! Unit dihentikan dan transaksi tercatat.', 'success');
        
        await loadData();
        await loadSchedules();
        renderAll();
        renderSchedules();
        filterCalendarSchedules();
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    // ═════════════════ Cancel Schedule Modal Functions ═════════════════
    let currentCancelScheduleId = null;

    // ═════════════════ Complete Schedule Modal Functions ═════════════════
    let currentCompleteScheduleId = null;

    function openCancelScheduleModal(scheduleId) {
      const schedule = schedules.find(s => s.id == scheduleId);
      if (!schedule) {
        showToast('Jadwal tidak ditemukan', 'error');
        return;
      }

      // Store current schedule ID
      currentCancelScheduleId = scheduleId;

      // Clear previous input
      document.getElementById('cancelScheduleReason').value = '';
      document.getElementById('cancelScheduleReasonError').style.display = 'none';

      // Render card overview
      const cardHtml = renderCancelScheduleCard(schedule);
      document.getElementById('cancelScheduleOverview').innerHTML = cardHtml;

      openModal('modalCancelSchedule');
    }

    function renderCancelScheduleCard(s) {
      // Gunakan fungsi yang sama dengan daftar jadwal untuk konsistensi warna badge dan highlight
      const highlight = getScheduleHighlight(s);
      const badge = getScheduleStatusBadge(s);

      return `
        <div style="background: ${highlight.bg}; border: 2px solid ${highlight.border}; border-radius: 10px; padding: 12px; font-size: 0.85rem;">
          <!-- Header: Customer & Status -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div>
              <div class="info-row">
                <span style="font-weight: 700; font-size: 1rem; color: var(--ps3-text);">${escapeHtml(s.customer)}</span>
                ${s.scheduleId ? `
                  <span class="tx-id-label">TX ID:</span>
                  <span onclick="copyToClipboard('${s.scheduleId}')" class="tx-id-badge" title="Klik untuk copy ID" style="font-size: 0.75rem; cursor: pointer;">${s.scheduleId}</span>
                ` : ''}
              </div>
              ${s.phone ? `<div class="fs-8 text-muted mt-2">📞 ${escapeHtml(s.phone)}</div>` : ''}
            </div>
            <span style="font-size: 0.75rem; padding: 5px 10px; border-radius: 6px; background: ${badge.bg}; color: ${badge.color}; font-weight: 600; white-space: nowrap;">${badge.text}</span>
          </div>

          <!-- Date/Time dengan bold -->
          <div class="text-85 text-muted mb-2px">
            ${formatScheduleDate(s)}
          </div>
          <div class="fs-85 text-primary fw-600 mb-6">
            ${formatScheduleTime(s)}
          </div>

          <!-- Unit & Note -->
          ${s.unitName ? `<div class="label-xs-muted" class="mb-4">🎮 ${escapeHtml(s.unitName)}</div>` : ''}
          ${s.note ? `<div class="fs-8 text-muted italic mt-4">💬 ${escapeHtml(s.note)}</div>` : ''}
        </div>
      `;
    }

    async function confirmCancelSchedule() {
      if (!currentCancelScheduleId) return;

      const reason = document.getElementById('cancelScheduleReason').value.trim();

      // Validate reason is required
      if (!reason) {
        document.getElementById('cancelScheduleReasonError').style.display = 'block';
        document.getElementById('cancelScheduleReason').focus();
        return;
      }

      document.getElementById('cancelScheduleReasonError').style.display = 'none';

      try {
        // Call API to cancel with reason
        await api('PUT', `/schedules/${currentCancelScheduleId}`, {
          status: 'cancelled',
          reason: reason
        });

        closeModal('modalCancelSchedule');
        showToast('Jadwal dibatalkan dan dipindahkan ke sampah', 'success');

        // Reload data
        await loadData();
        await loadSchedules();
        renderAll();
        renderSchedules();
        filterCalendarSchedules();

        // Reset
        currentCancelScheduleId = null;
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    async function startSchedule(id) {
      try {
        const schedule = schedules.find(s => s.id == id);
        if (!schedule) {
          showToast('Jadwal tidak ditemukan', 'error');
          return;
        }

        // Check if schedule has a station assigned
        if (!schedule.unitId) {
          // Show modal to select station
          openScheduleUnitModal(schedule);
          return;
        }
        
        // Start the session with schedule data and station
        await api('POST', `/schedules/${id}/start-unit`, { unitId: schedule.unitId });
        await loadData();
        await loadSchedules();
        renderAll();
        renderSchedules();
        filterCalendarSchedules();
        showToast('Jadwal dimulai! Stasiun aktif dengan data booking.', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }
    
    // Modal for selecting station when starting a schedule without assigned station
    let currentScheduleForUnit = null;
    
    async function openScheduleUnitModal(schedule) {
      currentScheduleForUnit = schedule;
      const modal = document.getElementById('modalScheduleUnit');
      const stationSelect = document.getElementById('scheduleUnitSelect');
      
      // Load stations if not loaded
      if (stations.length === 0) {
        try {
          stations = await api('GET', '/pairings');
        } catch (error) {
          console.error('Failed to load stations:', error);
        }
      }
      
      // Populate available stations (for now, show all - active status tracked differently)
      stationSelect.innerHTML = '<option value="">-- Pilih Stasiun --</option>' + 
        stations.map(s => 
          `<option value="${s.id}">${s.name}</option>`
        ).join('');
      
      // Add info text
      document.getElementById('scheduleUnitCustomer').textContent = schedule.customer;
      document.getElementById('scheduleUnitDuration').textContent = schedule.duration ? `${schedule.duration} menit` : 'Tak terbatas';
      
      openModal('modalScheduleUnit');
    }
    
    async function confirmScheduleUnitSelection() {
      if (!currentScheduleForUnit) return;
      
      const stationId = document.getElementById('scheduleUnitSelect').value;
      if (!stationId) {
        showToast('Pilih stasiun terlebih dahulu', 'error');
        return;
      }
      
      try {
        await api('POST', `/schedules/${currentScheduleForUnit.id}/start-unit`, { unitId: stationId });
        closeModal('modalScheduleUnit');
        currentScheduleForUnit = null;
        await loadData();
        await loadSchedules();
        renderAll();
        renderSchedules();
        filterCalendarSchedules();
        showToast('Jadwal dimulai! Unit aktif dengan data booking.', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    // ═════════════════ Schedule Edit Functions ═════════════════
    let currentEditScheduleId = null;

    async function openEditScheduleModal(scheduleId) {
      showToast('Membuka edit jadwal...', 'info');
      
      currentEditScheduleId = scheduleId;
      
      if (!schedules || schedules.length === 0) {
        showToast('Data jadwal belum dimuat. Tunggu sebentar...', 'error');
        return;
      }
      
      const schedule = schedules.find(s => s.id == scheduleId);
      if (!schedule) {
        showToast('Jadwal tidak ditemukan', 'error');
        return;
      }

      // Reset steps
      document.getElementById('editScheduleStep1').style.display = 'block';
      document.getElementById('editScheduleStep2').style.display = 'none';
      document.getElementById('editScheduleStep3').style.display = 'none';

      // Reset checkboxes
      document.getElementById('editScheduleCheckCustomer').checked = false;
      document.getElementById('editScheduleCheckPhone').checked = false;
      document.getElementById('editScheduleCheckDateTime').checked = false;
      document.getElementById('editScheduleCheckUnit').checked = false;
      document.getElementById('editScheduleCheckNote').checked = false;

      // Pre-fill current values
      document.getElementById('editScheduleCustomer').value = schedule.customer || '';
      document.getElementById('editSchedulePhone').value = schedule.phone || '';

      // Pre-fill date/time fields
      document.getElementById('editScheduleStartDate').value = schedule.scheduledDate || '';
      document.getElementById('editScheduleStartTime').value = schedule.scheduledTime || '';
      document.getElementById('editScheduleEndDate').value = schedule.scheduledEndDate || schedule.scheduledDate || '';
      document.getElementById('editScheduleEndTime').value = schedule.scheduledEndTime || '';

      // Set duration dropdown (preset or custom)
      const duration = schedule.duration || 120;
      const presetOptions = [60, 120, 180, 240, 300];
      const durationSelect = document.getElementById('editScheduleDuration');
      const customInput = document.getElementById('editScheduleDurationCustom');
      const customLabel = document.getElementById('editScheduleCustomDurationLabel');

      if (presetOptions.includes(duration)) {
        durationSelect.value = duration.toString();
        customInput.style.display = 'none';
        customLabel.style.color = 'var(--ps3-muted)';
      } else {
        durationSelect.value = 'custom';
        customInput.value = duration;
        customInput.style.display = 'block';
        customLabel.style.color = 'var(--ps3-text)';
      }

      document.getElementById('editScheduleNote').value = schedule.note || '';
      document.getElementById('editScheduleReason').value = '';

      // Populate station dropdown
      const stationSelect = document.getElementById('editScheduleUnit');
      stationSelect.innerHTML = '<option value="">-- Pilih Stasiun --</option>';
      
      // Load stations if not loaded
      if (stations.length === 0) {
        try {
          stations = await api('GET', '/pairings');
        } catch (error) {
          console.error('Failed to load stations:', error);
        }
      }
      
      stations.forEach(s => {
        const selected = s.id == schedule.unitId ? 'selected' : '';
        stationSelect.innerHTML += `<option value="${s.id}" ${selected}>${s.name}</option>`;
      });

      // Load edit history
      loadScheduleEditHistory(scheduleId);

      openModal('modalEditSchedule', true);
    }

    // Function to open modal directly to history view (Step 3)
    async function openScheduleHistoryModal(scheduleId) {
      currentEditScheduleId = scheduleId;

      // Get schedule data for the title
      let schedule;
      try {
        const response = await api('GET', `/schedules/${scheduleId}`);
        schedule = response.schedule;
      } catch (error) {
        showToast('Gagal memuat data jadwal: ' + error.message, 'error');
        return;
      }

      // Update modal title to show history with copyable TX ID
      const modalTitle = document.querySelector('#modalEditSchedule .modal-title');
      if (modalTitle) {
        const txId = schedule?.scheduleId || '';
        modalTitle.innerHTML = `📜 Riwayat Edit: ${schedule?.customer || 'Jadwal'} <span onclick="copyToClipboard('${txId}')" class="tx-id-badge" title="Klik untuk copy ID" style="font-size: 0.75rem; margin-left: 8px;">${txId}</span>`;
      }

      // Hide Step 1 and Step 2, show only Step 3
      document.getElementById('editScheduleStep1').style.display = 'none';
      document.getElementById('editScheduleStep2').style.display = 'none';
      document.getElementById('editScheduleStep3').style.display = 'block';

      // Load edit history
      await loadScheduleEditHistory(scheduleId);

      openModal('modalEditSchedule', true);
    }

    function proceedToEditScheduleStep2() {
      const fields = [
        'editScheduleCheckCustomer',
        'editScheduleCheckPhone',
        'editScheduleCheckDateTime',
        'editScheduleCheckUnit',
        'editScheduleCheckNote'
      ];

      const anySelected = fields.some(id => document.getElementById(id).checked);
      if (!anySelected) {
        showToast('Pilih minimal 1 data yang ingin diedit', 'error');
        return;
      }

      // Hide/show fields based on selection
      document.getElementById('editScheduleFieldCustomer').style.display =
        document.getElementById('editScheduleCheckCustomer').checked ? 'block' : 'none';
      document.getElementById('editScheduleFieldPhone').style.display =
        document.getElementById('editScheduleCheckPhone').checked ? 'block' : 'none';
      document.getElementById('editScheduleFieldDateTime').style.display =
        document.getElementById('editScheduleCheckDateTime').checked ? 'block' : 'none';
      document.getElementById('editScheduleFieldUnit').style.display =
        document.getElementById('editScheduleCheckUnit').checked ? 'block' : 'none';
      document.getElementById('editScheduleFieldNote').style.display =
        document.getElementById('editScheduleCheckNote').checked ? 'block' : 'none';

      document.getElementById('editScheduleStep1').style.display = 'none';
      document.getElementById('editScheduleStep2').style.display = 'block';
    }

    function backToEditScheduleStep1() {
      document.getElementById('editScheduleStep1').style.display = 'block';
      document.getElementById('editScheduleStep2').style.display = 'none';
    }

    // ═════════════════ Edit Schedule Date/Time Handler Functions ═════════════════

    // Handle duration dropdown change for edit modal
    function editScheduleHandleDurationChange(select) {
      const customInput = document.getElementById('editScheduleDurationCustom');
      const customLabel = document.getElementById('editScheduleCustomDurationLabel');

      if (select.value === 'custom') {
        customInput.style.display = 'block';
        customLabel.style.color = 'var(--ps3-text)';
        customInput.focus();
      } else {
        customInput.style.display = 'none';
        customLabel.style.color = 'var(--ps3-muted)';
        // Auto update end date/time when selecting preset duration
        editScheduleUpdateEndDateTimeFromDuration();
      }
    }

    // Initialize default end date when start date changes for edit modal
    function editScheduleInitDefaultEndDate() {
      const startDate = document.getElementById('editScheduleStartDate').value;
      const endDateInput = document.getElementById('editScheduleEndDate');

      if (startDate && !endDateInput.value) {
        endDateInput.value = startDate;
      }

      // Also update end time if we have start time and duration
      editScheduleUpdateEndDateTimeFromDuration();
    }

    // When duration changes, update end date and time for edit modal
    function editScheduleUpdateEndDateTimeFromDuration() {
      const startDate = document.getElementById('editScheduleStartDate').value;
      const startTime = document.getElementById('editScheduleStartTime').value;
      const durationSelect = document.getElementById('editScheduleDuration').value;
      let duration = 0;

      if (durationSelect === 'custom') {
        duration = parseInt(document.getElementById('editScheduleDurationCustom').value) || 0;
      } else {
        duration = parseInt(durationSelect) || 0;
      }

      if (startDate && startTime && duration > 0) {
        const result = addMinutesToDateTime(startDate, startTime, duration);
        document.getElementById('editScheduleEndDate').value = result.date;
        document.getElementById('editScheduleEndTime').value = result.time;
      }
    }

    // When end date/time changes, update duration for edit modal
    function editScheduleUpdateDurationFromEndDateTime() {
      const startDate = document.getElementById('editScheduleStartDate').value;
      const startTime = document.getElementById('editScheduleStartTime').value;
      const endDate = document.getElementById('editScheduleEndDate').value;
      const endTime = document.getElementById('editScheduleEndTime').value;

      if (startDate && startTime && endDate && endTime) {
        const duration = getDurationMinutesWithDate(startDate, startTime, endDate, endTime);
        if (duration > 0) {
          const durationSelect = document.getElementById('editScheduleDuration');
          const customInput = document.getElementById('editScheduleDurationCustom');
          const customLabel = document.getElementById('editScheduleCustomDurationLabel');

          // Check if duration matches preset options
          const presetOptions = [60, 120, 180, 240, 300];
          if (presetOptions.includes(duration)) {
            durationSelect.value = duration.toString();
            customInput.style.display = 'none';
            customLabel.style.color = 'var(--ps3-muted)';
          } else {
            durationSelect.value = 'custom';
            customInput.value = duration;
            customInput.style.display = 'block';
            customLabel.style.color = 'var(--ps3-text)';
          }
        }
      }
    }

    async function saveScheduleEdit() {
      const reason = document.getElementById('editScheduleReason').value.trim();
      if (!reason) {
        showToast('Alasan edit wajib diisi', 'error');
        return;
      }

      const updates = {};

      if (document.getElementById('editScheduleCheckCustomer').checked) {
        updates.customer = document.getElementById('editScheduleCustomer').value.trim();
      }
      if (document.getElementById('editScheduleCheckPhone').checked) {
        updates.phone = document.getElementById('editSchedulePhone').value.trim();
      }
      if (document.getElementById('editScheduleCheckDateTime').checked) {
        updates.scheduledDate = document.getElementById('editScheduleStartDate').value;
        updates.scheduledTime = document.getElementById('editScheduleStartTime').value;
        updates.scheduledEndDate = document.getElementById('editScheduleEndDate').value;
        updates.scheduledEndTime = document.getElementById('editScheduleEndTime').value;

        // Calculate duration
        const durationSelect = document.getElementById('editScheduleDuration').value;
        if (durationSelect === 'custom') {
          updates.duration = parseInt(document.getElementById('editScheduleDurationCustom').value) || 0;
        } else {
          updates.duration = parseInt(durationSelect) || 0;
        }
      }
      if (document.getElementById('editScheduleCheckUnit').checked) {
        updates.unitId = document.getElementById('editScheduleUnit').value;
      }
      if (document.getElementById('editScheduleCheckNote').checked) {
        updates.note = document.getElementById('editScheduleNote').value.trim();
      }

      if (Object.keys(updates).length === 0) {
        showToast('Tidak ada perubahan untuk disimpan', 'error');
        return;
      }

      try {
        // Flatten updates to match backend expectation (fields directly in body, not nested)
        const payload = {
          ...updates,
          reason,
          editedBy: 'admin'
        };
        const response = await api('PUT', `/schedules/${currentEditScheduleId}`, payload);

        if (response.ok) {
          showToast(`Jadwal diperbarui (${response.changes} perubahan)`, 'success');

          // Show history after successful edit
          document.getElementById('editScheduleStep2').style.display = 'none';
          document.getElementById('editScheduleStep3').style.display = 'block';
          await loadScheduleEditHistory(currentEditScheduleId);

          // Refresh data
          await loadSchedules();
          renderSchedules();
          filterCalendarSchedules();
        } else {
          showToast(response.error || 'Gagal mengupdate jadwal', 'error');
        }
      } catch (error) {
        showToast(error.message || 'Terjadi kesalahan', 'error');
      }
    }

    async function loadScheduleEditHistory(scheduleId) {
      try {
        const response = await api('GET', `/schedules/${scheduleId}/edits`);
        const container = document.getElementById('editScheduleHistoryList');

        if (!response.ok || !response.logs || response.logs.length === 0) {
          container.innerHTML = `
            <div class="empty-state-p20">
              <div class="fs-2 mb-10">📝</div>
              <div>Belum ada riwayat edit untuk jadwal ini</div>
            </div>
          `;
          return;
        }

        // Urutkan berdasarkan waktu edit terbaru (descending)
        const sortedLogs = response.logs.sort((a, b) => {
          const dateA = new Date(a.editedAt || 0);
          const dateB = new Date(b.editedAt || 0);
          return dateB - dateA; // Descending: terbaru dulu
        });

        const fieldLabels = {
          'customer': 'Nama Penyewa',
          'phone': 'Nomor Telepon',
          'scheduledDate': 'Tanggal',
          'scheduledTime': 'Waktu',
          'scheduledEndDate': 'Tanggal Selesai',
          'scheduledEndTime': 'Waktu Selesai',
          'duration': 'Durasi',
          'unitId': 'Unit PS',
          'unitName': 'Unit PS',
          'note': 'Catatan',
          'status': 'Status'
        };

        container.innerHTML = sortedLogs.map(log => {
          const fieldName = fieldLabels[log.fieldName] || log.fieldName;
          const editedAtWIB = new Date(log.editedAt + (7 * 60 * 60 * 1000));
          const dateStr = editedAtWIB.toLocaleString('id-ID', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'UTC'
          });

          let oldValue = log.oldValue;
          let newValue = log.newValue;

          // Format duration with minutes
          if (log.fieldName === 'duration') {
            oldValue = oldValue + ' menit';
            newValue = newValue + ' menit';
          }

          return `
            <div style="border-left: 3px solid var(--ps3-red); padding: 12px; margin-bottom: 12px; background: rgba(255,255,255,0.05); border-radius: 0 10px 10px 0;">
              <div class="text-8 text-muted mb-6">
                ${dateStr} • oleh ${log.editedBy || 'admin'}
              </div>
              <div class="fw-600 mb-4 text-primary">
                ${fieldName}
              </div>
              <div style="display: flex; align-items: center; gap: 8px; font-size: 0.9rem;">
                <span class="strike text-red">${oldValue || '(kosong)'}</span>
                <span class="text-muted">→</span>
                <span style="color: var(--ps3-green); font-weight: 500;">${newValue || '(kosong)'}</span>
              </div>
              ${log.editReason ? `<div style="font-size: 0.8rem; color: var(--ps3-muted); margin-top: 6px; font-style: italic;">💬 ${log.editReason}</div>` : ''}
            </div>
          `;
        }).join('');
      } catch (error) {
        document.getElementById('editScheduleHistoryList').innerHTML = `
          <div class="empty-state-p20">
            Gagal memuat riwayat edit
          </div>
        `;
      }
    }

    function showScheduleEditLogsTab() {
      // Load edit logs
      if (currentEditScheduleId) {
        loadScheduleEditHistory(currentEditScheduleId);
      }
    }

    function showScheduleDeleteLogsTab() {
      document.getElementById('btnShowScheduleDeleteLogs').style.background = 'var(--ps3-red)';
      document.getElementById('btnShowScheduleDeleteLogs').style.opacity = '1';
      document.getElementById('btnShowScheduleEditLogs').style.background = 'var(--ps3-surface)';
      document.getElementById('btnShowScheduleEditLogs').style.opacity = '0.7';
      // Show placeholder for delete logs (not implemented yet for schedules)
      document.getElementById('editScheduleHistoryList').innerHTML = `
        <div class="empty-state-p20">
          <div class="fs-2 mb-10">🗑️</div>
          <div>Log penghapusan jadwal belum tersedia</div>
        </div>
      `;
    }

    // Inventory Functions
    async function addInventory() {
      const name = document.getElementById('inventoryName').value.trim();
      const category = document.getElementById('inventoryCategory').value;
      const condition = document.getElementById('inventoryCondition').value;
      const location = document.getElementById('inventoryLocation').value.trim();
      const purchaseDate = document.getElementById('inventoryPurchaseDate').value;
      const purchasePrice = parseFloat(document.getElementById('inventoryPurchasePrice').value) || 0;
      const note = document.getElementById('inventoryNote').value.trim();
      
      if (!name) {
        showToast('Nama item wajib diisi', 'error');
        return;
      }
      
      if (!category) {
        showToast('Kategori wajib dipilih', 'error');
        return;
      }
      
      try {
        await api('POST', '/inventory', {
          name,
          category,
          purchase_date: purchaseDate,
          purchase_cost: purchasePrice,
          condition: condition,
          current_location: location,
          notes: note
        });
        
        // Clear form
        document.getElementById('inventoryName').value = '';
        document.getElementById('inventoryCategory').value = '';
        document.getElementById('inventoryCondition').value = 'baik';
        document.getElementById('inventoryLocation').value = '';
        document.getElementById('inventoryPurchaseDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('inventoryPurchasePrice').value = '';
        document.getElementById('inventoryNote').value = '';
        
        await loadInventory();
        renderInventory();
        closeModal('modalAddInventory');
        showToast('Item inventori ditambahkan', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    async function loadInventory() {
      try {
        const response = await api('GET', '/inventory');
        // API returns array directly
        inventory = Array.isArray(response) ? response : (response?.items || []);
      } catch (error) {
        console.error('Failed to load inventory:', error);
        inventory = [];
      }
    }

    function renderInventory() {
      const container = document.getElementById('inventoryList');
      if (!container) return;
      
      // Ensure inventory is always an array
      if (!Array.isArray(inventory)) {
        inventory = [];
      }
      
      if (inventory.length === 0) {
        container.innerHTML = '<p class="empty-state-p20">Belum ada item inventori</p>';
        return;
      }
      
      // Group by category
      const byCategory = {};
      inventory.forEach(item => {
        const cat = item.category || 'Lainnya';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(item);
      });

      container.innerHTML = Object.entries(byCategory).map(([cat, items]) => `
        <div class="mb-15">
          <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ps3-muted); margin-bottom: 8px; border-bottom: 1px solid var(--ps3-border); padding-bottom: 4px;">
            ${categoryLabels[cat] || cat}
          </div>
          ${items.map(item => `
            <div style="background: var(--ps3-surface); border: 1px solid var(--ps3-border); border-radius: 10px; padding: 12px; margin-bottom: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                  <span style="font-size: 0.7rem; color: var(--ps3-muted); font-family: monospace;">${item.id}</span>
                  <div class="fw-600">${item.name}</div>
                </div>
              </div>
              <div style="font-size: 0.8rem; color: var(--ps3-muted); margin-top: 4px;">
                ${conditionLabels[item.condition] || item.condition}
                ${item.current_location ? `• 📍 ${item.current_location}` : ''}
                ${item.purchase_cost ? `• 💰 Rp${item.purchase_cost.toLocaleString()}` : ''}
              </div>
              ${item.notes ? `<div style="font-size: 0.75rem; color: var(--ps3-muted); font-style: italic; margin-top: 4px;">💬 ${item.notes}</div>` : ''}
              <div style="display: flex; gap: 8px; margin-top: 10px;">
                <button onclick="deleteInventory('${item.id}')" style="background: var(--ps3-border); color: var(--ps3-text); border: none; padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; cursor: pointer;">🗑️ Hapus</button>
              </div>
            </div>
          `).join('')}
        </div>
      `).join('');
    }

    async function deleteInventory(id) {
      if (!confirm('Hapus item ini dari inventori?')) return;
      
      try {
        await api('DELETE', `/inventory/${id}`);
        await loadInventory();
        renderInventory();
        showToast('Item inventori dihapus', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // INVENTORY MANAGEMENT SYSTEM - Full Functions
    // ═══════════════════════════════════════════════════════════════════════════════

    let currentItemDetail = null;
    let currentStationDetail = null;
    let stations = [];
    let inventoryAnalytics = null;
    let globalPairedItemIds = []; // Track items paired to any station

    // Inventory Constants (Global Scope)
    const categoryLabels = {
      konsol: '🎮 Konsol',
      tv: '📺 TV',
      stik: '🕹️ Stik',
      kabel_hdmi: '🔌 HDMI',
      kabel_usb: '🔌 Kabel USB',
      kabel_power: '🔌 Kabel Plug',
      lainnya: '📦 Lainnya'
    };

    const conditionLabels = {
      baik: '🟢 Baik',
      rusak: '🔴 Rusak',
      perbaikan: '🟡 Perbaikan',
      rusak_total: '⚫ Rusak Total'
    };

    const conditionColors = {
      baik: 'var(--ps3-green)',
      rusak: 'var(--ps3-red)',
      perbaikan: 'var(--ps3-yellow)',
      rusak_total: '#666'
    };

    // Helper function to get category label in Indonesian
    function getCategoryLabel(category) {
      const labels = {
        'konsol': 'Konsol PS3',
        'ps3': 'Konsol PS3',
        'tv': 'TV',
        'stik': 'Stik PS3',
        'kabel_power': 'Kabel Power',
        'usb': 'Kabel Charger USB',
        'charger': 'Kabel Charger',
        'plug': 'Kabel Plug',
        'power': 'Kabel Power',
        'kabel_hdmi': 'Kabel HDMI',
        'hdmi': 'Kabel HDMI',
        'lainnya': 'Item Lainnya',
        'kabel': 'Kabel Lainnya'
      };
      return labels[category] || category;
    }

    // Tab Switching
    function switchInventoryTab(tab) {
      // Hide all tabs
      document.getElementById('inventoryTabItems').style.display = 'none';
      document.getElementById('inventoryTabStations').style.display = 'none';
      document.getElementById('inventoryTabAnalytics').style.display = 'none';

      // Reset button styles
      document.getElementById('tabInventoryItems').style.background = 'var(--ps3-surface)';
      document.getElementById('tabInventoryStations').style.background = 'var(--ps3-surface)';
      document.getElementById('tabInventoryAnalytics').style.background = 'var(--ps3-surface)';

      // Show selected tab and highlight button
      document.getElementById(`inventoryTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).style.display = 'block';
      document.getElementById(`tabInventory${tab.charAt(0).toUpperCase() + tab.slice(1)}`).style.background = '';

      // Load data if needed
      if (tab === 'stations') loadStations();
      if (tab === 'analytics') loadInventoryAnalytics();
    }

    // Enhanced renderInventory with stats and filters
    function renderInventory() {
      const container = document.getElementById('inventoryList');
      if (!container) return;

      // Ensure inventory is always an array
      if (!Array.isArray(inventory)) {
        inventory = [];
      }

      // Apply filters
      const catFilter = document.getElementById('inventoryFilterCategory')?.value || '';
      const condFilter = document.getElementById('inventoryFilterCondition')?.value || '';

      let filtered = inventory.filter(item => item.is_active !== 0);
      if (catFilter) filtered = filtered.filter(i => i.category === catFilter);
      if (condFilter) filtered = filtered.filter(i => i.condition === condFilter);

      // Update stats
      const totalValue = filtered.reduce((sum, i) => sum + (i.purchase_cost || 0), 0);
      const needMaint = filtered.filter(i => i.condition === 'perbaikan' || i.condition === 'rusak').length;

      document.getElementById('statTotalItems').textContent = filtered.length;
      document.getElementById('statTotalValue').textContent = `Rp${totalValue.toLocaleString()}`;
      document.getElementById('statNeedMaintenance').textContent = needMaint;

      if (filtered.length === 0) {
        container.innerHTML = '<p class="empty-state-p20">Tidak ada item yang sesuai filter</p>';
        return;
      }

      // Group by category
      const byCategory = {};
      filtered.forEach(item => {
        const cat = item.category || 'lainnya';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(item);
      });

      container.innerHTML = Object.entries(byCategory).map(([cat, items]) => `
        <div class="mb-15">
          <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ps3-muted); margin-bottom: 8px; border-bottom: 1px solid var(--ps3-border); padding-bottom: 4px;">
            ${categoryLabels[cat] || cat} (${items.length})
          </div>
          ${items.map(item => `
            <div style="background: var(--ps3-surface); border: 1px solid var(--ps3-border); border-radius: 10px; padding: 12px; margin-bottom: 8px; cursor: pointer; transition: all 0.2s;"
                 onclick="openItemDetail('${item.id}')"
                 onmouseover="this.style.borderColor='var(--ps3-silver)'"
                 onmouseout="this.style.borderColor='var(--ps3-border)'">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div class="flex-1">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="font-size: 0.65rem; color: var(--ps3-muted); font-family: monospace; background: var(--ps3-card); padding: 2px 6px; border-radius: 4px;">${item.id}</span>
                    <span style="font-size: 0.7rem; color: ${conditionColors[item.condition] || 'var(--ps3-muted)'}; font-weight: 600;">${conditionLabels[item.condition] || item.condition}</span>
                  </div>
                  <div style="font-weight: 600; margin-top: 4px;">${item.name}</div>
                </div>
                ${item.purchase_cost ? `<div style="font-size: 0.8rem; color: var(--ps3-green); font-weight: 600;">Rp${item.purchase_cost.toLocaleString()}</div>` : ''}
              </div>
              <div style="font-size: 0.75rem; color: var(--ps3-muted); margin-top: 6px; display: flex; flex-wrap: wrap; gap: 8px;">
                ${item.current_location ? `<span>📍 ${item.current_location}</span>` : ''}
                ${item.total_usage_hours ? `<span>⏱️ ${item.total_usage_hours} jam</span>` : ''}
                ${item.total_maintenance_cost ? `<span>🔧 Rp${item.total_maintenance_cost.toLocaleString()}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `).join('');
    }

    // Item Detail Functions
    async function openItemDetail(itemId) {
      try {
        const item = await api('GET', `/inventory/${itemId}`);
        currentItemDetail = item;

        document.getElementById('itemDetailTitle').textContent = `📦 ${item.name}`;

        // Info card
        const purchaseDate = item.purchase_date ? new Date(item.purchase_date).toLocaleDateString('id-ID') : '-';
        const bookValue = item.current_book_value !== undefined ? item.current_book_value : (item.purchase_cost || 0);

        document.getElementById('itemDetailInfo').innerHTML = `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.8rem;">
            <div>
              <div class="text-muted-7">ID</div>
              <div style="font-family: monospace; font-weight: 600;">${item.id}</div>
            </div>
            <div>
              <div class="text-muted-7">Kategori</div>
              <div>${categoryLabels[item.category] || item.category}</div>
            </div>
            <div>
              <div class="text-muted-7">Kondisi</div>
              <div style="color: ${conditionColors[item.condition] || 'inherit'};">${conditionLabels[item.condition] || item.condition}</div>
            </div>
            <div>
              <div class="text-muted-7">Lokasi</div>
              <div>${item.current_location || '-'}</div>
            </div>
            <div>
              <div class="text-muted-7">Tgl Beli</div>
              <div>${purchaseDate}</div>
            </div>
            <div>
              <div class="text-muted-7">Harga Beli</div>
              <div class="text-green">Rp${(item.purchase_cost || 0).toLocaleString()}</div>
            </div>
            <div>
              <div class="text-muted-7">Nilai Buku</div>
              <div>Rp${bookValue.toLocaleString()}</div>
            </div>
            <div>
              <div class="text-muted-7">Total Jam</div>
              <div>${item.total_usage_hours || 0} jam</div>
            </div>
          </div>
          ${item.notes ? `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--ps3-border); font-size: 0.75rem; color: var(--ps3-muted);">💬 ${item.notes}</div>` : ''}
        `;

        // Reset to maintenance tab
        switchItemTab('maintenance');

        // Load maintenance list
        renderMaintenanceList(item.maintenance_history || []);

        // Load usage stats
        renderUsageStats(item);

        // Load station info
        renderItemStationInfo(item);

        openModal('modalItemDetail');
      } catch (error) {
        showToast('Gagal memuat detail item', 'error');
      }
    }

    function switchItemTab(tab) {
      document.getElementById('itemTabMaintenance').style.display = 'none';
      document.getElementById('itemTabUsage').style.display = 'none';
      document.getElementById('itemTabStation').style.display = 'none';

      document.getElementById('tabItemMaintenance').style.background = 'var(--ps3-surface)';
      document.getElementById('tabItemUsage').style.background = 'var(--ps3-surface)';
      document.getElementById('tabItemStation').style.background = 'var(--ps3-surface)';

      document.getElementById(`itemTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).style.display = 'block';
      document.getElementById(`tabItem${tab.charAt(0).toUpperCase() + tab.slice(1)}`).style.background = '';
    }

    function renderMaintenanceList(history) {
      const container = document.getElementById('itemMaintenanceList');
      if (!history || history.length === 0) {
        container.innerHTML = '<p class="empty-state-p15">Belum ada riwayat perawatan</p>';
        return;
      }

      container.innerHTML = history.map(h => `
        <div style="background: var(--ps3-card); border: 1px solid var(--ps3-border); border-radius: 8px; padding: 10px; margin-bottom: 8px;">
          <div class="flex-between-center">
            <div style="font-size: 0.8rem; font-weight: 600;">${new Date(h.maintenance_date).toLocaleDateString('id-ID')}</div>
            ${h.cost ? `<div style="font-size: 0.8rem; color: var(--ps3-yellow);">Rp${h.cost.toLocaleString()}</div>` : ''}
          </div>
          <div style="font-size: 0.75rem; margin-top: 4px;">${h.description}</div>
          ${h.vendor ? `<div style="font-size: 0.7rem; color: var(--ps3-muted); margin-top: 2px;">🏢 ${h.vendor}</div>` : ''}
        </div>
      `).join('');
    }

    function renderUsageStats(item) {
      const container = document.getElementById('itemUsageStats');
      const usage30d = item.usage_30d || [];
      const total30d = usage30d.reduce((sum, u) => sum + (u.hours_used || 0), 0);

      container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
          <div style="background: var(--ps3-surface); border: 1px solid var(--ps3-border); border-radius: 8px; padding: 12px; text-align: center;">
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--ps3-silver);">${item.total_usage_hours || 0}</div>
            <div class="fs-65 text-muted">Total Jam</div>
          </div>
          <div style="background: var(--ps3-surface); border: 1px solid var(--ps3-border); border-radius: 8px; padding: 12px; text-align: center;">
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--ps3-yellow);">${total30d.toFixed(1)}</div>
            <div class="fs-65 text-muted">30 Hari Terakhir</div>
          </div>
        </div>
      `;
    }

    function renderItemStationInfo(item) {
      const container = document.getElementById('itemStationInfo');
      if (!item.current_pairing) {
        container.innerHTML = '<p class="empty-state-p15">Item tidak terpasang di stasiun manapun</p>';
        return;
      }

      container.innerHTML = `
        <div style="background: var(--ps3-surface); border: 1px solid var(--ps3-border); border-radius: 8px; padding: 12px;">
          <div style="font-size: 0.8rem; font-weight: 600;">🏢 ${item.current_pairing.name}</div>
          <div class="text-sm text-muted">ID: ${item.current_pairing.id}</div>
          <div style="font-size: 0.75rem; margin-top: 8px;">Role: ${item.current_pairing.role}</div>
          <div class="text-sm text-muted">Dipasang: ${new Date(item.current_pairing.assigned_at).toLocaleDateString('id-ID')}</div>
        </div>
      `;
    }

    function openAddMaintenanceModal() {
      if (!currentItemDetail) return;
      document.getElementById('maintenanceItemId').value = currentItemDetail.id;
      document.getElementById('maintenanceDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('maintenanceCost').value = '';
      document.getElementById('maintenanceDesc').value = '';
      document.getElementById('maintenanceVendor').value = '';
      document.getElementById('maintenanceNextDate').value = '';
      openModal('modalAddMaintenance');
    }

    async function addMaintenanceRecord() {
      const itemId = document.getElementById('maintenanceItemId').value;
      const date = document.getElementById('maintenanceDate').value;
      const cost = parseFloat(document.getElementById('maintenanceCost').value) || 0;
      const desc = document.getElementById('maintenanceDesc').value.trim();
      const vendor = document.getElementById('maintenanceVendor').value.trim();
      const nextDate = document.getElementById('maintenanceNextDate').value;

      if (!date || !desc) {
        showToast('Tanggal dan deskripsi wajib diisi', 'error');
        return;
      }

      try {
        await api('POST', `/inventory/${itemId}/maintenance`, {
          maintenance_date: date,
          cost,
          description: desc,
          vendor: vendor || null,
          next_scheduled_maintenance: nextDate || null
        });

        closeModal('modalAddMaintenance');
        showToast('Catatan perawatan ditambahkan', 'success');

        // Refresh detail
        openItemDetail(itemId);
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    function openEditItemModal() {
      if (!currentItemDetail) {
        showToast('Tidak ada item yang dipilih', 'error');
        return;
      }

      const item = currentItemDetail;

      // Populate form fields
      document.getElementById('editItemId').value = item.id;
      document.getElementById('editItemName').value = item.name || '';
      document.getElementById('editItemCategory').value = item.category || 'lainnya';
      document.getElementById('editItemCondition').value = item.condition || 'baik';
      document.getElementById('editItemSubcategory').value = item.subcategory || '';
      document.getElementById('editItemLocation').value = item.current_location || '';
      document.getElementById('editItemPurchaseDate').value = item.purchase_date || '';
      document.getElementById('editItemPurchaseCost').value = item.purchase_cost || 0;
      document.getElementById('editItemVendor').value = item.vendor || '';
      document.getElementById('editItemWarranty').value = item.warranty_info || '';
      document.getElementById('editItemNotes').value = item.notes || '';

      // Close detail modal and open edit modal
      closeModal('modalItemDetail');
      openModal('modalEditItem');
    }

    async function saveEditItem() {
      const itemId = document.getElementById('editItemId').value;
      const data = {
        name: document.getElementById('editItemName').value,
        category: document.getElementById('editItemCategory').value,
        subcategory: document.getElementById('editItemSubcategory').value,
        condition: document.getElementById('editItemCondition').value,
        current_location: document.getElementById('editItemLocation').value,
        purchase_date: document.getElementById('editItemPurchaseDate').value,
        purchase_cost: parseInt(document.getElementById('editItemPurchaseCost').value) || 0,
        vendor: document.getElementById('editItemVendor').value,
        warranty_info: document.getElementById('editItemWarranty').value,
        notes: document.getElementById('editItemNotes').value
      };

      // Validate required fields
      if (!data.name || !data.category || !data.condition) {
        showToast('Nama, Kategori, dan Kondisi wajib diisi', 'error');
        return;
      }

      try {
        await api('PUT', `/inventory/${itemId}`, data);
        showToast('Item berhasil diperbarui', 'success');
        closeModal('modalEditItem');

        // Refresh inventory list
        renderInventory();

        // Reopen detail modal with updated data
        openItemDetail(itemId);
      } catch (error) {
        showToast(error.message || 'Gagal memperbarui item', 'error');
      }
    }

    // Station Functions
    async function loadStations() {
      try {
        stations = await api('GET', '/pairings');
        renderStations();
      } catch (error) {
        showToast('Gagal memuat stasiun', 'error');
      }
    }

    function renderStations() {
      const container = document.getElementById('stationsList');
      if (!Array.isArray(stations) || stations.length === 0) {
        container.innerHTML = '<p class="empty-state-p20">Belum ada stasiun. Buat stasiun untuk mengelompokkan item.</p>';
        return;
      }

      container.innerHTML = stations.map(s => {
        const isValid = s.is_valid;
        const statusBadge = isValid 
          ? `<span style="background: rgba(0,200,0,0.2); color: #0c0; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem;">✓ SIAP</span>`
          : `<span style="background: rgba(230,0,18,0.2); color: var(--ps3-red); padding: 2px 8px; border-radius: 4px; font-size: 0.7rem;">✗ BELUM SIAP</span>`;
        
        const borderStyle = isValid ? '' : 'border: 1px solid var(--ps3-red);';
        
        return `
        <div style="background: var(--ps3-surface); border: 1px solid var(--ps3-border); border-radius: 10px; padding: 12px; margin-bottom: 10px; cursor: pointer; ${borderStyle}"
             onclick="openStationDetail('${s.id}')">
          <div class="flex-between-center">
            <div>
              <div class="fw-600">🏢 ${s.name}</div>
              <div style="font-size: 0.7rem; color: var(--ps3-muted); font-family: monospace;">${s.id}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 0.9rem; font-weight: 700; color: var(--ps3-silver);">${s.item_count || 0}</div>
              <div class="fs-65 text-muted">item</div>
            </div>
          </div>
          ${s.description ? `<div style="font-size: 0.75rem; color: var(--ps3-muted); margin-top: 6px;">${s.description}</div>` : ''}
          <div style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.7rem; color: var(--ps3-muted);">
              ${s.validation_errors && s.validation_errors.length > 0 
                ? `<span style="color: var(--ps3-red);">${s.validation_errors.length} item kurang</span>` 
                : '<span style="color: #0c0;">Semua item terpasang</span>'}
            </span>
            ${statusBadge}
          </div>
        </div>
      `}).join('');
    }

    async function addStation() {
      const name = document.getElementById('stationName').value.trim();
      const desc = document.getElementById('stationDesc').value.trim();

      if (!name) {
        showToast('Nama stasiun wajib diisi', 'error');
        return;
      }

      try {
        await api('POST', '/pairings', { name, description: desc });
        closeModal('modalAddStation');
        showToast('Stasiun berhasil dibuat', 'success');

        // Clear form
        document.getElementById('stationName').value = '';
        document.getElementById('stationDesc').value = '';

        loadStations();
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    async function openStationDetail(stationId) {
      try {
        const station = await api('GET', `/pairings/${stationId}`);
        currentStationDetail = station;

        document.getElementById('stationDetailId').value = station.id;
        document.getElementById('stationDetailTitle').textContent = `🏢 ${station.name}`;

        const validationStatus = station.is_valid
          ? `<span style="color: #0c0;">✓ Stasiun Siap Digunakan</span>`
          : `<span style="color: var(--ps3-red);">✗ Stasiun Belum Siap</span>`;
        
        const validationErrors = !station.is_valid && station.validation_errors 
          ? `<div style="margin-top: 10px; background: rgba(230,0,18,0.1); border: 1px solid var(--ps3-red); border-radius: 6px; padding: 10px;">
               <div style="font-size: 0.75rem; color: var(--ps3-red); margin-bottom: 6px;"><strong>Item yang kurang:</strong></div>
               ${station.validation_errors.map(e => `<div style="font-size: 0.7rem; color: var(--ps3-text); margin-bottom: 3px;">• ${e}</div>`).join('')}
             </div>`
          : '';

        document.getElementById('stationDetailInfo').innerHTML = `
          <div style="font-size: 0.8rem;">
            <div class="text-muted-7">ID Stasiun</div>
            <div style="font-family: monospace; font-weight: 600;">${station.id}</div>
            ${station.description ? `<div class="mt-8">${station.description}</div>` : ''}
            <div style="margin-top: 8px; display: flex; gap: 15px;">
              <span style="color: var(--ps3-silver);">${station.item_count || 0} item</span>
              <span class="text-green">Rp${(station.total_value || 0).toLocaleString()}</span>
            </div>
            <div style="margin-top: 8px; padding: 6px 10px; background: var(--ps3-surface); border-radius: 6px; border: 1px solid var(--ps3-border);">
              <strong>Status:</strong> ${validationStatus}
            </div>
            ${validationErrors}
          </div>
        `;

        // Render items in station with emoji backgrounds and category sorting
        let items = station.items || [];
        
        // Emoji mapping for categories
        const categoryEmojis = {
          'konsol': '🎮',
          'ps3': '🎮',
          'tv': '📺',
          'stik': '🎮',
          'kabel_power': '🔌',
          'usb': '🔌',
          'charger': '🔌',
          'plug': '⚡',
          'power': '⚡',
          'kabel_hdmi': '📡',
          'hdmi': '📡',
          'lainnya': '📦',
          'kabel': '🔧'
        };
        
        // Category sort order: Konsol, TV, Stik, Charger, Plug, HDMI, Lainnya
        const categoryOrder = {
          'konsol': 1, 'ps3': 1,
          'tv': 2,
          'stik': 3,
          'kabel_power': 4, 'usb': 4, 'charger': 4,
          'plug': 5, 'power': 5,
          'kabel_hdmi': 6, 'hdmi': 6,
          'lainnya': 7, 'kabel': 7
        };
        
        // Sort items by category order
        items = items.sort((a, b) => {
          const orderA = categoryOrder[a.category] || 99;
          const orderB = categoryOrder[b.category] || 99;
          if (orderA !== orderB) return orderA - orderB;
          // Secondary sort by role
          return (a.role || '').localeCompare(b.role || '');
        });
        
        const itemsContainer = document.getElementById('stationItemsList');
        if (items.length === 0) {
          itemsContainer.innerHTML = '<p class="empty-state-p15">Belum ada item di stasiun ini</p>';
        } else {
          itemsContainer.innerHTML = items.map(i => {
            const emoji = categoryEmojis[i.category] || '📦';
            const categoryLabel = getCategoryLabel(i.category);
            return `
            <div style="background: var(--ps3-card); border: 1px solid var(--ps3-border); border-radius: 8px; padding: 10px; margin-bottom: 8px; position: relative; overflow: hidden;">
              <!-- Emoji background -->
              <div style="position: absolute; right: 40px; top: 50%; transform: translateY(-50%); font-size: 3rem; opacity: 0.08; pointer-events: none; user-select: none; z-index: 0;">${emoji}</div>
              <div class="flex-between-center" style="position: relative; z-index: 1;">
                <div>
                  <div class="text-75 text-muted">${i.item_id}</div>
                  <div style="font-size: 0.85rem; font-weight: 600;">${i.item_name}</div>
                  <div class="text-sm" style="color: var(--ps3-silver);">${categoryLabel} • ${i.role}</div>
                </div>
                <button onclick="event.stopPropagation(); removeItemFromStation('${i.item_id}')" style="background: var(--ps3-border); color: var(--ps3-red); border: none; padding: 6px 10px; border-radius: 6px; font-size: 0.7rem; cursor: pointer;">❌</button>
              </div>
            </div>
          `}).join('');
        }

        // Clear any existing dynamic rows (reset to default state) FIRST
        resetCategoryRows();

        // Fetch all paired items to filter from other stations
        try {
          const pairedResponse = await api('GET', '/inventory/paired-items');
          globalPairedItemIds = pairedResponse.paired_items || [];
        } catch (e) {
          console.warn('[Station] Could not fetch paired items:', e);
          globalPairedItemIds = [];
        }

        // Then populate category dropdowns with available items
        // Filter: active + not in current station + not paired to other stations
        const currentStationItemIds = items.map(si => si.item_id);
        const availableItems = inventory.filter(i => {
          if (i.is_active === 0) return false;
          // Allow items already in this station (for display purposes)
          if (currentStationItemIds.includes(i.id)) return true;
          // Filter out items paired to other stations
          if (globalPairedItemIds.includes(i.id)) return false;
          return true;
        });
        populateCategoryDropdowns(availableItems, currentStationItemIds);

        // Populate swap dropdowns
        const swapItemSelect = document.getElementById('swapItemId');
        swapItemSelect.innerHTML = '<option value="">Item dari stasiun ini...</option>' +
          items.map(i => `<option value="${i.item_id}">${i.item_id} - ${i.item_name}</option>`).join('');

        const targetStations = stations.filter(s => s.id !== station.id);
        const swapTargetSelect = document.getElementById('swapTargetStation');
        swapTargetSelect.innerHTML = '<option value="">Ke stasiun...</option>' +
          targetStations.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

        // Hide validation message
        document.getElementById('categoryValidationMsg').style.display = 'none';

        openModal('modalStationDetail');
      } catch (error) {
        showToast('Gagal memuat detail stasiun', 'error');
      }
    }

    // Category-based item management functions
    function populateCategoryDropdowns(availableItems, currentStationItemIds = []) {
      // Filter items by category
      const konsolItems = availableItems.filter(i => i.id.startsWith('PS3-'));
      const tvItems = availableItems.filter(i => i.id.startsWith('TV-'));
      const stikItems = availableItems.filter(i => i.id.startsWith('STK-'));
      const chargerItems = availableItems.filter(i => i.id.startsWith('USB-'));
      const hdmiItems = availableItems.filter(i => i.id.startsWith('HDMI-'));
      const plugItems = availableItems.filter(i => i.id.startsWith('PLUG-'));
      const lainnyaItems = availableItems.filter(i => i.id.startsWith('LAIN-'));

      // Populate each dropdown (mark current station items as disabled)
      populateSelect('.konsol-select', konsolItems, 'Pilih Konsol...', currentStationItemIds);
      populateSelect('.tv-select', tvItems, 'Pilih TV...', currentStationItemIds);
      populateSelect('.stik-select', stikItems, 'Pilih Stik...', currentStationItemIds);
      populateSelect('.charger-select', chargerItems, 'Pilih Charger/USB...', currentStationItemIds);
      populateSelect('.hdmi-select', hdmiItems, 'Pilih HDMI...', currentStationItemIds);
      populateSelect('.plug-select', plugItems, 'Pilih Power...', currentStationItemIds);
      populateSelect('.lainnya-select', lainnyaItems, 'Pilih Item...', currentStationItemIds);
    }

    function populateSelect(selector, items, placeholder, currentStationItemIds = []) {
      const selects = document.querySelectorAll(selector);
      selects.forEach(select => {
        const currentValue = select.value;
        
        // Build options HTML
        let optionsHtml = `<option value="">${placeholder}</option>`;
        
        items.forEach(i => {
          const isInCurrentStation = currentStationItemIds.includes(i.id);
          const disabled = isInCurrentStation ? 'disabled' : '';
          const prefix = isInCurrentStation ? '✓ ' : '';
          const suffix = isInCurrentStation ? ' (terpasang)' : '';
          const style = isInCurrentStation ? 'style="color: var(--ps3-green); opacity: 0.7;"' : '';
          
          optionsHtml += `<option value="${i.id}" ${disabled} ${style}>${prefix}${i.id} - ${i.name}${suffix}</option>`;
        });
        
        select.innerHTML = optionsHtml;
        select.value = currentValue;
      });
    }

    function resetCategoryRows() {
      // Reset Stik to 1 row
      const stikRows = document.getElementById('stikRows');
      stikRows.innerHTML = `
        <div class="category-row" data-category="stik" class="flex-gap-8-mb6">
          <select class="stik-select select-equip select-equip-flex">
            <option value="">Pilih Stik...</option>
          </select>
        </div>
      `;

      // Reset Charger to 1 row
      const chargerRows = document.getElementById('chargerRows');
      chargerRows.innerHTML = `
        <div class="category-row" data-category="charger" class="flex-gap-8-mb6">
          <select class="charger-select select-equip select-equip-flex">
            <option value="">Pilih Charger/USB...</option>
          </select>
        </div>
      `;

      // Reset Lainnya to empty
      const lainnyaRows = document.getElementById('lainnyaRows');
      lainnyaRows.innerHTML = '';

      // Fixed categories stay with 1 row (Konsol, TV, HDMI, Plug)
    }

    function addCategoryRow(category) {
      const container = document.getElementById(category + 'Rows');
      const row = document.createElement('div');
      row.className = 'category-row';
      row.style.cssText = 'display: flex; gap: 8px; margin-bottom: 6px;';
      row.dataset.category = category;

      const selectClass = category === 'stik' ? 'stik-select' :
                         category === 'charger' ? 'charger-select' :
                         category === 'lainnya' ? 'lainnya-select' : '';

      const placeholder = category === 'stik' ? 'Pilih Stik...' :
                         category === 'charger' ? 'Pilih Charger/USB...' :
                         category === 'lainnya' ? 'Pilih Item...' : 'Pilih...';

      // Get available items for this category
      // Filter: active + not paired to other stations
      const availableItems = inventory.filter(i => {
        if (!i.is_active) return false;
        if (category === 'stik') return i.id.startsWith('STK-');
        if (category === 'charger') return i.id.startsWith('USB-');
        if (category === 'lainnya') return i.id.startsWith('LAIN-');
        return false;
      }).filter(i => !globalPairedItemIds.includes(i.id)); // Filter out items paired to other stations

      // Filter out already selected items in other rows
      const selectedInCategory = Array.from(document.querySelectorAll('.' + selectClass))
        .map(s => s.value).filter(v => v);
      const filteredItems = availableItems.filter(i => !selectedInCategory.includes(i.id));

      const options = `<option value="">${placeholder}</option>` +
        filteredItems.map(i => `<option value="${i.id}">${i.id} - ${i.name}</option>`).join('');

      row.innerHTML = `
        <select class="${selectClass} select-equip select-equip-flex">
          ${options}
        </select>
        <button onclick="removeCategoryRow(this)" style="background: var(--ps3-red); color: white; border: none; padding: 6px 10px; border-radius: 6px; font-size: 0.7rem; cursor: pointer;">−</button>
      `;

      container.appendChild(row);
    }

    function removeCategoryRow(button) {
      const row = button.closest('.category-row');
      if (row) {
        row.remove();
        // No minimum requirements - user can have 0 stik/charger if they want
        // (though station won't be "SIAP" until complete)
      }
    }

    function validateCategoryForm() {
      const errors = [];

      // Check for duplicate categories in the form itself
      const konsol = document.querySelector('.konsol-select')?.value;
      const tv = document.querySelector('.tv-select')?.value;
      const hdmi = document.querySelector('.hdmi-select')?.value;
      const plug = document.querySelector('.plug-select')?.value;
      
      // Only validate if user is trying to add something that already exists in the form
      // (This will be caught by backend too, but we can warn early)
      
      // Check if at least one item is selected
      const hasAnyItem = konsol || tv || hdmi || plug || 
        Array.from(document.querySelectorAll('.stik-select')).some(s => s.value) ||
        Array.from(document.querySelectorAll('.charger-select')).some(s => s.value) ||
        Array.from(document.querySelectorAll('.lainnya-select')).some(s => s.value);
      
      if (!hasAnyItem) {
        errors.push('Pilih minimal 1 item untuk disimpan');
      }

      return errors;
    }

    async function saveCategoryItemsToStation() {
      const stationId = document.getElementById('stationDetailId').value;

      // Validate
      const errors = validateCategoryForm();
      if (errors.length > 0) {
        const msgDiv = document.getElementById('categoryValidationMsg');
        msgDiv.innerHTML = errors.map(e => `• ${e}`).join('<br>');
        msgDiv.style.display = 'block';
        return;
      }

      document.getElementById('categoryValidationMsg').style.display = 'none';

      // Collect all selected items
      const itemsToAdd = [];

      // Konsol (1 unit, role: konsol)
      const konsol = document.querySelector('.konsol-select')?.value;
      if (konsol) itemsToAdd.push({ item_id: konsol, role: 'konsol' });

      // TV (1 unit, role: tv)
      const tv = document.querySelector('.tv-select')?.value;
      if (tv) itemsToAdd.push({ item_id: tv, role: 'tv' });

      // Stik (1-N units, roles: stik1, stik2, etc.)
      const stikValues = Array.from(document.querySelectorAll('.stik-select')).map(s => s.value).filter(v => v);
      stikValues.forEach((stikId, index) => {
        itemsToAdd.push({ item_id: stikId, role: `stik${index + 1}` });
      });

      // Charger (1-N units, roles: charger1, charger2, etc.)
      const chargerValues = Array.from(document.querySelectorAll('.charger-select')).map(s => s.value).filter(v => v);
      chargerValues.forEach((chargerId, index) => {
        itemsToAdd.push({ item_id: chargerId, role: `charger${index + 1}` });
      });

      // HDMI (1 unit, role: hdmi)
      const hdmi = document.querySelector('.hdmi-select')?.value;
      if (hdmi) itemsToAdd.push({ item_id: hdmi, role: 'hdmi' });

      // Plug (1 unit, role: power)
      const plug = document.querySelector('.plug-select')?.value;
      if (plug) itemsToAdd.push({ item_id: plug, role: 'power' });

      // Lainnya (0-N units, roles: lainnya1, lainnya2, etc.)
      const lainnyaValues = Array.from(document.querySelectorAll('.lainnya-select')).map(s => s.value).filter(v => v);
      lainnyaValues.forEach((lainnyaId, index) => {
        itemsToAdd.push({ item_id: lainnyaId, role: `lainnya${index + 1}` });
      });

      if (itemsToAdd.length === 0) {
        showToast('Pilih minimal 1 item', 'error');
        return;
      }

      // Send all items
      showToast('⏳ Menyimpan item ke stasiun...', 'info');

      try {
        // Add items one by one (parallel)
        await Promise.all(itemsToAdd.map(item =>
          api('POST', `/pairings/${stationId}/items`, item)
        ));

        showToast(`${itemsToAdd.length} item berhasil ditambahkan ke stasiun`, 'success');
        openStationDetail(stationId);
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    async function removeItemFromStation(itemId) {
      const stationId = document.getElementById('stationDetailId').value;
      if (!confirm('Hapus item dari stasiun ini?')) return;

      try {
        await api('DELETE', `/pairings/${stationId}/items/${itemId}`);
        showToast('Item dihapus dari stasiun', 'success');
        openStationDetail(stationId);
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    async function quickSwapItem() {
      const fromStationId = document.getElementById('stationDetailId').value;
      const itemId = document.getElementById('swapItemId').value;
      const toStationId = document.getElementById('swapTargetStation').value;

      if (!itemId || !toStationId) {
        showToast('Pilih item dan stasiun tujuan', 'error');
        return;
      }

      try {
        await api('POST', '/pairings/swap', {
          from_pairing_id: fromStationId,
          to_pairing_id: toStationId,
          item_id: itemId
        });
        showToast('Item berhasil dipindahkan', 'success');
        openStationDetail(fromStationId);
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    async function deleteStation() {
      const stationId = document.getElementById('stationDetailId').value;
      if (!confirm('Hapus stasiun ini? Semua item akan dilepas dari stasiun.')) return;

      try {
        await api('DELETE', `/pairings/${stationId}`);
        closeModal('modalStationDetail');
        showToast('Stasiun dihapus', 'success');
        loadStations();
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    // Analytics Functions
    async function loadInventoryAnalytics() {
      try {
        inventoryAnalytics = await api('GET', '/inventory-analytics');
        renderInventoryAnalytics();
      } catch (error) {
        document.getElementById('inventoryAnalytics').innerHTML = '<p class="empty-state-p20">Gagal memuat analytics</p>';
      }
    }

    function renderInventoryAnalytics() {
      const container = document.getElementById('inventoryAnalytics');
      const data = inventoryAnalytics || {};

      container.innerHTML = `
        <!-- Summary Cards -->
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 20px;">
          <div class="card-surface-br10-p15-center">
            <div style="font-size: 1.3rem; font-weight: 700; color: var(--ps3-silver);">${data.total_items || 0}</div>
            <div class="text-sm text-muted">Total Items</div>
          </div>
          <div class="card-surface-br10-p15-center">
            <div style="font-size: 1.3rem; font-weight: 700; color: var(--ps3-green);">Rp${(data.total_value || 0).toLocaleString()}</div>
            <div class="text-sm text-muted">Total Nilai</div>
          </div>
          <div class="card-surface-br10-p15-center">
            <div style="font-size: 1.3rem; font-weight: 700; color: var(--ps3-yellow);">${data.total_maintenance_cost || 0}</div>
            <div class="text-sm text-muted">Biaya Perawatan</div>
          </div>
          <div class="card-surface-br10-p15-center">
            <div style="font-size: 1.3rem; font-weight: 700; color: var(--ps3-red);">${data.items_need_attention || 0}</div>
            <div class="text-sm text-muted">Butuh Perhatian</div>
          </div>
        </div>

        <!-- Assets by Category -->
        <div style="background: var(--ps3-surface); border: 1px solid var(--ps3-border); border-radius: 10px; padding: 15px; margin-bottom: 15px;">
          <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 12px; color: var(--ps3-silver);">📊 Aset per Kategori</div>
          ${(data.assets_by_category || []).map(c => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--ps3-border);">
              <span style="font-size: 0.8rem;">${categoryLabels[c.category] || c.category}</span>
              <div style="text-align: right;">
                <div style="font-size: 0.8rem; font-weight: 600;">${c.count} item</div>
                <div class="text-sm text-green">Rp${(c.value || 0).toLocaleString()}</div>
              </div>
            </div>
          `).join('') || '<p style="text-align: center; color: var(--ps3-muted);">Tidak ada data</p>'}
        </div>

        <!-- Stations Summary -->
        <div style="background: var(--ps3-surface); border: 1px solid var(--ps3-border); border-radius: 10px; padding: 15px;">
          <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 12px; color: var(--ps3-silver);">🏢 Ringkasan Stasiun</div>
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem; padding: 8px 0;">
            <span>Total Stasiun</span>
            <span class="fw-600">${data.total_stations || 0}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem; padding: 8px 0;">
            <span>Stasiun Aktif</span>
            <span class="fw-600 text-green">${data.active_stations || 0}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem; padding: 8px 0; border-top: 1px solid var(--ps3-border); margin-top: 8px;">
            <span>Total Item Terpasang</span>
            <span style="font-weight: 600; color: var(--ps3-silver);">${data.paired_items || 0}</span>
          </div>
        </div>
      `;
    }

    // Capital Functions
    async function addCapital() {
      const amount = parseFloat(document.getElementById('capitalAmount').value) || 0;
      const description = document.getElementById('capitalDesc').value.trim();
      const date = document.getElementById('capitalDate').value;
      
      if (amount <= 0) {
        showToast('Jumlah modal harus lebih dari 0', 'error');
        return;
      }
      
      try {
        await api('POST', '/capital', {
          amount,
          description,
          date
        });
        
        document.getElementById('capitalAmount').value = '';
        document.getElementById('capitalDesc').value = '';
        
        await loadCapital();
        renderCapitalSummary();
        renderCapitalHistory();
        showToast('Modal berhasil dicatat', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    async function addCapitalExpense() {
      const item = document.getElementById('capitalExpenseItem').value.trim();
      const category = document.getElementById('capitalExpenseCategory').value;
      const amount = parseFloat(document.getElementById('capitalExpenseAmount').value) || 0;
      const date = document.getElementById('capitalExpenseDate').value;
      
      if (!item || amount <= 0) {
        showToast('Nama item dan jumlah wajib diisi', 'error');
        return;
      }
      
      try {
        await api('POST', '/capital/expenses', {
          item,
          category,
          amount,
          date
        });
        
        document.getElementById('capitalExpenseItem').value = '';
        document.getElementById('capitalExpenseCategory').value = '';
        document.getElementById('capitalExpenseAmount').value = '';
        
        await loadCapital();
        renderCapitalSummary();
        renderCapitalHistory();
        showToast('Pengeluaran investasi dicatat', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    async function loadCapital() {
      try {
        const response = await api('GET', '/capital');
        // Ensure capitalData has proper structure
        if (response && typeof response === 'object') {
          capitalData = {
            capital: Array.isArray(response.capital) ? response.capital : [],
            expenses: Array.isArray(response.expenses) ? response.expenses : [],
            summary: response.summary || { totalCapital: 0, totalSpent: 0, remaining: 0 }
          };
        } else {
          throw new Error('Invalid response format');
        }
      } catch (error) {
        console.error('Failed to load capital:', error);
        capitalData = { capital: [], expenses: [], summary: { totalCapital: 0, totalSpent: 0, remaining: 0 } };
      }
    }

    async function renderCapitalSummary() {
      const container = document.getElementById('roiContent');
      if (!container) return;
      
      // Ensure capitalData is properly structured
      if (!capitalData || typeof capitalData !== 'object') {
        capitalData = { capital: [], expenses: [], summary: { totalCapital: 0, totalSpent: 0, remaining: 0 } };
      }
      if (!capitalData.summary || typeof capitalData.summary !== 'object') {
        capitalData.summary = { totalCapital: 0, totalSpent: 0, remaining: 0 };
      }
      
      // Load ROI projections from API
      let projections = {};
      try {
        const roiResponse = await api('GET', '/stats/roi');
        projections = roiResponse.projections || {};
      } catch (e) {
        console.log('ROI stats not available, using basic calculations');
      }
      
      const totalCapital = capitalData.summary?.totalCapital || 0;
      const totalSpent = capitalData.summary?.totalSpent || 0;
      const remaining = capitalData.summary?.remaining || 0;
      
      if (totalCapital === 0) {
        container.innerHTML = '<p class="empty-state-p20">Belum ada data modal. Tambahkan modal awal untuk melihat proyeksi.</p>';
        return;
      }
      
      const avgDaily = projections.avgDailyRevenue || 0;
      const medianDaily = projections.medianDailyRevenue || 0;
      const daysToBreakEvenAvg = projections.daysToBreakEvenAvg || 0;
      const daysToBreakEvenMedian = projections.daysToBreakEvenMedian || 0;
      const monthlyProfitAvg = projections.monthlyProfitAvg || 0;
      const monthlyProfitMedian = projections.monthlyProfitMedian || 0;
      
      container.innerHTML = `
        <div class="form-row-15">
          <div style="background: rgba(0,170,0,0.1); border: 1px solid var(--ps3-green); border-radius: 8px; padding: 10px; text-align: center;">
            <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--ps3-muted); margin-bottom: 4px;">Total Modal</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: var(--ps3-green);">Rp${totalCapital.toLocaleString()}</div>
          </div>
          <div style="background: rgba(230,0,18,0.1); border: 1px solid var(--ps3-red); border-radius: 8px; padding: 10px; text-align: center;">
            <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--ps3-muted); margin-bottom: 4px;">Sudah Terpakai</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: var(--ps3-red);">Rp${totalSpent.toLocaleString()}</div>
          </div>
        </div>
        
        <div style="background: rgba(245,166,35,0.1); border: 1px solid var(--ps3-yellow); border-radius: 8px; padding: 10px; text-align: center; margin-bottom: 15px;">
          <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--ps3-muted); margin-bottom: 4px;">Sisa Modal Belum Terinvestasi</div>
          <div style="font-size: 1.2rem; font-weight: 600; color: var(--ps3-yellow);">Rp${remaining.toLocaleString()}</div>
        </div>
        
        ${avgDaily > 0 ? `
          <div style="border-top: 1px solid var(--ps3-border); padding-top: 15px;">
            <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ps3-muted); margin-bottom: 10px; text-align: center;">📊 Proyeksi Balik Modal</div>
            
            <div class="form-row-15">
              <div class="card-surface">
                <div class="fs-7 text-muted mb-4">Rata-rata Harian</div>
                <div style="font-size: 1rem; font-weight: 600; color: var(--ps3-text);">Rp${Math.round(avgDaily).toLocaleString()}</div>
              </div>
              <div class="card-surface">
                <div class="fs-7 text-muted mb-4">Median Harian</div>
                <div style="font-size: 1rem; font-weight: 600; color: var(--ps3-text);">Rp${Math.round(medianDaily).toLocaleString()}</div>
              </div>
            </div>
            
            <div class="form-row-15">
              <div style="background: rgba(0,170,0,0.05); border: 1px solid var(--ps3-green); border-radius: 8px; padding: 10px; text-align: center;">
                <div class="fs-7 text-muted mb-4">Est. BEP (Rata-rata)</div>
                <div style="font-size: 1rem; font-weight: 600; color: var(--ps3-green);">${daysToBreakEvenAvg} hari</div>
                ${projections.breakEvenDateAvg ? `<div style="font-size: 0.7rem; color: var(--ps3-muted); margin-top: 2px;">${formatDate(projections.breakEvenDateAvg)}</div>` : ''}
              </div>
              <div style="background: rgba(0,170,0,0.05); border: 1px solid var(--ps3-green); border-radius: 8px; padding: 10px; text-align: center;">
                <div class="fs-7 text-muted mb-4">Est. BEP (Median)</div>
                <div style="font-size: 1rem; font-weight: 600; color: var(--ps3-green);">${daysToBreakEvenMedian} hari</div>
                ${projections.breakEvenDateMedian ? `<div style="font-size: 0.7rem; color: var(--ps3-muted); margin-top: 2px;">${formatDate(projections.breakEvenDateMedian)}</div>` : ''}
              </div>
            </div>
            
            <div style="background: rgba(192,192,192,0.1); border: 1px solid var(--ps3-silver); border-radius: 8px; padding: 10px; text-align: center;">
              <div class="fs-7 text-muted mb-4">Estimasi Profit Bulanan (Setelah BEP)</div>
              <div style="font-size: 1.1rem; font-weight: 600; color: var(--ps3-silver);">
                Rp${Math.round(monthlyProfitAvg).toLocaleString()} - Rp${Math.round(monthlyProfitMedian).toLocaleString()}
              </div>
            </div>
          </div>
        ` : '<p style="text-align: center; color: var(--ps3-muted); font-size: 0.8rem; padding: 10px;">Belum cukup data transaksi untuk proyeksi. Minimal 2 hari dengan transaksi.</p>'}
      `;
    }

    function renderCapitalHistory() {
      const container = document.getElementById('capitalHistory');
      if (!container) return;
      
      const allItems = [
        ...(capitalData.capital || []).map(c => ({ ...c, type: 'capital' })),
        ...(capitalData.expenses || []).map(e => ({ ...e, type: 'expense' }))
      ].sort((a, b) => new Date(b.date || b.created_at) - new Date(a.date || a.created_at));
      
      if (allItems.length === 0) {
        container.innerHTML = '<p class="empty-state-p15">Belum ada data modal</p>';
        return;
      }
      
      container.innerHTML = allItems.map(item => {
        if (item.type === 'capital') {
          return `
            <div style="background: rgba(0,170,0,0.1); border-left: 3px solid var(--ps3-green); padding: 10px; margin-bottom: 8px; border-radius: 0 8px 8px 0;">
              <div class="flex-between">
                <span class="fw-600 text-green">+ Rp${item.amount.toLocaleString()}</span>
                <span class="text-75 text-muted">${formatDate(item.date)}</span>
              </div>
              ${item.description ? `<div class="text-8 text-muted mt-2">${item.description}</div>` : ''}
            </div>
          `;
        } else {
          return `
            <div style="background: rgba(230,0,18,0.1); border-left: 3px solid var(--ps3-red); padding: 10px; margin-bottom: 8px; border-radius: 0 8px 8px 0;">
              <div class="flex-between">
                <span class="fw-600 text-red">- Rp${item.amount.toLocaleString()}</span>
                <span class="text-75 text-muted">${formatDate(item.date)}</span>
              </div>
              <div class="fs-8 text-muted mt-2">${item.item}</div>
              ${item.category ? `<div class="text-sm text-muted">${item.category}</div>` : ''}
            </div>
          `;
        }
      }).join('');
    }

    async function deleteCapitalExpense(id) {
      if (!confirm('Hapus pengeluaran investasi ini?')) return;
      
      try {
        await api('DELETE', `/capital/expenses/${id}`);
        await loadCapital();
        renderCapitalSummary();
        renderCapitalHistory();
        showToast('Pengeluaran dihapus', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    // ═════════════════ SCHEDULE EXPORT FUNCTIONS ═════════════════
    const originalLoadData = loadData;
    loadData = async function() {
      await originalLoadData();
      await Promise.all([
        loadSchedules(),
        loadInventory(),
        loadCapital()
      ]);
    };

    // ═════════════════ SCHEDULE EXPORT FUNCTIONS ═════════════════
    
    let pendingScheduleExportOptions = {};
    
    function openExportScheduleModal() {
      // Reset to defaults
      selectScheduleRange('today');
      document.getElementById('schedTypeActive').checked = true;
      document.getElementById('schedTypeCompleted').checked = true;
      document.getElementById('schedTypeEditHistory').checked = true;
      document.getElementById('schedTypeCancelled').checked = true;
      
      // Set default custom dates to today
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      document.getElementById('schedExportStartDate').value = dateStr;
      document.getElementById('schedExportEndDate').value = dateStr;
      
      openModal('modalExportSchedule', true);
    }
    
    function selectScheduleRange(range) {
      // Update UI
      document.querySelectorAll('[id^="schedRange"]').forEach(btn => {
        btn.style.background = 'var(--ps3-surface)';
        btn.style.borderColor = 'var(--ps3-border)';
        btn.style.color = 'var(--ps3-text)';
        btn.classList.remove('active');
      });
      
      const activeBtn = document.getElementById(`schedRange${range.charAt(0).toUpperCase() + range.slice(1)}`);
      activeBtn.style.background = 'var(--ps3-red)';
      activeBtn.style.borderColor = 'var(--ps3-red)';
      activeBtn.style.color = '#fff';
      activeBtn.classList.add('active');
      
      // Show/hide custom date range
      document.getElementById('schedCustomRange').style.display = range === 'custom' ? 'block' : 'none';
      
      pendingScheduleExportOptions.range = range;
    }
    
    async function confirmExportSchedule() {
      const range = pendingScheduleExportOptions.range || 'today';
      const includeActive = document.getElementById('schedTypeActive').checked;
      const includeCompleted = document.getElementById('schedTypeCompleted').checked;
      const includeEditHistory = document.getElementById('schedTypeEditHistory').checked;
      const includeCancelled = document.getElementById('schedTypeCancelled').checked;
      
      // Validate at least one type selected
      if (!includeActive && !includeCompleted && !includeEditHistory && !includeCancelled) {
        showToast('Pilih minimal satu jenis jadwal', 'error');
        return;
      }
      
      // Calculate date range in WIB timezone
      const wibOffset = 7 * 60 * 60 * 1000;
      const now = new Date();
      let startTime, endTime, rangeLabel;
      
      if (range === 'custom') {
        const startDate = document.getElementById('schedExportStartDate').value;
        const endDate = document.getElementById('schedExportEndDate').value;
        
        if (!startDate || !endDate) {
          showToast('Pilih range tanggal yang valid', 'error');
          return;
        }
        
        if (new Date(startDate) > new Date(endDate)) {
          showToast('Tanggal mulai tidak boleh lebih besar dari tanggal akhir', 'error');
          return;
        }
        
        const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
        const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
        
        startTime = Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0) - wibOffset;
        endTime = Date.UTC(endYear, endMonth - 1, endDay, 23, 59, 59, 999) - wibOffset;
        rangeLabel = `${startDate}_sampai_${endDate}`;
      } else {
        const nowWIB = new Date(now.getTime() + wibOffset);
        const year = nowWIB.getUTCFullYear();
        const month = nowWIB.getUTCMonth();
        const date = nowWIB.getUTCDate();
        
        switch (range) {
          case 'today':
            startTime = Date.UTC(year, month, date, 0, 0, 0) - wibOffset;
            endTime = Date.UTC(year, month, date, 23, 59, 59, 999) - wibOffset;
            rangeLabel = nowWIB.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }).replace(/\//g, '-');
            break;
            
          case 'week': {
            const dayOfWeek = nowWIB.getUTCDay();
            const mondayOffset = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
            const monday = new Date(Date.UTC(year, month, date + mondayOffset, 0, 0, 0));
            const sunday = new Date(Date.UTC(year, month, date + mondayOffset + 6, 23, 59, 59, 999));
            startTime = monday.getTime() - wibOffset;
            endTime = sunday.getTime() - wibOffset;
            rangeLabel = `minggu-${monday.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }).replace(/\//g, '-')}`;
            break;
          }
            
          case 'month':
            startTime = Date.UTC(year, month, 1, 0, 0, 0) - wibOffset;
            const lastDay = new Date(Date.UTC(year, month + 1, 0)).getDate();
            endTime = Date.UTC(year, month, lastDay, 23, 59, 59, 999) - wibOffset;
            rangeLabel = `${String(month + 1).padStart(2, '0')}-${year}`;
            break;
            
          case 'year':
            startTime = Date.UTC(year, 0, 1, 0, 0, 0) - wibOffset;
            endTime = Date.UTC(year, 11, 31, 23, 59, 59, 999) - wibOffset;
            rangeLabel = `${year}`;
            break;
        }
      }
      
      // Close modal
      closeModal('modalExportSchedule');
      
      // Execute export
      await executeScheduleExport(startTime, endTime, rangeLabel, {
        includeActive,
        includeCompleted,
        includeEditHistory,
        includeCancelled
      });
    }
    
    async function executeScheduleExport(startTime, endTime, rangeLabel, options) {
      showToast('⏳ Mempersiapkan data jadwal...', 'info');
      
      // Load fresh data
      await loadData();
      
      // Get all necessary data
      const activeSchedules = [];
      const completedData = [];
      const cancelledData = [];
      const editHistory = [];
      
      // 1. Active Schedules (from schedules array)
      if (options.includeActive && schedules && schedules.length > 0) {
        schedules.forEach(sched => {
          const schedDate = new Date(sched.scheduledDate + 'T' + (sched.scheduledTime || '00:00'));
          const schedTime = schedDate.getTime();
          
          if (schedTime >= startTime && schedTime <= endTime) {
            const status = sched.active ? 'Berjalan' : 'Menunggu';
            activeSchedules.push({
              txId: sched.id,
              customer: sched.customerName || '-',
              startDate: sched.scheduledDate,
              endDate: sched.scheduledEndDate || sched.scheduledDate,
              startTime: sched.scheduledTime || '-',
              endTime: sched.scheduledEndTime || '-',
              duration: sched.duration || '-',
              note: sched.note || '-',
              status: status,
              editCount: sched.editCount || 0
            });
          }
        });
      }
      
      // 2. Completed Schedules (from API)
      if (options.includeCompleted) {
        try {
          const data = await api('GET', '/schedules/completed');
          if (data.completed && data.completed.length > 0) {
            data.completed.forEach(item => {
              const itemDate = new Date(item.scheduledDate + 'T' + (item.scheduledTime || '00:00'));
              const itemTime = itemDate.getTime();
              
              if (itemTime >= startTime && itemTime <= endTime) {
                // Check if data was auto-cleaned (ghost record)
                const isGhost = !item.customer && !item.unitName;
                completedData.push({
                  txId: item.scheduleId || '-',
                  customer: item.customer || '-',
                  unitName: item.unitName || '-',
                  scheduledDate: item.scheduledDate || '-',
                  scheduledTime: item.scheduledTime || '-',
                  duration: item.duration || '-',
                  completedAt: item.completedAt || '-',
                  isGhost: isGhost
                });
              }
            });
          }
        } catch (error) {
          console.error('Error loading completed schedules:', error);
        }
      }
      
      // 3. Cancelled Schedules (from API)
      if (options.includeCancelled) {
        try {
          const data = await api('GET', '/schedules/deleted');
          if (data.deleted && data.deleted.length > 0) {
            data.deleted.forEach(item => {
              const itemDate = new Date(item.scheduledDate + 'T' + (item.scheduledTime || '00:00'));
              const itemTime = itemDate.getTime();
              
              if (itemTime >= startTime && itemTime <= endTime) {
                const isGhost = !item.customer && !item.unitName;
                cancelledData.push({
                  txId: item.scheduleId || '-',
                  customer: item.customer || '-',
                  unitName: item.unitName || '-',
                  scheduledDate: item.scheduledDate || '-',
                  scheduledTime: item.scheduledTime || '-',
                  cancelledAt: item.cancelledAt || item.deletedAt || '-',
                  reason: item.reason || '-',
                  isGhost: isGhost
                });
              }
            });
          }
        } catch (error) {
          console.error('Error loading deleted schedules:', error);
        }
      }
      
      // 4. Edit History (from deletion_logs for schedules)
      if (options.includeEditHistory && window.cachedDeletionLogs) {
        window.cachedDeletionLogs.forEach(log => {
          if (log.recordType === 'schedule' && log.editHistory && log.editHistory.length > 0) {
            const logTime = new Date(log.deletedAt).getTime();
            if (logTime >= startTime && logTime <= endTime) {
              log.editHistory.forEach(edit => {
                editHistory.push({
                  txId: log.recordId,
                  fieldName: edit.fieldName,
                  oldValue: edit.oldValue,
                  newValue: edit.newValue,
                  editedAt: edit.timestamp,
                  editedBy: edit.editedBy || 'Sistem'
                });
              });
            }
          }
        });
      }
      
      // Generate CSV
      let csv = '\ufeff'; // UTF-8 BOM
      csv += '════════════════════════════════════════════════════════════════\n';
      csv += 'PS3 RENTAL MANAGER - LAPORAN JADWAL\n';
      csv += `Range: ${rangeLabel}\n`;
      csv += `Diekspor: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n`;
      csv += '════════════════════════════════════════════════════════════════\n\n';
      
      // Active Schedules Section
      if (options.includeActive && activeSchedules.length > 0) {
        csv += '════════════════════════════════════════════════════════════════\n';
        csv += 'JADWAL AKTIF (Menunggu & Berjalan)\n';
        csv += '════════════════════════════════════════════════════════════════\n';
        csv += 'TX ID,Nama Penyewa,Tanggal Mulai,Tanggal Berakhir,Waktu Mulai,Waktu Berakhir,Durasi,Catatan,Status,Jumlah Edit\n';
        
        activeSchedules.forEach(s => {
          csv += `"${s.txId}","${(s.customer || '').replace(/"/g, '""')}","${s.startDate}","${s.endDate}","${s.startTime}","${s.endTime}","${s.duration}","${(s.note || '').replace(/"/g, '""')}","${s.status}","${s.editCount}"\n`;
        });
        csv += `\nTotal: ${activeSchedules.length} jadwal aktif\n\n`;
      }
      
      // Completed Schedules Section
      if (options.includeCompleted && completedData.length > 0) {
        csv += '════════════════════════════════════════════════════════════════\n';
        csv += 'JADWAL SELESAI\n';
        csv += '════════════════════════════════════════════════════════════════\n';
        csv += 'TX ID,Nama Penyewa,Unit,Tanggal,Waktu,Durasi,Diselesaikan,Keterangan\n';
        
        completedData.forEach(s => {
          if (s.isGhost) {
            csv += `"${s.txId}","-","-","-","-","-","${s.completedAt}","Data sudah dihapus otomatis (ghost record)"\n`;
          } else {
            csv += `"${s.txId}","${(s.customer || '').replace(/"/g, '""')}","${(s.unitName || '').replace(/"/g, '""')}","${s.scheduledDate}","${s.scheduledTime}","${s.duration}","${s.completedAt}","Jadwal selesai"\n`;
          }
        });
        csv += `\nTotal: ${completedData.length} jadwal selesai\n\n`;
      }
      
      // Cancelled Schedules Section
      if (options.includeCancelled && cancelledData.length > 0) {
        csv += '════════════════════════════════════════════════════════════════\n';
        csv += 'JADWAL DIBATALKAN\n';
        csv += '════════════════════════════════════════════════════════════════\n';
        csv += 'TX ID,Nama Penyewa,Unit,Tanggal,Waktu,Dibatalkan,Alasan,Keterangan\n';
        
        cancelledData.forEach(s => {
          if (s.isGhost) {
            csv += `"${s.txId}","-","-","-","-","${s.cancelledAt}","${(s.reason || '-').replace(/"/g, '""')}","Data sudah dihapus otomatis (ghost record)"\n`;
          } else {
            csv += `"${s.txId}","${(s.customer || '').replace(/"/g, '""')}","${(s.unitName || '').replace(/"/g, '""')}","${s.scheduledDate}","${s.scheduledTime}","${s.cancelledAt}","${(s.reason || '-').replace(/"/g, '""')}","Jadwal dibatalkan"\n`;
          }
        });
        csv += `\nTotal: ${cancelledData.length} jadwal dibatalkan\n\n`;
      }
      
      // Edit History Section
      if (options.includeEditHistory && editHistory.length > 0) {
        csv += '════════════════════════════════════════════════════════════════\n';
        csv += 'RIWAYAT EDIT JADWAL\n';
        csv += '════════════════════════════════════════════════════════════════\n';
        csv += 'TX ID,Field,Yang Diubah,Jadi,Tanggal Edit,Diedit Oleh\n';
        
        editHistory.forEach(h => {
          const editDate = new Date(h.editedAt);
          const dateStr = editDate.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
          csv += `"${h.txId}","${h.fieldName}","${(h.oldValue || '-').replace(/"/g, '""')}","${(h.newValue || '-').replace(/"/g, '""')}","${dateStr}","${h.editedBy}"\n`;
        });
        csv += `\nTotal: ${editHistory.length} riwayat edit\n\n`;
      }
      
      // Summary
      csv += '════════════════════════════════════════════════════════════════\n';
      csv += 'RINGKASAN\n';
      csv += '════════════════════════════════════════════════════════════════\n';
      if (options.includeActive) csv += `Jadwal Aktif: ${activeSchedules.length}\n`;
      if (options.includeCompleted) csv += `Jadwal Selesai: ${completedData.length}\n`;
      if (options.includeCancelled) csv += `Jadwal Dibatalkan: ${cancelledData.length}\n`;
      if (options.includeEditHistory) csv += `Riwayat Edit: ${editHistory.length}\n`;
      csv += '════════════════════════════════════════════════════════════════\n';
      
      // Download CSV
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ps3-jadwal-${rangeLabel}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      
      // Show summary toast
      let summary = [];
      if (options.includeActive) summary.push(`${activeSchedules.length} aktif`);
      if (options.includeCompleted) summary.push(`${completedData.length} selesai`);
      if (options.includeCancelled) summary.push(`${cancelledData.length} dibatalkan`);
      if (options.includeEditHistory) summary.push(`${editHistory.length} edit`);
      
      showToast(`✅ Export berhasil: ${summary.join(', ')}`, 'success');
    }

    // ═════════════════ Event Listeners ═════════════════
    document.getElementById('loginForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const password = document.getElementById('loginPassword').value;
      login(password);
    });

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderReports();
        renderExpenses(); // Re-render expenses for new period
      });
    });

    // Close modals on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
      }
    });

    // Initialize
    (async function init() {
      console.log('[INIT] Starting...');
      updateClock();
      setInterval(updateClock, 1000);
      
      console.log('[INIT] Checking server...');
      const serverReady = await checkServer();
      console.log('[INIT] Server ready:', serverReady);
      if (serverReady && authToken) {
        // Verify token
        try {
          await api('GET', '/auth/verify');
          document.getElementById('loginScreen').style.display = 'none';
          document.getElementById('app').style.display = 'block';
          initApp();
        } catch (e) {
          logout();
        }
      }
    })();
