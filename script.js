// script.js

let currentA1Mode = 'create'; 
let currentA2Mode = 'create';
let currentBeritaMode = 'create'; 
let currentRecipient = null; 
let chatPollingInterval;

// ----------------------------------------------------------------------
// --- CORE UTILITIES ---
// ----------------------------------------------------------------------

function callAppsScript(action, data) {
    return new Promise((resolve, reject) => {
        google.script.run
            .withSuccessHandler(resolve)
            .withFailureHandler(reject)
            .doPost({ action, postData: JSON.stringify(data) });
    });
}

function getSession() {
    const session = localStorage.getItem('pssi_admin_session');
    return session ? JSON.parse(session) : null;
}

function setSession(token, user) {
    localStorage.setItem('pssi_admin_session', JSON.stringify({ token, user }));
}

function clearSession() {
    localStorage.removeItem('pssi_admin_session');
    document.getElementById('dashboard-view').style.display = 'none';
    document.getElementById('login-view').classList.add('active');
    document.getElementById('login-view').style.display = 'flex';
    clearInterval(chatPollingInterval);
}

function showNotification(message, type = 'success') {
    const container = document.getElementById('notification-container');
    const note = document.createElement('div');
    note.className = `notification ${type}`;
    note.textContent = message;
    container.appendChild(note);
    
    setTimeout(() => {
        note.remove();
    }, 5000);
}

function showConfirmation(message) {
    return new Promise(resolve => {
        const result = confirm(message);
        resolve(result);
    });
}

function calculateAgeFrontend(birthDateString) {
    if (!birthDateString) return 0;
    const birthDate = new Date(birthDateString);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDifference = today.getMonth() - birthDate.getMonth();
    if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}


// ----------------------------------------------------------------------
// --- INIT & NAVIGATION ---
// ----------------------------------------------------------------------

function init() {
    const session = getSession();
    if (session) {
        showDashboard(session.user);
    } else {
        document.getElementById('login-view').style.display = 'flex';
    }
}

function showDashboard(user) {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('dashboard-view').style.display = 'block';
    document.getElementById('user-info-sidebar').textContent = `User: ${user.username} (${user.tipeUser})`;
    
    setupNavigation(user.tipeUser);
    switchTab('tab-home'); 
}

function setupNavigation(tipeUser) {
    const navMenu = document.getElementById('nav-menu');
    navMenu.innerHTML = '';

    const tabs = [
        { id: 'tab-home', name: 'Home', roles: ['ADMIN_PUSAT', 'ADMIN_MEDIA', 'ADMIN_KLUB'] },
        { id: 'tab-a1', name: 'Form A1', roles: ['ADMIN_PUSAT', 'ADMIN_MEDIA', 'ADMIN_KLUB'] },
        { id: 'tab-a2', name: 'Form A2', roles: ['ADMIN_PUSAT', 'ADMIN_MEDIA', 'ADMIN_KLUB'] },
        { id: 'tab-a3', name: 'Form A3', roles: ['ADMIN_PUSAT', 'ADMIN_MEDIA', 'ADMIN_KLUB'] },
        { id: 'tab-berita', name: 'Berita', roles: ['ADMIN_PUSAT', 'ADMIN_MEDIA', 'ADMIN_KLUB'] },
        { id: 'tab-chat', name: 'Chat Admin', roles: ['ADMIN_PUSAT', 'ADMIN_MEDIA', 'ADMIN_KLUB'] },
    ];

    tabs.forEach(tab => {
        if (tab.roles.includes(tipeUser) || tipeUser.startsWith('ADMIN_KLUB') && tab.roles.includes('ADMIN_KLUB')) {
            const li = document.createElement('li');
            li.innerHTML = `<a href="#" class="tab-btn" data-tab="${tab.id}"><i class="fas fa-fw"></i> ${tab.name}</a>`;
            navMenu.appendChild(li);
        }
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            switchTab(e.target.getAttribute('data-tab'));
        };
    });
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    document.querySelector(`.tab-btn[data-tab="${tabId}"]`)?.classList.add('active');
    document.getElementById(tabId)?.classList.add('active');

    // Hentikan Polling saat meninggalkan tab chat
    if (tabId !== 'tab-chat') {
        clearInterval(chatPollingInterval);
        currentRecipient = null; // Reset recipient
    }

    const session = getSession();
    if (session) {
        if (tabId === 'tab-a1') loadA1Data(session.token);
        if (tabId === 'tab-a2') loadA2Data(session.token);
        if (tabId === 'tab-a3') loadA3Data(session.token);
        if (tabId === 'tab-berita') loadBeritaData(session.token);
        if (tabId === 'tab-chat') {
            loadChatDashboard();
            startChatPolling();
        }
    }
}


// ----------------------------------------------------------------------
// --- 1. LOGIN/LOGOUT HANDLERS ---
// ----------------------------------------------------------------------

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    try {
        const result = await callAppsScript('LOGIN', { username, password });
        if (result.status === 'success') {
            setSession(result.token, result.user);
            showNotification('Login berhasil!', 'success');
            showDashboard(result.user);
        } else {
            showNotification(result.message, 'error');
        }
    } catch (error) {
        showNotification('Terjadi kesalahan koneksi.', 'error');
    }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    const session = getSession();
    if (session) {
        await callAppsScript('LOGOUT', { token: session.token });
        showNotification('Anda telah logout.', 'success');
        clearSession();
    }
});

// ----------------------------------------------------------------------
// --- 2. CRUD FORM A1 ---
// ----------------------------------------------------------------------

async function loadA1Data(token) {
    const result = await callAppsScript('GET_A1_DATA', { token });
    const session = getSession();

    const addBtn = document.getElementById('add-a1-btn');
    if (session.user.tipeUser.startsWith('ADMIN_KLUB')) {
        addBtn.style.display = 'block';
    } else {
        addBtn.style.display = 'none';
    }

    if (result.status === 'success') {
        renderA1Table(result.data);
    } else {
        showNotification(result.message, 'error');
        if (result.status === 'expired') clearSession();
    }
}

function renderA1Table(data) {
    const tableBody = document.querySelector('#a1-data-table tbody');
    const tableHead = document.querySelector('#a1-data-table thead tr');
    const session = getSession();
    tableBody.innerHTML = '';
    tableHead.innerHTML = '';

    if (data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7">Tidak ada data individu klub.</td></tr>';
        return;
    }

    const headers = Object.keys(data[0]);
    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header.replace(/_/g, ' '); 
        tableHead.appendChild(th);
    });

    const thAction = document.createElement('th');
    thAction.textContent = 'Aksi';
    tableHead.appendChild(thAction);

    data.forEach(item => {
        const row = tableBody.insertRow();
        headers.forEach(header => {
            const cell = row.insertCell();
            cell.textContent = item[header];
        });
        
        const actionCell = row.insertCell();
        const canEditDelete = session.user.tipeUser.startsWith('ADMIN_KLUB') && item.ID_KLUB === session.user.idKlub;

        if (canEditDelete) {
            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.className = 'btn btn-primary btn-sm me-2';
            editBtn.onclick = () => openA1Modal(item);
            actionCell.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Hapus';
            deleteBtn.className = 'btn btn-danger btn-sm';
            deleteBtn.onclick = () => handleA1Delete(item.NAMA_INDIVIDU);
            actionCell.appendChild(deleteBtn);
        } else {
            actionCell.textContent = 'N/A';
        }
    });
}

function openA1Modal(data = null) {
    const modal = document.getElementById('a1-form-modal');
    const title = document.getElementById('a1-modal-title');
    const form = document.getElementById('form-a1');
    const submitBtn = document.getElementById('a1-submit-btn');
    
    form.reset();
    
    if (data) {
        currentA1Mode = 'edit';
        title.textContent = 'Edit Data Individu (A1)';
        submitBtn.textContent = 'Perbarui Data';
        
        document.getElementById('a1-old-nama-individu').value = data.NAMA_INDIVIDU || '';
        document.getElementById('a1-nama-individu').value = data.NAMA_INDIVIDU || '';
        document.getElementById('a1-jabatan').value = data.JABATAN || '';
        document.getElementById('a1-status').value = data.STATUS || 'AKTIF';
    } else {
        currentA1Mode = 'create';
        title.textContent = 'Tambah Data Individu (A1)';
        submitBtn.textContent = 'Simpan Data';
        document.getElementById('a1-old-nama-individu').value = '';
    }
    
    modal.style.display = 'block';
}

document.getElementById('add-a1-btn').onclick = () => openA1Modal(null);

document.getElementById('form-a1').addEventListener('submit', async (e) => {
    e.preventDefault();
    const session = getSession();
    if (!session) return;
    
    let action = currentA1Mode === 'create' ? 'CREATE_A1' : 'UPDATE_A1';
    
    const formData = {
        oldNamaIndividu: document.getElementById('a1-old-nama-individu').value,
        namaIndividu: document.getElementById('a1-nama-individu').value,
        jabatan: document.getElementById('a1-jabatan').value,
        status: document.getElementById('a1-status').value,
    };

    const result = await callAppsScript(action, { token: session.token, formData });
    
    if (result.status === 'success') {
        document.getElementById('a1-form-modal').style.display = 'none';
        showNotification(result.message, 'success');
        loadA1Data(session.token);
    } else {
        showNotification(result.message, 'error');
    }
});

async function handleA1Delete(oldNamaIndividu) {
    const session = getSession();
    if (!session) return;
    
    const confirmed = await showConfirmation(`Anda yakin ingin menghapus individu: ${oldNamaIndividu}?`);
    
    if (confirmed) {
        const result = await callAppsScript('DELETE_A1', { 
            token: session.token, 
            idKlub: oldNamaIndividu 
        });

        if (result.status === 'success') {
            showNotification(result.message, 'success');
            loadA1Data(session.token);
        } else {
            showNotification(result.message, 'error');
        }
    }
}

// ----------------------------------------------------------------------
// --- 3. CRUD FORM A2 ---
// ----------------------------------------------------------------------

async function loadA2Data(token) {
    const result = await callAppsScript('GET_A2_DATA', { token });
    const session = getSession();

    const addBtn = document.getElementById('add-a2-btn');
    if (session.user.tipeUser.startsWith('ADMIN_KLUB')) {
        addBtn.style.display = 'block';
    } else {
        addBtn.style.display = 'none';
    }

    if (result.status === 'success') {
        renderA2Table(result.data);
    } else {
        showNotification(result.message, 'error');
        if (result.status === 'expired') clearSession();
    }
}

function renderA2Table(data) {
    const tableBody = document.querySelector('#a2-data-table tbody');
    const tableHead = document.querySelector('#a2-data-table thead tr');
    const session = getSession();
    tableBody.innerHTML = '';
    tableHead.innerHTML = '';

    if (data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="10">Tidak ada data pemain kolektif.</td></tr>';
        return;
    }

    const headers = Object.keys(data[0]);
    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header.replace(/_/g, ' '); 
        tableHead.appendChild(th);
    });

    const thAction = document.createElement('th');
    thAction.textContent = 'Aksi';
    tableHead.appendChild(thAction);

    data.forEach(item => {
        const row = tableBody.insertRow();
        headers.forEach(header => {
            const cell = row.insertCell();
            let value = item[header];
            cell.textContent = value;
        });
        
        const actionCell = row.insertCell();
        const canEditDelete = session.user.tipeUser.startsWith('ADMIN_KLUB') && item.ID_KLUB === session.user.idKlub;

        if (canEditDelete) {
            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.className = 'btn btn-primary btn-sm me-2';
            editBtn.onclick = () => openA2Modal(item);
            actionCell.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Hapus';
            deleteBtn.className = 'btn btn-danger btn-sm';
            deleteBtn.onclick = () => handleA2Delete(item.ID_PEMAIN);
            actionCell.appendChild(deleteBtn);
        } else {
            actionCell.textContent = 'N/A';
        }
    });
}

function openA2Modal(data = null) {
    const session = getSession();
    if (!session) return;
    
    const modal = document.getElementById('a2-form-modal');
    const title = document.getElementById('a2-modal-title');
    const form = document.getElementById('form-a2');
    const submitBtn = document.getElementById('a2-submit-btn');
    const idPemainInput = document.getElementById('a2-id-pemain');
    
    form.reset();
    document.getElementById('a2-display-id-klub').textContent = session.user.idKlub;
    document.getElementById('a2-display-nama-klub').textContent = session.user.namaKlub;
    document.getElementById('a2-display-usia').textContent = '0';
    
    if (data) {
        currentA2Mode = 'edit';
        title.textContent = 'Edit Data Pemain (A2)';
        submitBtn.textContent = 'Perbarui Pemain';
        idPemainInput.disabled = true;
        
        document.getElementById('a2-id-pemain').value = data.ID_PEMAIN || '';
        document.getElementById('a2-nama-lengkap').value = data.NAMA_LENGKAP || '';
        document.getElementById('a2-nama-punggung').value = data.NAMA_PUNGGUNG || '';
        document.getElementById('a2-npg').value = data.NPG || '';
        
        let tglLahirStr = data.TANGGAL_LAHIR instanceof Date ? data.TANGGAL_LAHIR.toISOString().split('T')[0] : data.TANGGAL_LAHIR;
        document.getElementById('a2-tgl-lahir').value = tglLahirStr;
        document.getElementById('a2-display-usia').textContent = data.USIA || '0';
        document.getElementById('a2-keterangan').value = data.KETERANGAN || '';

    } else {
        currentA2Mode = 'create';
        title.textContent = 'Tambah Data Pemain (A2)';
        submitBtn.textContent = 'Simpan Pemain';
        idPemainInput.disabled = false;
    }
    
    modal.style.display = 'block';
}

document.getElementById('add-a2-btn').onclick = () => openA2Modal(null);

document.getElementById('a2-tgl-lahir').addEventListener('change', (e) => {
    const age = calculateAgeFrontend(e.target.value);
    document.getElementById('a2-display-usia').textContent = age;
});

document.getElementById('form-a2').addEventListener('submit', async (e) => {
    e.preventDefault();
    const session = getSession();
    if (!session) return;
    
    let action = currentA2Mode === 'create' ? 'CREATE_A2' : 'UPDATE_A2';
    
    const formData = {
        idPemain: document.getElementById('a2-id-pemain').value,
        namaLengkap: document.getElementById('a2-nama-lengkap').value,
        namaPunggung: document.getElementById('a2-nama-punggung').value,
        npg: document.getElementById('a2-npg').value,
        tglLahir: document.getElementById('a2-tgl-lahir').value,
        keterangan: document.getElementById('a2-keterangan').value,
    };

    const result = await callAppsScript(action, { token: session.token, formData });
    
    if (result.status === 'success') {
        document.getElementById('a2-form-modal').style.display = 'none';
        showNotification(result.message, 'success');
        loadA2Data(session.token);
    } else {
        showNotification(result.message, 'error');
    }
});

async function handleA2Delete(idPemainToDelete) {
    const session = getSession();
    if (!session) return;
    
    const confirmed = await showConfirmation(`Anda yakin ingin menghapus pemain dengan ID ${idPemainToDelete}?`);
    
    if (confirmed) {
        const result = await callAppsScript('DELETE_A2', { 
            token: session.token, 
            idPemain: idPemainToDelete 
        });

        if (result.status === 'success') {
            showNotification(result.message, 'success');
            loadA2Data(session.token);
        } else {
            showNotification(result.message, 'error');
        }
    }
}


// ----------------------------------------------------------------------
// --- 4. CRUD FORM A3 ---
// ----------------------------------------------------------------------

async function loadA3Data(token) {
    const result = await callAppsScript('GET_A3_MATCHES', { token });
    const session = getSession();
    const isAdminPusat = session.user.tipeUser === 'ADMIN_PUSAT';
    const isKlub = session.user.tipeUser.startsWith('ADMIN_KLUB');
    
    document.getElementById('add-a3-schedule-btn').style.display = isAdminPusat ? 'block' : 'none';
    document.getElementById('add-a3-player-btn').style.display = isKlub ? 'block' : 'none';

    if (result.status === 'success') {
        renderA3Table(result.data);

        if (isKlub) {
            populateA3PlayerDropdowns(result.schedules, result.playersA2, result.tipePemainOptions, result.posisiOptions);
        }
    } else {
        showNotification(result.message, 'error');
        if (result.status === 'expired') clearSession();
    }
}

function renderA3Table(data) {
    const tableBody = document.querySelector('#a3-data-table tbody');
    const tableHead = document.querySelector('#a3-data-table thead tr');
    tableBody.innerHTML = '';
    tableHead.innerHTML = '';
    
    if (data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="10">Tidak ada data pertandingan/lineup.</td></tr>';
        return;
    }

    const headers = Object.keys(data[0]);
    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header.replace(/_/g, ' '); 
        tableHead.appendChild(th);
    });

    data.forEach(item => {
        const row = tableBody.insertRow();
        headers.forEach(header => {
            const cell = row.insertCell();
            cell.textContent = item[header];
        });
    });
}

// ADMIN PUSAT: Buat Jadwal Pertandingan
document.getElementById('add-a3-schedule-btn').onclick = () => {
    document.getElementById('form-a3-schedule').reset();
    document.getElementById('a3-schedule-modal').style.display = 'block';
};
document.getElementById('form-a3-schedule').addEventListener('submit', async (e) => {
    e.preventDefault();
    const session = getSession();
    if (!session) return;
    
    const formData = {
        tglPertandingan: document.getElementById('a3-schedule-tgl').value,
        lokasi: document.getElementById('a3-schedule-lokasi').value,
        idKlub: document.getElementById('a3-schedule-klub').value.toUpperCase(),
    };

    const result = await callAppsScript('CREATE_A3_SCHEDULE', { token: session.token, formData });
    document.getElementById('a3-schedule-modal').style.display = 'none';

    if (result.status === 'success') {
        showNotification(result.message, 'success');
        loadA3Data(session.token);
    } else {
        showNotification(result.message, 'error');
    }
});

// ADMIN KLUB: Daftarkan Pemain
document.getElementById('add-a3-player-btn').onclick = () => {
    document.getElementById('form-a3-player').reset();
    document.getElementById('a3-player-modal').style.display = 'block';
};

function populateA3PlayerDropdowns(schedules, players, tipePemainOptions, posisiOptions) {
    const lineupSelect = document.getElementById('a3-player-lineup');
    lineupSelect.innerHTML = '<option value="">Pilih Jadwal</option>';
    schedules.forEach(s => {
        const option = document.createElement('option');
        option.value = s.idLineUp;
        option.textContent = `${s.tanggal} - ${s.lokasi} [${s.idLineUp}]`;
        lineupSelect.appendChild(option);
    });
    
    const playerSelect = document.getElementById('a3-player-id');
    playerSelect.innerHTML = '<option value="">Pilih Pemain</option>';
    players.forEach(p => {
        const option = document.createElement('option');
        option.value = p.idPemain;
        option.textContent = `${p.namaLengkap} (No: ${p.noPunggung})`;
        option.setAttribute('data-nama-punggung', p.namaPunggung);
        option.setAttribute('data-no-punggung', p.noPunggung);
        playerSelect.appendChild(option);
    });
    
    document.getElementById('a3-player-tipe').innerHTML = tipePemainOptions.map(t => `<option value="${t}">${t}</option>`).join('');
    document.getElementById('a3-player-posisi').innerHTML = posisiOptions.map(p => `<option value="${p}">${p}</option>`).join('');
}

document.getElementById('a3-player-id').addEventListener('change', (e) => {
    const selectedOption = e.target.options[e.target.selectedIndex];
    const namaPunggung = selectedOption.getAttribute('data-nama-punggung') || '';
    const noPunggung = selectedOption.getAttribute('data-no-punggung') || '';

    document.getElementById('a3-display-nama-punggung').textContent = namaPunggung;
    document.getElementById('a3-player-npg').value = noPunggung;
});

document.getElementById('form-a3-player').addEventListener('submit', async (e) => {
    e.preventDefault();
    const session = getSession();
    if (!session) return;
    
    const formData = {
        idLineUp: document.getElementById('a3-player-lineup').value,
        idPemain: document.getElementById('a3-player-id').value,
        noPunggung: document.getElementById('a3-player-npg').value,
        tipePemain: document.getElementById('a3-player-tipe').value,
        posisi: document.getElementById('a3-player-posisi').value,
    };

    const result = await callAppsScript('CREATE_A3_PLAYER', { token: session.token, formData });
    document.getElementById('a3-player-modal').style.display = 'none';

    if (result.status === 'success') {
        showNotification(result.message, 'success');
        loadA3Data(session.token);
    } else {
        showNotification(result.message, 'error');
    }
});


// ----------------------------------------------------------------------
// --- 5. CRUD BERITA ---
// ----------------------------------------------------------------------

async function loadBeritaData(token) {
    const result = await callAppsScript('GET_BERITA', { token });
    const session = getSession();
    
    const addBtn = document.getElementById('add-berita-btn');
    if (session.user.tipeUser === 'ADMIN_PUSAT' || session.user.tipeUser === 'ADMIN_MEDIA') {
        addBtn.style.display = 'block';
    } else {
        addBtn.style.display = 'none'; 
    }

    if (result.status === 'success') {
        renderBeritaTable(result.data, result.canEditDelete, session.user.username);
    } else {
        showNotification(result.message, 'error');
        if (result.status === 'expired') clearSession();
    }
}

function renderBeritaTable(data, canEditDelete, currentUsername) {
    const tableBody = document.querySelector('#berita-data-table tbody');
    const tableHead = document.querySelector('#berita-data-table thead tr');
    tableBody.innerHTML = '';
    tableHead.innerHTML = '';
    
    if (data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6">Tidak ada berita yang ditemukan.</td></tr>';
        return;
    }

    const displayHeaders = ['ID_BERITA', 'TANGGAL_PUBLISH', 'JUDUL', 'PENULIS', 'TIPE_PENULIS'];
    displayHeaders.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header.replace(/_/g, ' '); 
        tableHead.appendChild(th);
    });

    const thAction = document.createElement('th');
    thAction.textContent = 'Aksi';
    tableHead.appendChild(thAction);

    data.forEach(item => {
        const row = tableBody.insertRow();
        displayHeaders.forEach(header => {
            const cell = row.insertCell();
            cell.textContent = item[header];
            if (header === 'JUDUL') cell.title = item.KONTEN ? item.KONTEN.substring(0, 100) + '...' : '';
        });
        
        const actionCell = row.insertCell();
        const isAuthor = item.PENULIS === currentUsername;
        let showActions = false;

        if (canEditDelete) {
            if (getSession().user.tipeUser === 'ADMIN_PUSAT') {
                showActions = true;
            } else if (getSession().user.tipeUser === 'ADMIN_MEDIA' && isAuthor) {
                showActions = true;
            }
        }

        if (showActions) {
            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.className = 'btn btn-primary btn-sm me-2';
            editBtn.onclick = () => openBeritaModal(item);
            actionCell.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Hapus';
            deleteBtn.className = 'btn btn-danger btn-sm';
            deleteBtn.onclick = () => handleDeleteBerita(item.ROW_NUMBER, item.JUDUL);
            actionCell.appendChild(deleteBtn);
        } else {
            actionCell.textContent = 'N/A';
        }
    });
}

function openBeritaModal(data = null) {
    const session = getSession();
    if (!session) return;
    
    const modal = document.getElementById('berita-modal');
    const title = document.getElementById('berita-modal-title');
    const form = document.getElementById('form-berita');
    const submitBtn = document.getElementById('berita-submit-btn');
    
    form.reset();
    document.getElementById('berita-display-penulis').textContent = session.user.username;
    document.getElementById('berita-display-tipe').textContent = session.user.tipeUser;
    
    if (data) {
        if (session.user.tipeUser === 'ADMIN_MEDIA' && data.PENULIS !== session.user.username) {
            showNotification('Anda hanya bisa mengedit berita yang Anda tulis.', 'error');
            return;
        }

        currentBeritaMode = 'edit';
        title.textContent = 'Edit Berita';
        submitBtn.textContent = 'Perbarui Berita';

        document.getElementById('berita-row-number').value = data.ROW_NUMBER;
        document.getElementById('berita-judul').value = data.JUDUL || '';
        document.getElementById('berita-url-gambar').value = data.URL_GAMBAR || '';
        document.getElementById('berita-konten').value = data.KONTEN || '';
        document.getElementById('berita-display-penulis').textContent = data.PENULIS || session.user.username;
        document.getElementById('berita-display-tipe').textContent = data.TIPE_PENULIS || session.user.tipeUser;

    } else {
        currentBeritaMode = 'create';
        title.textContent = 'Buat Berita Baru';
        submitBtn.textContent = 'Simpan Berita';
        document.getElementById('berita-row-number').value = '';
    }
    
    modal.style.display = 'block';
}

document.getElementById('add-berita-btn').onclick = () => openBeritaModal(null);

document.getElementById('form-berita').addEventListener('submit', async (e) => {
    e.preventDefault();
    const session = getSession();
    if (!session) return;
    
    let action = currentBeritaMode === 'create' ? 'CREATE_BERITA' : 'UPDATE_BERITA';
    
    const formData = {
        rowNumber: document.getElementById('berita-row-number').value,
        judul: document.getElementById('berita-judul').value,
        urlGambar: document.getElementById('berita-url-gambar').value,
        konten: document.getElementById('berita-konten').value,
    };

    const result = await callAppsScript(action, { token: session.token, formData });
    document.getElementById('berita-modal').style.display = 'none';

    if (result.status === 'success') {
        showNotification(result.message, 'success');
        loadBeritaData(session.token);
    } else {
        showNotification(result.message, 'error');
    }
});

async function handleDeleteBerita(rowNumberToDelete, judul) {
    const session = getSession();
    if (!session) return;
    
    const confirmed = await showConfirmation(`Anda yakin ingin menghapus berita: "${judul}"?`);
    
    if (confirmed) {
        const result = await callAppsScript('DELETE_BERITA', { 
            token: session.token, 
            idBerita: rowNumberToDelete
        });

        if (result.status === 'success') {
            showNotification(result.message, 'success');
            loadBeritaData(session.token);
        } else {
            showNotification(result.message, 'error');
        }
    }
}

// ----------------------------------------------------------------------
// --- 6. CHAT LOGIC ---
// ----------------------------------------------------------------------

function startChatPolling() {
    clearInterval(chatPollingInterval); 

    chatPollingInterval = setInterval(() => {
        const session = getSession();
        if (session) {
            loadChatDashboard(false);
            if (currentRecipient) {
                loadConversation(session.token, currentRecipient, false); 
            }
        } else {
            clearInterval(chatPollingInterval);
        }
    }, 5000); 
}

async function loadChatDashboard(initialLoad = true) {
    const session = getSession();
    if (!session) return;
    const result = await callAppsScript('GET_CHAT_DASHBOARD', { token: session.token });
    
    if (result.status === 'success') {
        renderContactList(result.contacts);
    } else if (initialLoad) {
        showNotification(result.message, 'error');
    }
}

function renderContactList(contacts) {
    const list = document.getElementById('contact-list');
    list.innerHTML = '';
    
    contacts.forEach(contact => {
        const li = document.createElement('li');
        li.className = 'contact-item';
        if (contact.username === currentRecipient) {
             li.classList.add('active');
        }
        
        const statusClass = contact.isOnline ? 'online' : 'offline';
        const statusText = contact.isOnline ? 'Online' : 'Offline';
        
        li.innerHTML = `
            <span>${contact.username} (${contact.tipeUser})</span>
            <span class="status ${statusClass}">${statusText}</span>
            ${contact.unreadCount > 0 ? `<span class="badge">${contact.unreadCount}</span>` : ''}
        `;
        
        li.onclick = () => openConversation(contact);
        list.appendChild(li);
    });
    
    if (currentRecipient) {
        const activeContact = contacts.find(c => c.username === currentRecipient);
        if (activeContact) {
            const statusClass = activeContact.isOnline ? 'online' : 'offline';
            const statusText = activeContact.isOnline ? 'Online' : 'Offline';
            document.getElementById('chat-recipient-status').textContent = statusText;
            document.getElementById('chat-recipient-status').className = statusClass;
        }
    }
}

async function openConversation(contact) {
    currentRecipient = contact.username;
    
    document.querySelector('#contact-list .contact-item.active')?.classList.remove('active');
    // Cari elemen li yang sesuai dan tambahkan class 'active'
    document.querySelectorAll('#contact-list .contact-item').forEach(item => {
        if (item.querySelector('span').textContent.startsWith(contact.username)) {
             item.classList.add('active');
        }
    });

    document.getElementById('chat-welcome').classList.remove('active');
    document.getElementById('chat-welcome').classList.add('hidden');
    document.getElementById('chat-main').classList.remove('hidden');

    document.getElementById('chat-recipient-name').textContent = contact.username;
    document.getElementById('chat-recipient-status').textContent = contact.isOnline ? 'Online' : 'Offline';
    document.getElementById('chat-recipient-status').className = contact.isOnline ? 'online' : 'offline';
    
    await loadConversation(getSession().token, currentRecipient);
    
    await markMessagesAsRead(getSession().token, currentRecipient);
    loadChatDashboard(false);
}

async function loadConversation(token, recipient, markRead = true) {
    const result = await callAppsScript('GET_CONVERSATION', { token, recipient });
    
    if (result.status === 'success') {
        renderMessages(result.messages);
        
        if (markRead) {
            await markMessagesAsRead(token, recipient);
        }
    }
}

function renderMessages(messages) {
    const msgArea = document.getElementById('chat-messages');
    msgArea.innerHTML = '';
    const currentUser = getSession().user.username;
    
    messages.forEach(msg => {
        const isSelf = msg.sender === currentUser;
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isSelf ? 'self' : 'other'}`;
        msgDiv.innerHTML = `
            <span class="message-content">${msg.message}</span>
            <span class="message-time">${msg.timestamp}</span>
        `;
        msgArea.appendChild(msgDiv);
    });
    
    msgArea.scrollTop = msgArea.scrollHeight;
}

document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    const token = getSession().token;

    if (!message || !currentRecipient) return;
    
    const result = await callAppsScript('SEND_MESSAGE', { 
        token, 
        recipient: currentRecipient, 
        message 
    });
    
    if (result.status === 'success') {
        input.value = '';
        await loadConversation(token, currentRecipient, false);
    } else {
        showNotification(result.message, 'error');
    }
});

async function markMessagesAsRead(token, sender) {
    await callAppsScript('MARK_AS_READ', { token, sender });
}

// ----------------------------------------------------------------------
// --- INIT EVENTS ---
// ----------------------------------------------------------------------

// Event listener untuk menutup modal
document.querySelectorAll('.close-btn').forEach(btn => {
    btn.onclick = function() {
        const modalId = this.getAttribute('data-modal');
        document.getElementById(modalId).style.display = 'none';
    };
});

window.onload = init;
